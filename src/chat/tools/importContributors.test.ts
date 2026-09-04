import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorshipsToContributors,
  extractDoi,
  formatPersonName,
  importContributorsTool,
  institutionNameAppearsIn,
  lookupRorMatch,
  mergeContributors,
  nameMatchKey,
  resolveAffiliation,
  splitRawAffiliations,
  type AffiliationNote,
  type OpenAlexAuthorship,
  type OpenAlexWork,
  type RorMatch,
} from './importContributors';
import fixture from './__fixtures__/openalex-elife-78362.json';
import type { ToolExecutionContext } from '../types';

const work = fixture as OpenAlexWork;

describe('extractDoi', () => {
  it.each([
    ['10.7554/eLife.78362', '10.7554/eLife.78362'],
    ['doi:10.7554/eLife.78362', '10.7554/eLife.78362'],
    ['https://doi.org/10.7554/eLife.78362', '10.7554/eLife.78362'],
    ['https://dx.doi.org/10.1016/j.neuron.2016.12.011.', '10.1016/j.neuron.2016.12.011'],
    ['https://www.biorxiv.org/content/10.1101/2021.03.24.436749v2', '10.1101/2021.03.24.436749'],
    ['see 10.1038/s41586-020-2649-2, published 2020', '10.1038/s41586-020-2649-2'],
  ])('extracts %j as %j', (input, expected) => {
    expect(extractDoi(input)).toBe(expected);
  });

  it('returns null when there is no DOI', () => {
    expect(extractDoi('https://elifesciences.org/articles/78362')).toBeNull();
    expect(extractDoi('')).toBeNull();
  });
});

describe('formatPersonName', () => {
  it.each([
    ['Oliver Rübel', 'Rübel, Oliver'],
    ['Benjamin K Dichter', 'Dichter, Benjamin K'],
    ['Ludwig van Beethoven', 'van Beethoven, Ludwig'],
    ['Maria de la Cruz', 'de la Cruz, Maria'],
    ['Lovelace, Augusta Ada', 'Lovelace, Augusta Ada'],
    ['Cher', 'Cher'],
    ['  Ada   Lovelace ', 'Lovelace, Ada'],
  ])('formats %j as %j', (input, expected) => {
    expect(formatPersonName(input)).toBe(expected);
  });
});

describe('nameMatchKey', () => {
  it('matches the same person across orderings, case, diacritics and middle names', () => {
    expect(nameMatchKey('Oliver Rübel')).toBe(nameMatchKey('Rubel, Oliver'));
    expect(nameMatchKey('Dichter, Benjamin K')).toBe(nameMatchKey('Benjamin Dichter'));
    expect(nameMatchKey('Dichter, Ben')).not.toBe(nameMatchKey('Dichter, Benjamin'));
    expect(nameMatchKey('Cher')).toBeNull();
  });
});

describe('authorshipsToContributors', () => {
  it('builds Person entries in publication order with bare ORCIDs and ROR affiliations', () => {
    const people = authorshipsToContributors(work);
    expect(people.map((p) => p.name)).toEqual(['Rübel, Oliver', 'Tritt, Andrew', 'Ly, Ryan', 'Dichter, Ben']);
    expect(people[0]).toEqual({
      schemaKey: 'Person',
      name: 'Rübel, Oliver',
      identifier: '0000-0001-9902-1984',
      roleName: ['dcite:Author'],
      includeInCitation: true,
      affiliation: [
        { schemaKey: 'Affiliation', name: 'Lawrence Berkeley National Laboratory', identifier: 'https://ror.org/02jbv0t02' },
      ],
    });
    for (const person of people) {
      expect(person.identifier).toMatch(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/);
    }
    // OpenAlex mapped the raw string "CatalystNeuro" to an unrelated organization
    // named "Catalyst"; without a ROR match the raw text is kept and no
    // identifier is invented.
    expect(people[3].affiliation).toEqual([{ schemaKey: 'Affiliation', name: 'CatalystNeuro' }]);
  });

  it('uses a confident ROR match for a raw affiliation and records the sources', () => {
    const rorMatches = new Map<string, RorMatch | null>([
      ['CatalystNeuro', { name: 'CatalystNeuro', identifier: 'https://ror.org/01d74sk53' }],
    ]);
    const notes: AffiliationNote[] = [];
    const people = authorshipsToContributors(work, rorMatches, notes);
    expect(people[3].affiliation).toEqual([
      { schemaKey: 'Affiliation', name: 'CatalystNeuro', identifier: 'https://ror.org/01d74sk53' },
    ]);
    expect(notes.map((n) => n.source)).toEqual(['openalex', 'openalex', 'openalex', 'ror']);
  });

  it('omits the identifier and affiliation when OpenAlex has none, and dedupes institutions', () => {
    const [person] = authorshipsToContributors({
      authorships: [
        {
          author: { display_name: 'Jane Doe', orcid: null },
          institutions: [
            { display_name: 'Some Institute', ror: 'https://ror.org/abc123' },
            { display_name: 'Some Institute', ror: 'https://ror.org/abc123' },
            { display_name: 'No ROR Lab', ror: null },
          ],
        },
      ],
    });
    expect(person.identifier).toBeUndefined();
    expect(person.affiliation).toEqual([
      { schemaKey: 'Affiliation', name: 'Some Institute', identifier: 'https://ror.org/abc123' },
      { schemaKey: 'Affiliation', name: 'No ROR Lab' },
    ]);
    const [bare] = authorshipsToContributors({ authorships: [{ author: { display_name: 'Solo Author' } }] });
    expect(bare.affiliation).toBeUndefined();
  });
});

describe('splitRawAffiliations', () => {
  it('splits combined strings on semicolons and dedupes in order', () => {
    expect(
      splitRawAffiliations(['Dept A, Univ X', 'Institute B', 'Dept A, Univ X; Institute B', ' dept a,  univ x ']),
    ).toEqual(['Dept A, Univ X', 'Institute B']);
    expect(splitRawAffiliations(undefined)).toEqual([]);
  });
});

describe('institutionNameAppearsIn', () => {
  it('requires every word of the institution name as a whole word in the raw text', () => {
    expect(institutionNameAppearsIn('Lawrence Berkeley National Laboratory', 'Scientific Data Division, Lawrence Berkeley National Laboratory')).toBe(true);
    expect(institutionNameAppearsIn('MBF Bioscience (United States)', 'MBF Bioscience')).toBe(true);
    expect(institutionNameAppearsIn('University of California, San Francisco', 'Departments of Physiology and Psychiatry University of California, San Francisco')).toBe(true);
    expect(institutionNameAppearsIn('Catalyst', 'CatalystNeuro')).toBe(false);
    expect(institutionNameAppearsIn('Kavli Institute for Theoretical Sciences', 'Kavli Institute for Fundamental Neuroscience')).toBe(false);
    expect(institutionNameAppearsIn('Harvard University', 'Department of Otolaryngology, Harvard Medical School')).toBe(false);
  });
});

describe('resolveAffiliation', () => {
  const authorship: OpenAlexAuthorship = {
    author: { display_name: 'Pamela Baker' },
    raw_affiliation_strings: ['Allen Institute for Brain Science'],
    affiliations: [{ raw_affiliation_string: 'Allen Institute for Brain Science', institution_ids: ['I1', 'I2'] }],
    institutions: [
      { id: 'I2', display_name: 'Allen Institute', ror: 'https://ror.org/03cpe7c52' },
      { id: 'I1', display_name: 'Allen Institute for Brain Science', ror: 'https://ror.org/00dcv1019' },
    ],
  };

  it('prefers a confident ROR match', () => {
    const rorMatches = new Map<string, RorMatch | null>([
      ['Allen Institute for Brain Science', { name: 'Allen Institute for Brain Science', identifier: 'https://ror.org/00dcv1019' }],
    ]);
    expect(resolveAffiliation(authorship, 'Allen Institute for Brain Science', rorMatches)).toEqual({
      affiliation: { schemaKey: 'Affiliation', name: 'Allen Institute for Brain Science', identifier: 'https://ror.org/00dcv1019' },
      source: 'ror',
    });
  });

  it('falls back to the most specific OpenAlex institution whose name appears in the text', () => {
    const { affiliation, source } = resolveAffiliation(authorship, 'Allen Institute for Brain Science', new Map());
    expect(source).toBe('openalex');
    expect(affiliation.identifier).toBe('https://ror.org/00dcv1019');
  });

  it('keeps the raw text without an identifier when nothing confirms a match', () => {
    const kavli: OpenAlexAuthorship = {
      author: { display_name: 'Loren Frank' },
      raw_affiliation_strings: ['Kavli Institute for Fundamental Neuroscience'],
      institutions: [{ id: 'I3', display_name: 'Kavli Institute for Theoretical Sciences', ror: 'https://ror.org/01kv3wg35' }],
    };
    expect(resolveAffiliation(kavli, 'Kavli Institute for Fundamental Neuroscience', new Map())).toEqual({
      affiliation: { schemaKey: 'Affiliation', name: 'Kavli Institute for Fundamental Neuroscience' },
      source: 'unresolved',
    });
  });
});

describe('lookupRorMatch', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the chosen organization from the v1 affiliation endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { chosen: false, score: 0.9, organization: { id: 'https://ror.org/zzz', names: [{ value: 'Wrong', types: ['ror_display'] }] } },
          { chosen: true, score: 1, organization: { id: 'https://ror.org/01d74sk53', names: [{ value: 'CatalystNeuro', types: ['ror_display'] }] } },
        ],
      }),
    });
    expect(await lookupRorMatch('CatalystNeuro')).toEqual({ name: 'CatalystNeuro', identifier: 'https://ror.org/01d74sk53' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ror.org/organizations?affiliation=CatalystNeuro');
  });

  it('returns null when ROR does not choose, and on errors', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ chosen: false, organization: { id: 'https://ror.org/x', name: 'X' } }] }) });
    expect(await lookupRorMatch('Weill Neurohub')).toBeNull();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect(await lookupRorMatch('Anything')).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await lookupRorMatch('Anything')).toBeNull();
  });
});

describe('mergeContributors', () => {
  const imported = authorshipsToContributors(work);
  const contact = {
    schemaKey: 'Person',
    name: 'Dichter, Benjamin',
    email: 'ben@example.org',
    identifier: 'https://orcid.org/0000-0001-5725-6910',
    roleName: ['dcite:ContactPerson'],
    includeInCitation: true,
  };
  const funder = {
    schemaKey: 'Organization',
    name: 'National Institutes of Health',
    roleName: ['dcite:Funder'],
    awardNumber: 'R01NS123456',
  };

  it('puts authors in publication order and carries other contributors over unchanged', () => {
    const result = mergeContributors([funder, contact], imported);
    expect(result.contributors.map((c) => c.name)).toEqual([
      'Rübel, Oliver', 'Tritt, Andrew', 'Ly, Ryan', 'Dichter, Benjamin', 'National Institutes of Health',
    ]);
    expect(result.added).toEqual(['Rübel, Oliver', 'Tritt, Andrew', 'Ly, Ryan']);
    expect(result.matched).toEqual(['Dichter, Benjamin']);
    expect(result.carriedOver).toEqual(['National Institutes of Health']);
    expect(result.contributors[4]).toEqual(funder);
  });

  it('matches by ORCID, keeping the existing spelling, email and roles, and adding the Author role', () => {
    const result = mergeContributors([contact], imported);
    const merged = result.contributors[3];
    expect(merged.name).toBe('Dichter, Benjamin');
    expect(merged.email).toBe('ben@example.org');
    expect(merged.identifier).toBe('https://orcid.org/0000-0001-5725-6910');
    expect(merged.roleName).toEqual(['dcite:ContactPerson', 'dcite:Author']);
    expect(merged.affiliation).toEqual(imported[3].affiliation);
  });

  it('matches by name when there is no ORCID and fills the ORCID in', () => {
    const existing = { schemaKey: 'Person', name: 'Ryan Ly', roleName: ['dcite:DataCurator'] };
    const result = mergeContributors([existing], imported);
    const merged = result.contributors[2];
    expect(result.matched).toEqual(['Ryan Ly']);
    expect(merged.identifier).toBe('0000-0001-9238-0642');
    expect(merged.roleName).toEqual(['dcite:DataCurator', 'dcite:Author']);
  });

  it('is idempotent', () => {
    const once = mergeContributors([funder, contact], imported);
    const twice = mergeContributors(once.contributors, imported);
    expect(twice.contributors).toEqual(once.contributors);
    expect(twice.added).toEqual([]);
  });

  it('does not merge different people who share a family name', () => {
    const other = { schemaKey: 'Person', name: 'Ly, Alex', roleName: ['dcite:Author'] };
    const result = mergeContributors([other], imported);
    expect(result.contributors.map((c) => c.name)).toContain('Ly, Alex');
    expect(result.contributors.map((c) => c.name)).toContain('Ly, Ryan');
  });
});

describe('import_contributors_from_publication tool', () => {
  const modifyMetadata = vi.fn();
  const fetchMock = vi.fn();
  const context = (contributor: unknown[]): ToolExecutionContext => ({
    modifyMetadata,
    originalMetadata: { contributor },
    modifiedMetadata: { contributor },
  });

  beforeEach(() => {
    modifyMetadata.mockReset();
    modifyMetadata.mockReturnValue({ success: true });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://api.ror.org/')) {
        const raw = decodeURIComponent(url.split('affiliation=')[1]);
        const chosen =
          raw === 'CatalystNeuro'
            ? { id: 'https://ror.org/01d74sk53', names: [{ value: 'CatalystNeuro', types: ['ror_display'] }] }
            : raw.includes('Lawrence Berkeley National Laboratory')
              ? { id: 'https://ror.org/02jbv0t02', names: [{ value: 'Lawrence Berkeley National Laboratory', types: ['ror_display'] }] }
              : null;
        return { ok: true, status: 200, json: async () => ({ items: chosen ? [{ chosen: true, score: 1, organization: chosen }] : [] }) };
      }
      return { ok: true, status: 200, json: async () => fixture };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the work by DOI and proposes the merged contributor list', async () => {
    const { result } = await importContributorsTool.execute(
      { doi: 'https://doi.org/10.7554/eLife.78362' },
      context([]),
    );
    const parsed = JSON.parse(result);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.openalex.org/works/doi:10.7554%2FeLife.78362?select=id,doi,title,authorships',
    );
    expect(parsed).toMatchObject({ success: true, applied: true, doi: '10.7554/eLife.78362', authorCount: 4 });
    expect(parsed.added).toHaveLength(4);
    expect(parsed.affiliationSources).toEqual({ ror: 4, openalex: 0, unresolved: 0 });
    expect(parsed.unresolvedAffiliations).toEqual([]);
    expect(parsed.contributors[3].affiliation).toEqual([
      { schemaKey: 'Affiliation', name: 'CatalystNeuro', identifier: 'https://ror.org/01d74sk53' },
    ]);
    // one OpenAlex request plus one ROR request per distinct raw affiliation
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
    expect(modifyMetadata).toHaveBeenCalledTimes(1);
    const [op, path, value] = modifyMetadata.mock.calls[0];
    expect(op).toBe('set');
    expect(path).toBe('contributor');
    expect(value.map((c: { name: string }) => c.name)).toEqual(['Rübel, Oliver', 'Tritt, Andrew', 'Ly, Ryan', 'Dichter, Ben']);
  });

  it('reports without applying on a dry run', async () => {
    const { result } = await importContributorsTool.execute({ doi: '10.7554/eLife.78362', dryRun: true }, context([]));
    const parsed = JSON.parse(result);
    expect(parsed.applied).toBe(false);
    expect(parsed.added).toHaveLength(4);
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when every author is already present with the same details', async () => {
    const preview = JSON.parse(
      (await importContributorsTool.execute({ doi: '10.7554/eLife.78362', dryRun: true }, context([]))).result,
    );
    const { result } = await importContributorsTool.execute({ doi: '10.7554/eLife.78362' }, context(preview.contributors));
    expect(JSON.parse(result).applied).toBe(false);
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('surfaces a validation rejection from modifyMetadata', async () => {
    modifyMetadata.mockReturnValue({ success: false, error: 'Error at /contributor/0: bad' });
    const { result } = await importContributorsTool.execute({ doi: '10.7554/eLife.78362' }, context([]));
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('/contributor/0');
  });

  it('reports unresolved affiliations when neither ROR nor OpenAlex confirms them', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('https://api.ror.org/')
        ? { ok: true, status: 200, json: async () => ({ items: [] }) }
        : { ok: true, status: 200, json: async () => fixture },
    );
    const { result } = await importContributorsTool.execute({ doi: '10.7554/eLife.78362', dryRun: true }, context([]));
    const parsed = JSON.parse(result);
    expect(parsed.affiliationSources).toEqual({ ror: 0, openalex: 3, unresolved: 1 });
    expect(parsed.unresolvedAffiliations).toEqual([{ author: 'Dichter, Ben', affiliation: 'CatalystNeuro' }]);
  });

  it('handles an unknown DOI and an input with no DOI', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
    const missing = JSON.parse((await importContributorsTool.execute({ doi: '10.9999/nothing' }, context([]))).result);
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/no record/);

    const none = JSON.parse((await importContributorsTool.execute({ doi: 'not a doi' }, context([]))).result);
    expect(none.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
