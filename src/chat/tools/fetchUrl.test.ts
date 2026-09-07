import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPassages, fetchUrlTool } from './fetchUrl';
import type { ToolExecutionContext } from '../types';

const context: ToolExecutionContext = { modifyMetadata: vi.fn(), originalMetadata: null, modifiedMetadata: null };

const article =
  'Introduction. Sleep is a state of the brain. Methods. Mice were housed in the home cage. ' +
  'All protocols were approved by the Institutional Animal Care and Use Committee of New York University. ' +
  'Recordings used silicon probes. Results. Firing rates fell during sleep. Discussion. This matters.';

describe('extractPassages', () => {
  it('returns matching sentences with one sentence of context on each side', () => {
    const { excerpt, matches } = extractPassages(article, 'IACUC|Animal Care|approved');
    expect(matches).toBe(1);
    expect(excerpt).toBe(
      '1. Mice were housed in the home cage. All protocols were approved by the Institutional Animal Care and Use Committee of New York University. Recordings used silicon probes.',
    );
  });

  it('merges consecutive hits into one passage and numbers separate ones', () => {
    const { excerpt, matches } = extractPassages(article, 'sleep');
    expect(matches).toBe(2);
    expect(excerpt.split('\n\n')).toHaveLength(2);
    expect(excerpt).toMatch(/^1\. Introduction\. Sleep is a state of the brain\. Methods\./);
    expect(excerpt).toMatch(/\n\n2\. Results\. Firing rates fell during sleep\. Discussion\./);
  });

  it('is case insensitive, treats terms literally, and reports zero matches', () => {
    expect(extractPassages(article, 'ANIMAL CARE').matches).toBe(1);
    expect(extractPassages(article, 'a.b').matches).toBe(0);
    expect(extractPassages(article, 'nothing here|also nothing')).toEqual({ excerpt: '', matches: 0 });
    expect(extractPassages(article, ' | ')).toEqual({ excerpt: '', matches: 0 });
  });
});

describe('fetch_url publication path', () => {
  const fetchMock = vi.fn();

  const europePmcRecord = {
    pmid: '27133462',
    pmcid: 'PMC4873379',
    doi: '10.1016/j.neuron.2016.03.036',
    title: 'Network Homeostasis and State Dynamics of Neocortical Sleep',
    journalInfo: { journal: { title: 'Neuron' } },
    pubYear: '2016',
    abstractText: '<p>Sleep abstract.</p>',
    isOpenAccess: 'N',
  };

  const respond = (routes: Record<string, { status: number; body: string | object }>) =>
    fetchMock.mockImplementation(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      const { status, body } = routes[key];
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        headers: new Headers({ 'content-type': typeof body === 'string' ? 'application/xml' : 'application/json' }),
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      };
    });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_CORS_PROXY_URL', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('falls back to PubMed Central through NCBI when Europe PMC has no full text', async () => {
    respond({
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search': { status: 200, body: { resultList: { result: [europePmcRecord] } } },
      'https://api.openalex.org/works/doi:': { status: 200, body: { id: 'W1', title: 'Network Homeostasis' } },
      'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4873379/fullTextXML': { status: 404, body: '' },
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi': {
        status: 200,
        body: `<pmc-articleset><article><body><p>${article}</p></body></article></pmc-articleset>`,
      },
    });
    const { result } = await fetchUrlTool.execute({ url: 'https://doi.org/10.1016/j.neuron.2016.03.036' }, context);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.content).toContain('Full text (PubMed Central PMC4873379 via NCBI E-utilities)');
    expect(parsed.content).toContain('Institutional Animal Care and Use Committee');
    expect(parsed.notes.join(' ')).toMatch(/Europe PMC has no full text for PMC4873379 \(HTTP 404\)/);
    const efetchCall = fetchMock.mock.calls.find(([u]) => (u as string).includes('efetch'));
    expect(efetchCall?.[0]).toBe('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=4873379&rettype=xml');
  });

  it('returns only matching passages when find is given', async () => {
    respond({
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search': { status: 200, body: { resultList: { result: [europePmcRecord] } } },
      'https://api.openalex.org/works/doi:': { status: 200, body: { id: 'W1' } },
      'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4873379/fullTextXML': {
        status: 200,
        body: `<article><body><p>${article}</p></body></article>`,
      },
    });
    const { result } = await fetchUrlTool.execute(
      { url: 'https://doi.org/10.1016/j.neuron.2016.03.036', find: 'IACUC|Animal Care|approved' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.content).toMatch(/^1 sentence mentions "IACUC\|Animal Care\|approved"/);
    expect(parsed.content).toContain('Institutional Animal Care and Use Committee');
    expect(parsed.content).not.toContain('Firing rates fell');
    expect(parsed.content.length).toBeLessThan(600);
    expect(parsed.notes.join(' ')).toMatch(/only matching passages are shown/);
  });

  it('says plainly when no full-text source has the paper', async () => {
    respond({
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search': { status: 200, body: { resultList: { result: [europePmcRecord] } } },
      'https://api.openalex.org/works/doi:': { status: 200, body: { id: 'W1' } },
      'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4873379/fullTextXML': { status: 404, body: '' },
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi': { status: 200, body: '<eFetchResult><ERROR>not found</ERROR></eFetchResult>' },
    });
    const { result } = await fetchUrlTool.execute({ url: 'https://pubmed.ncbi.nlm.nih.gov/27133462/' }, context);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.content).not.toContain('Full text (');
    expect(parsed.notes.join(' ')).toMatch(/PubMed Central has no full text for PMC4873379/);
    expect(parsed.notes.join(' ')).toMatch(/do not try other URLs for this paper/);
  });

  it('reports no PubMed Central record without trying full text sources', async () => {
    respond({
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search': { status: 200, body: { resultList: { result: [{ ...europePmcRecord, pmcid: undefined }] } } },
      'https://api.openalex.org/works/doi:': { status: 200, body: { id: 'W1' } },
    });
    const { result } = await fetchUrlTool.execute({ url: 'https://doi.org/10.1016/j.neuron.2016.03.036' }, context);
    const parsed = JSON.parse(result);
    expect(parsed.notes.join(' ')).toMatch(/no PubMed Central record/);
    expect(fetchMock.mock.calls.some(([u]) => (u as string).includes('efetch'))).toBe(false);
  });
});
