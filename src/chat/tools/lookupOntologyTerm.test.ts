import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lookupOntologyTermTool,
  searchCognitiveAtlasConcepts,
  searchCognitiveAtlasSnapshot,
  type CognitiveAtlasConcept,
} from './lookupOntologyTerm';
import snapshot from '../../data/cognitive-atlas-concepts.json';
import type { ToolExecutionContext } from '../types';

const context: ToolExecutionContext = {
  modifyMetadata: vi.fn(),
  originalMetadata: null,
  modifiedMetadata: null,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_CORS_PROXY_URL', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('bundled Cognitive Atlas snapshot', () => {
  it('has a plausible number of concepts with ids, names and a fetch date', () => {
    expect(snapshot.concepts.length).toBeGreaterThan(800);
    expect(snapshot.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const concept of snapshot.concepts.slice(0, 20)) {
      expect(concept.id).toMatch(/^trm_/);
      expect(concept.name.length).toBeGreaterThan(0);
    }
  });
});

describe('searchCognitiveAtlasSnapshot', () => {
  const concepts: CognitiveAtlasConcept[] = [
    { id: 'trm_1', name: 'working memory', definition: 'active maintenance of information' },
    { id: 'trm_2', name: 'spatial working memory', definition: 'working memory for locations' },
    { id: 'trm_3', name: 'altruism', alias: 'selflessness', definition: 'concern for others' },
    { id: 'trm_4', name: 'attention', definition: 'selection of information for working memory' },
  ];

  it('ranks an exact name first, then prefixes, then substrings, then definitions', () => {
    const names = searchCognitiveAtlasSnapshot('working memory', 10, concepts).map((c) => c.name);
    expect(names).toEqual(['working memory', 'spatial working memory', 'attention']);
  });

  it('matches aliases', () => {
    expect(searchCognitiveAtlasSnapshot('selflessness', 5, concepts).map((c) => c.id)).toEqual(['trm_3']);
  });

  it('is case insensitive, trims, and respects the limit', () => {
    expect(searchCognitiveAtlasSnapshot('  WORKING Memory ', 1, concepts).map((c) => c.id)).toEqual(['trm_1']);
    expect(searchCognitiveAtlasSnapshot('', 5, concepts)).toEqual([]);
    expect(searchCognitiveAtlasSnapshot('no such concept', 5, concepts)).toEqual([]);
  });

  it('finds real concepts in the bundled snapshot', () => {
    const results = searchCognitiveAtlasSnapshot('working memory', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase()).toBe('working memory');
    expect(searchCognitiveAtlasSnapshot('episodic memory', 3)[0].name.toLowerCase()).toContain('episodic memory');
  });
});

describe('searchCognitiveAtlasConcepts', () => {
  it('uses the snapshot without any network call when no proxy is configured', async () => {
    const { concepts, source } = await searchCognitiveAtlasConcepts('working memory', 3);
    expect(source).toBe('snapshot');
    expect(concepts.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the live list through the configured proxy', async () => {
    vi.stubEnv('VITE_CORS_PROXY_URL', 'https://proxy.example/?{url}');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 'trm_live', name: 'brand new concept', definition_text: 'only on the live API' },
      ],
    });
    const { concepts, source } = await searchCognitiveAtlasConcepts('brand new', 3);
    expect(source).toBe('live');
    expect(concepts).toEqual([{ id: 'trm_live', name: 'brand new concept', definition: 'only on the live API' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://proxy.example/?${encodeURIComponent('https://www.cognitiveatlas.org/api/v-alpha/concept')}`,
    );
  });

  it('falls back to the snapshot when the live request fails', async () => {
    vi.stubEnv('VITE_CORS_PROXY_URL', 'https://proxy.example/?{url}');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { concepts, source } = await searchCognitiveAtlasConcepts('working memory', 3);
    expect(source).toBe('snapshot');
    expect(concepts[0].name.toLowerCase()).toBe('working memory');
  });
});

describe('lookup_ontology_term with the cognitive category', () => {
  it('returns Cognitive Atlas identifiers from the snapshot and reports the source', async () => {
    const { result } = await lookupOntologyTermTool.execute(
      { term: 'working memory', category: 'cognitive', maxResults: 3 },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.cognitiveAtlasSource).toBe('snapshot');
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]).toMatchObject({
      schemaKey: 'GenericType',
      ontology: 'CognitiveAtlas',
      name: expect.stringMatching(/working memory/i),
    });
    expect(parsed.results[0].identifier).toMatch(/^https:\/\/www\.cognitiveatlas\.org\/concept\/id\/trm_/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
