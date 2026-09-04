import { describe, expect, it } from 'vitest';
import { computeChecklist, formatChecklistForPrompt, summarizeChecklist } from './checklist';

const complete = {
  name: 'Hippocampal CA1 recordings during theta maze exploration in mice',
  description: 'Silicon probe recordings from dorsal CA1 in freely moving mice performing a theta maze task, with position tracking.',
  license: ['spdx:CC-BY-4.0'],
  contributor: [
    {
      schemaKey: 'Person',
      name: 'Lovelace, Ada',
      identifier: '0000-0002-1825-0097',
      roleName: ['dcite:Author', 'dcite:ContactPerson'],
      affiliation: [{ schemaKey: 'Affiliation', name: 'Analytical Engine Co', identifier: 'https://ror.org/02jbv0t02' }],
    },
    {
      schemaKey: 'Organization',
      name: 'National Institute of Neurological Disorders and Stroke',
      roleName: ['dcite:Sponsor'],
      identifier: 'https://ror.org/01s5ya894',
      awardNumber: 'U01NS103792',
    },
  ],
  about: [{ schemaKey: 'Anatomy', name: 'hippocampus', identifier: 'http://purl.obolibrary.org/obo/UBERON_0002421' }],
  keywords: ['place cells', 'theta oscillations'],
  relatedResource: [
    { schemaKey: 'Resource', identifier: 'DOI:10.1038/s41597-020-0415-9', relation: 'dcite:IsDescribedBy', url: 'https://www.nature.com/articles/s41597-020-0415-9' },
  ],
  ethicsApproval: [{ schemaKey: 'EthicsApproval', identifier: 'IACUC 2019-0456' }],
};

const byId = (metadata: unknown) => Object.fromEntries(computeChecklist(metadata).map((i) => [i.id, i]));

describe('computeChecklist', () => {
  it('passes every rule for complete metadata and leaves judgment items pending', () => {
    const items = computeChecklist(complete);
    const rules = items.filter((i) => i.kind === 'rule');
    expect(rules.every((i) => i.status === 'pass')).toBe(true);
    expect(items.filter((i) => i.kind === 'assessment').every((i) => i.status === 'pending')).toBe(true);
    expect(summarizeChecklist(items)).toEqual({ passed: 9, failed: 0, pending: 3, total: 12, rulesPassed: 9, rulesTotal: 9 });
  });

  it('fails every rule for empty metadata with a reason each', () => {
    const items = computeChecklist({});
    for (const item of items.filter((i) => i.kind === 'rule')) {
      expect(item.status).toBe('fail');
      expect(item.detail.length).toBeGreaterThan(0);
    }
    expect(computeChecklist(null).filter((i) => i.kind === 'rule').every((i) => i.status === 'fail')).toBe(true);
  });

  it('applies a model assessment to the judgment items', () => {
    const items = computeChecklist(complete, {
      titleInformative: { pass: true, reason: 'Names the region, preparation and task.' },
      descriptionInformative: { pass: false, reason: 'Does not say why the data were collected.' },
    });
    const map = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(map.titleInformative.status).toBe('pass');
    expect(map.descriptionInformative).toMatchObject({ status: 'fail', detail: 'Does not say why the data were collected.' });
    expect(map.methodologySummary.status).toBe('pending');
  });

  it('names the people missing ORCIDs or ROR affiliations', () => {
    const map = byId({
      ...complete,
      contributor: [
        complete.contributor[0],
        { schemaKey: 'Person', name: 'Babbage, Charles', roleName: ['dcite:Author'], affiliation: [{ schemaKey: 'Affiliation', name: 'Cambridge' }] },
        { schemaKey: 'Person', name: 'Menabrea, Luigi', identifier: 'https://orcid.org/0000-0001-2345-6789', roleName: ['dcite:Author'] },
      ],
    });
    expect(map.orcids.status).toBe('fail');
    expect(map.orcids.detail).toBe('Missing ORCID: Babbage, Charles; Menabrea, Luigi');
    expect(map.affiliations.status).toBe('fail');
    expect(map.affiliations.detail).toContain('Babbage, Charles');
    expect(map.authors.status).toBe('pass');
  });

  it('requires the Author role, not just a person', () => {
    const map = byId({ ...complete, contributor: [{ ...complete.contributor[0], roleName: ['dcite:ContactPerson'] }] });
    expect(map.authors.status).toBe('fail');
    expect(map.authors.detail).toMatch(/dcite:Author/);
  });

  it('checks funders for award numbers and RORs and accepts either funder role', () => {
    const funder = complete.contributor[1];
    expect(byId({ ...complete, contributor: [{ ...funder, roleName: ['dcite:Funder'] }] }).funders.status).toBe('pass');
    const noAward = byId({ ...complete, contributor: [{ ...funder, awardNumber: '' }] });
    expect(noAward.funders.status).toBe('fail');
    expect(noAward.funders.detail).toMatch(/Missing award number/);
    const noRor = byId({ ...complete, contributor: [{ ...funder, identifier: undefined }] });
    expect(noRor.funders.detail).toMatch(/ROR/);
    expect(byId({ ...complete, contributor: [complete.contributor[0]] }).funders.detail).toMatch(/No funder/);
  });

  it('flags generic keywords and about entries without identifiers', () => {
    const generic = byId({ ...complete, keywords: ['Neuroscience', 'place cells', 'data'] });
    expect(generic.keywords.status).toBe('fail');
    expect(generic.keywords.detail).toContain('Neuroscience');
    expect(generic.keywords.detail).toContain('data');
    expect(byId({ ...complete, keywords: [] }).keywords.detail).toMatch(/No keywords/);
    const about = byId({ ...complete, about: [{ schemaKey: 'Anatomy', name: 'hippocampus' }] });
    expect(about.about.status).toBe('fail');
    expect(about.about.detail).toMatch(/no ontology identifier/);
  });

  it('recognizes DOIs in identifier or url form and requires a relation', () => {
    expect(byId({ ...complete, relatedResource: [{ url: 'https://doi.org/10.7554/eLife.78362', relation: 'dcite:IsDescribedBy' }] }).publication.status).toBe('pass');
    expect(byId({ ...complete, relatedResource: [{ identifier: 'doi:10.7554/eLife.78362', relation: 'dcite:IsDescribedBy' }] }).publication.status).toBe('pass');
    const noRelation = byId({ ...complete, relatedResource: [{ identifier: 'DOI:10.7554/eLife.78362' }] });
    expect(noRelation.publication.status).toBe('fail');
    expect(noRelation.publication.detail).toMatch(/no relation/);
    expect(byId({ ...complete, relatedResource: [{ url: 'https://github.com/x/y', relation: 'dcite:IsSupplementedBy' }] }).publication.detail).toMatch(/no related resource has a DOI/i);
  });

  it('requires an ethics approval identifier', () => {
    expect(byId({ ...complete, ethicsApproval: [] }).ethics.status).toBe('fail');
    expect(byId({ ...complete, ethicsApproval: [{ schemaKey: 'EthicsApproval', identifier: '' }] }).ethics.status).toBe('fail');
    expect(byId(complete).ethics.detail).toBe('IACUC 2019-0456');
  });
});

describe('formatChecklistForPrompt', () => {
  it('renders checkboxes with details and a summary line', () => {
    const text = formatChecklistForPrompt(computeChecklist({ ...complete, license: [] }));
    expect(text).toContain('- [ ] License specified: No license is set.');
    expect(text).toContain('- [x] Ethics approval recorded: IACUC 2019-0456');
    expect(text).toContain('- [?] Title is informative: Awaiting');
    expect(text).toContain('8 of 9 rule-based items pass; 3 items awaiting assessment.');
  });
});
