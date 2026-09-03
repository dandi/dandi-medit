import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ProposalData,
  computeMetadataHash,
  createProposalLink,
  parseProposalFromUrl,
  validateAndApplyProposal,
} from './proposalLink';
import type { DandisetMetadata } from '../types/dandiset';

// A small metadata object with nested structure. The nested keys (roleName,
// email, relation) are deliberately not top-level dandiset keys, because the
// original bug was that JSON.stringify with a replacer array dropped exactly
// those from the hashed representation.
const baseMetadata = {
  name: 'Test dandiset',
  description: 'A description',
  contributor: [
    {
      name: 'Lovelace, Ada',
      schemaKey: 'Person',
      roleName: ['dcite:ContactPerson'],
      email: 'ada@example.org',
      affiliation: [{ name: 'Analytical Engine Co', schemaKey: 'Affiliation' }],
    },
  ],
  relatedResource: [
    { url: 'https://doi.org/10.1/abc', relation: 'dcite:IsDescribedBy', schemaKey: 'Resource' },
  ],
  keywords: ['b', 'a'],
} as unknown as DandisetMetadata;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('computeMetadataHash', () => {
  it('returns a 64 character lowercase hex SHA-256 digest', async () => {
    const hash = await computeMetadataHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // sha256 of the string {"a":1}
    expect(hash).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  });

  it('hashes the canonical form, with nested keys sorted', async () => {
    const hash = await computeMetadataHash({ b: { y: 2, x: [{ q: 1, p: 2 }] }, a: 1 });
    // sha256 of the string {"a":1,"b":{"x":[{"p":2,"q":1}],"y":2}}
    expect(hash).toBe('511133fc8705ae81a1cbc0727285d8f24d4a741024b4e4ec01cbac449811f21c');
  });

  it('is independent of key order at every level of nesting', async () => {
    const reordered = {
      keywords: ['b', 'a'],
      relatedResource: [
        { schemaKey: 'Resource', relation: 'dcite:IsDescribedBy', url: 'https://doi.org/10.1/abc' },
      ],
      contributor: [
        {
          affiliation: [{ schemaKey: 'Affiliation', name: 'Analytical Engine Co' }],
          email: 'ada@example.org',
          roleName: ['dcite:ContactPerson'],
          schemaKey: 'Person',
          name: 'Lovelace, Ada',
        },
      ],
      description: 'A description',
      name: 'Test dandiset',
    };
    expect(await computeMetadataHash(reordered)).toBe(await computeMetadataHash(baseMetadata));
  });

  it('changes when a nested field that is not a top-level key changes', async () => {
    const original = await computeMetadataHash(baseMetadata);

    const roleChanged = clone(baseMetadata);
    roleChanged.contributor[0].roleName = ['dcite:Author'];
    expect(await computeMetadataHash(roleChanged)).not.toBe(original);

    const emailChanged = clone(baseMetadata);
    emailChanged.contributor[0].email = 'someone@example.org';
    expect(await computeMetadataHash(emailChanged)).not.toBe(original);

    const relationChanged = clone(baseMetadata);
    relationChanged.relatedResource[0].relation = 'dcite:IsSupplementTo';
    expect(await computeMetadataHash(relationChanged)).not.toBe(original);
  });

  it('is sensitive to array order', async () => {
    const swapped = clone(baseMetadata);
    swapped.keywords = ['a', 'b'];
    expect(await computeMetadataHash(swapped)).not.toBe(await computeMetadataHash(baseMetadata));
  });

  it('handles null, primitives and unicode', async () => {
    const withNull = { a: null, b: 'héllo ✓', c: true, d: 1.5 };
    // sha256 of the UTF-8 bytes of {"a":null,"b":"héllo ✓","c":true,"d":1.5}
    expect(await computeMetadataHash(withNull)).toBe(
      '6a6b0b2bfe6a0d063dc0cd197e80a6bead572c654d51dbf4a8741669718b3f13',
    );
  });
});

describe('proposal link round trip', () => {
  const location = { href: 'http://localhost:5173/?dandiset=000003&version=draft', search: '' };

  beforeEach(() => {
    vi.stubGlobal('window', { location, history: { replaceState: vi.fn() } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when there are no changes', async () => {
    expect(await createProposalLink('000003', baseMetadata, clone(baseMetadata))).toBeNull();
  });

  it('encodes the hash and delta and parses them back from the URL', async () => {
    const modified = clone(baseMetadata);
    modified.name = 'Renamed dandiset ✓';
    modified.contributor[0].email = 'new@example.org';

    const link = await createProposalLink('000003', baseMetadata, modified);
    expect(link).not.toBeNull();

    const url = new URL(link!);
    expect(url.searchParams.get('dandiset')).toBe('000003');
    expect(url.searchParams.get('review')).toBe('1');
    expect(url.searchParams.has('version')).toBe(false);

    location.search = url.search;
    const proposal = parseProposalFromUrl();
    expect(proposal).not.toBeNull();
    expect(proposal!.h).toBe(await computeMetadataHash(baseMetadata));
    expect(proposal!.d).toBeDefined();
  });

  it('returns null for a missing or malformed proposal parameter', () => {
    location.search = '';
    expect(parseProposalFromUrl()).toBeNull();

    location.search = '?proposal=not-base64!';
    expect(parseProposalFromUrl()).toBeNull();

    location.search = `?proposal=${btoa(JSON.stringify({ h: 'x' }))}`;
    expect(parseProposalFromUrl()).toBeNull();
  });
});

describe('validateAndApplyProposal', () => {
  it('applies the delta when the current metadata matches the hash', async () => {
    const modified = clone(baseMetadata);
    modified.name = 'Renamed dandiset';
    modified.contributor[0].roleName = ['dcite:Author', 'dcite:ContactPerson'];

    vi.stubGlobal('window', {
      location: { href: 'http://localhost/', search: '' },
      history: { replaceState: vi.fn() },
    });
    const link = await createProposalLink('000003', baseMetadata, modified);
    vi.stubGlobal('window', {
      location: { href: link, search: new URL(link!).search },
      history: { replaceState: vi.fn() },
    });
    const proposal = parseProposalFromUrl()!;
    vi.unstubAllGlobals();

    const result = await validateAndApplyProposal(proposal, clone(baseMetadata));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.modifiedMetadata).toEqual(modified);
    }
  });

  it('accepts current metadata whose keys are in a different order', async () => {
    const proposal: ProposalData = {
      h: await computeMetadataHash(baseMetadata),
      d: { name: ['Test dandiset', 'Renamed'] as [string, string] },
    };
    const reordered = { keywords: ['b', 'a'], ...clone(baseMetadata) };
    const result = await validateAndApplyProposal(proposal, reordered as DandisetMetadata);
    expect(result.success).toBe(true);
  });

  it('rejects the proposal when a nested field has changed since it was created', async () => {
    const proposal: ProposalData = {
      h: await computeMetadataHash(baseMetadata),
      d: { name: ['Test dandiset', 'Renamed'] as [string, string] },
    };
    const drifted = clone(baseMetadata);
    drifted.contributor[0].roleName = ['dcite:Author'];

    const result = await validateAndApplyProposal(proposal, drifted);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/metadata has changed/);
    }
  });
});
