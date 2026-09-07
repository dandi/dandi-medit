import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanAwardNumber,
  fundersToContributors,
  fundersWithoutAward,
  fundersWithoutRor,
  importFundersTool,
  mergeFunders,
  normalizeOrganizationName,
  type FunderContributor,
  type OpenAlexFundingWork,
} from './importFunders';
import fixture from './__fixtures__/openalex-neuron-2016-funders.json';
import type { ToolExecutionContext } from '../types';

const work = fixture as OpenAlexFundingWork;

const NIMH = 'National Institute of Mental Health';
const NINDS = 'National Institute of Neurological Disorders and Stroke';
const NICHD = 'Eunice Kennedy Shriver National Institute of Child Health and Human Development';

describe('cleanAwardNumber', () => {
  it.each([
    ['K08MH107662', 'K08MH107662'],
    ['  U01 NS090583 ', 'U01 NS090583'],
    ['Grant No. 12345', '12345'],
    ['Award #7', '7'],
    ['#R01MH054671', 'R01MH054671'],
    ['Grant-2020-001', 'Grant-2020-001'],
  ])('cleans %j to %j', (input, expected) => {
    expect(cleanAwardNumber(input)).toBe(expected);
  });

  it('returns null when there is no award number', () => {
    expect(cleanAwardNumber(null)).toBeNull();
    expect(cleanAwardNumber(undefined)).toBeNull();
    expect(cleanAwardNumber('   ')).toBeNull();
  });
});

describe('normalizeOrganizationName', () => {
  it('ignores case, punctuation, spacing and diacritics', () => {
    expect(normalizeOrganizationName('National Institutes of Health')).toBe(
      normalizeOrganizationName('  national institutes  of health '),
    );
    expect(normalizeOrganizationName('Université de Genève')).toBe(normalizeOrganizationName('Universite de Geneve'));
    expect(normalizeOrganizationName('Howard Hughes Medical Institute.')).toBe(
      normalizeOrganizationName('Howard Hughes Medical Institute'),
    );
    expect(normalizeOrganizationName('NIMH')).not.toBe(normalizeOrganizationName('NINDS'));
  });
});

describe('fundersToContributors', () => {
  it('builds one Organization entry per award, in funder order', () => {
    const entries = fundersToContributors(work);
    expect(entries.map((e) => [e.name, e.awardNumber])).toEqual([
      [NIMH, 'K08MH107662'],
      [NIMH, 'R01 MH054671'],
      [NIMH, 'R01 MH107396'],
      [NINDS, 'U01 NS090583'],
      [NINDS, 'U01 NS090526'],
      [NICHD, 'K12HD000850'],
    ]);
    expect(entries[0]).toEqual({
      schemaKey: 'Organization',
      name: NIMH,
      identifier: 'https://ror.org/04xeg9z08',
      roleName: ['dcite:Funder'],
      awardNumber: 'K08MH107662',
      includeInCitation: false,
    });
    for (const entry of entries) {
      expect(entry.identifier).toMatch(/^https:\/\/ror\.org\/[a-z0-9]+$/);
      expect(entry.roleName).toEqual(['dcite:Funder']);
      expect(entry.includeInCitation).toBe(false);
    }
    expect(fundersWithoutAward(work)).toEqual([]);
    expect(fundersWithoutRor(work)).toEqual([]);
  });

  it('strips descriptive prefixes and surrounding whitespace from award numbers', () => {
    const entries = fundersToContributors({
      funders: [{ id: 'F1', display_name: 'Wellcome Trust', ror: 'https://ror.org/029chgv08' }],
      awards: [
        { funder_id: 'F1', funder_award_id: 'Grant No. 209558/Z/17/Z' },
        { funder_id: 'F1', funder_award_id: '  212250/Z/18/Z  ' },
      ],
    });
    expect(entries.map((e) => e.awardNumber)).toEqual(['209558/Z/17/Z', '212250/Z/18/Z']);
  });

  it('gives a funder with no award a single entry and reports it', () => {
    const partial: OpenAlexFundingWork = {
      funders: [
        { id: 'F1', display_name: 'Simons Foundation', ror: 'https://ror.org/01cmp9s95' },
        { id: 'F2', display_name: 'Kavli Foundation', ror: null },
      ],
      awards: [{ funder_id: 'F1', funder_award_id: '543023' }],
    };
    const entries = fundersToContributors(partial);
    expect(entries).toEqual([
      {
        schemaKey: 'Organization',
        name: 'Simons Foundation',
        identifier: 'https://ror.org/01cmp9s95',
        roleName: ['dcite:Funder'],
        awardNumber: '543023',
        includeInCitation: false,
      },
      {
        schemaKey: 'Organization',
        name: 'Kavli Foundation',
        roleName: ['dcite:Funder'],
        includeInCitation: false,
      },
    ]);
    expect(fundersWithoutAward(partial)).toEqual(['Kavli Foundation']);
    expect(fundersWithoutRor(partial)).toEqual(['Kavli Foundation']);
  });

  it('does not invent a ROR when OpenAlex has none or an unusable one', () => {
    const entries = fundersToContributors({
      funders: [
        { id: 'F1', display_name: 'Some Foundation', ror: null },
        { id: 'F2', display_name: 'Other Foundation', ror: 'ror.org/ABC' },
      ],
      awards: [{ funder_id: 'F1', funder_award_id: '1' }],
    });
    expect(entries.every((e) => e.identifier === undefined)).toBe(true);
  });

  it('keeps an award whose funder is missing from the funders list', () => {
    const entries = fundersToContributors({
      funders: [],
      awards: [{ funder_id: 'F9', funder_award_id: 'ABC-1', funder_display_name: 'Orphan Trust' }],
    });
    expect(entries).toEqual([
      {
        schemaKey: 'Organization',
        name: 'Orphan Trust',
        roleName: ['dcite:Funder'],
        awardNumber: 'ABC-1',
        includeInCitation: false,
      },
    ]);
  });

  it('returns nothing when OpenAlex lists no funding', () => {
    expect(fundersToContributors({})).toEqual([]);
  });
});

describe('mergeFunders', () => {
  const imported = fundersToContributors(work);
  const author = {
    schemaKey: 'Person',
    name: 'Watson, Brendon O',
    roleName: ['dcite:Author'],
    includeInCitation: true,
  };

  it('appends new funders after the existing contributors', () => {
    const result = mergeFunders([author], imported);
    expect(result.contributors[0]).toEqual(author);
    expect(result.contributors).toHaveLength(7);
    expect(result.added).toHaveLength(6);
    expect(result.matched).toEqual([]);
  });

  it('is idempotent', () => {
    const once = mergeFunders([author], imported);
    const twice = mergeFunders(once.contributors, imported);
    expect(twice.contributors).toEqual(once.contributors);
    expect(twice.added).toEqual([]);
    expect(twice.matched).toHaveLength(6);
  });

  it('matches by ROR even when the name is spelled differently, keeping the existing entry', () => {
    const existing = {
      schemaKey: 'Organization',
      name: 'NIMH',
      identifier: 'https://ror.org/04xeg9z08',
      roleName: ['dcite:Sponsor'],
      awardNumber: 'K08MH107662',
      includeInCitation: true,
    };
    const result = mergeFunders([existing], imported);
    expect(result.matched).toEqual(['NIMH']);
    expect(result.contributors[0]).toEqual(existing);
    expect(result.added).toHaveLength(5);
  });

  it('matches by normalized name and fills in a missing ROR', () => {
    const existing = {
      schemaKey: 'Organization',
      name: 'national institute of mental health',
      roleName: ['dcite:Funder'],
      awardNumber: 'R01 MH054671',
    };
    const result = mergeFunders([existing], imported);
    const merged = result.contributors[0];
    expect(merged.name).toBe('national institute of mental health');
    expect(merged.roleName).toEqual(['dcite:Funder']);
    expect(merged.identifier).toBe('https://ror.org/04xeg9z08');
    expect(result.matched).toEqual(['national institute of mental health']);
  });

  it('fills the award number into an existing funder that has none', () => {
    const existing = {
      schemaKey: 'Organization',
      name: NICHD,
      roleName: ['dcite:Funder'],
      includeInCitation: false,
    };
    const result = mergeFunders([existing], imported);
    expect(result.contributors[0].awardNumber).toBe('K12HD000850');
    expect(result.contributors).toHaveLength(6);
    const twice = mergeFunders(result.contributors, imported);
    expect(twice.contributors).toEqual(result.contributors);
  });

  it('does not match a contributor that has no funding role', () => {
    const person = { schemaKey: 'Person', name: NIMH, roleName: ['dcite:Author'] };
    const result = mergeFunders([person], imported);
    expect(result.matched).toEqual([]);
    expect(result.contributors).toHaveLength(7);
    expect(result.contributors[0]).toEqual(person);
  });

  it('keeps a different award from the same funder as its own entry', () => {
    const existing = {
      schemaKey: 'Organization',
      name: NINDS,
      identifier: 'https://ror.org/01s5ya894',
      roleName: ['dcite:Funder'],
      awardNumber: 'U01 NS090583',
    };
    const result = mergeFunders([existing], imported);
    const ninds = result.contributors.filter((c: FunderContributor) => c.name === NINDS);
    expect(ninds.map((c: FunderContributor) => c.awardNumber)).toEqual(['U01 NS090583', 'U01 NS090526']);
  });
});

describe('import_funders_from_publication tool', () => {
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
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => fixture });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the funding record by DOI and proposes the merged contributor list', async () => {
    const { result } = await importFundersTool.execute(
      { doi: 'https://doi.org/10.1016/j.neuron.2016.03.036' },
      context([]),
    );
    const parsed = JSON.parse(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.openalex.org/works/doi:10.1016%2Fj.neuron.2016.03.036?select=id,doi,title,funders,awards',
    );
    expect(parsed).toMatchObject({
      success: true,
      applied: true,
      doi: '10.1016/j.neuron.2016.03.036',
      funderEntryCount: 6,
    });
    expect(parsed.fundersWithoutAward).toEqual([]);
    expect(parsed.fundersWithoutRor).toEqual([]);
    expect(modifyMetadata).toHaveBeenCalledTimes(1);
    const [op, path, value] = modifyMetadata.mock.calls[0];
    expect(op).toBe('set');
    expect(path).toBe('contributor');
    expect(value.map((c: FunderContributor) => c.awardNumber)).toEqual([
      'K08MH107662',
      'R01 MH054671',
      'R01 MH107396',
      'U01 NS090583',
      'U01 NS090526',
      'K12HD000850',
    ]);
  });

  it('reports without applying on a dry run', async () => {
    const { result } = await importFundersTool.execute(
      { doi: '10.1016/j.neuron.2016.03.036', dryRun: true },
      context([]),
    );
    const parsed = JSON.parse(result);
    expect(parsed.applied).toBe(false);
    expect(parsed.added).toHaveLength(6);
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when every funder is already present with the same details', async () => {
    const preview = JSON.parse(
      (await importFundersTool.execute({ doi: '10.1016/j.neuron.2016.03.036', dryRun: true }, context([]))).result,
    );
    const { result } = await importFundersTool.execute(
      { doi: '10.1016/j.neuron.2016.03.036' },
      context(preview.contributors),
    );
    expect(JSON.parse(result).applied).toBe(false);
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('surfaces a validation rejection from modifyMetadata', async () => {
    modifyMetadata.mockReturnValue({ success: false, error: 'Error at /contributor/0: bad' });
    const { result } = await importFundersTool.execute({ doi: '10.1016/j.neuron.2016.03.036' }, context([]));
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('/contributor/0');
  });

  it('reports funders that OpenAlex lists without an award or a ROR', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'A paper',
        funders: [{ id: 'F1', display_name: 'Kavli Foundation', ror: null }],
        awards: [],
      }),
    });
    const { result } = await importFundersTool.execute(
      { doi: '10.1016/j.neuron.2016.03.036', dryRun: true },
      context([]),
    );
    const parsed = JSON.parse(result);
    expect(parsed.fundersWithoutAward).toEqual(['Kavli Foundation']);
    expect(parsed.fundersWithoutRor).toEqual(['Kavli Foundation']);
  });

  it('reports when OpenAlex has no funding for the work', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ title: 'A paper', funders: [], awards: [] }) });
    const { result } = await importFundersTool.execute({ doi: '10.1016/j.neuron.2016.03.036' }, context([]));
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/no funders/);
    expect(modifyMetadata).not.toHaveBeenCalled();
  });

  it('handles an unknown DOI and an input with no DOI', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
    const missing = JSON.parse((await importFundersTool.execute({ doi: '10.9999/nothing' }, context([]))).result);
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/no record/);

    const none = JSON.parse((await importFundersTool.execute({ doi: 'not a doi' }, context([]))).result);
    expect(none.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
