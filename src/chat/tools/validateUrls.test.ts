import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateIdentifierInValue, validateOrcid, validateRorId, validateUrl } from './validateUrls';

/**
 * These tests cover the paths that are decided by pattern matching alone.
 * fetch is stubbed so that no test can reach the network; the stub also
 * lets us assert that format rejections happen before any request is made.
 */
const fetchMock = vi.fn();

function mockResponse(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(mockResponse(200));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateOrcid', () => {
  it.each([
    '0000-0002-1825-009',
    '0000-0002-1825-00977',
    '0000-0002-1825-009x',
    '000000021825009X',
    'https://orcid.org/0000-0002-1825-0097',
    'abcd-0002-1825-0097',
    '',
  ])('rejects the malformed ORCID %j without a network call', async (orcid) => {
    const result = await validateOrcid(orcid);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid ORCID format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a well-formed ORCID ending in a digit or X and checks it against the ORCID API', async () => {
    for (const orcid of ['0000-0002-1825-0097', '0000-0002-1825-009X']) {
      fetchMock.mockClear();
      const result = await validateOrcid(orcid);
      expect(result.isValid).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`https://pub.orcid.org/v3.0/${orcid}`);
    }
  });

  it('reports a well-formed ORCID that the API does not know', async () => {
    fetchMock.mockResolvedValue(mockResponse(404));
    const result = await validateOrcid('0000-0002-1825-0097');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('is lenient when the API fails for another reason', async () => {
    fetchMock.mockResolvedValue(mockResponse(500));
    expect((await validateOrcid('0000-0002-1825-0097')).isValid).toBe(true);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await validateOrcid('0000-0002-1825-0097')).isValid).toBe(true);
  });
});

describe('validateRorId', () => {
  it.each([
    'http://ror.org/05dxps055',
    'https://ror.org/',
    'https://ror.org/05DXPS055',
    'https://ror.org/05dxps055/',
    'ror.org/05dxps055',
    '05dxps055',
    'https://example.org/05dxps055',
  ])('rejects the malformed ROR ID %j without a network call', async (ror) => {
    const result = await validateRorId(ror);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid ROR ID format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a well-formed ROR URL and checks it against the ROR API', async () => {
    const result = await validateRorId('https://ror.org/05dxps055');
    expect(result.isValid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ror.org/organizations/05dxps055');
  });

  it('reports a well-formed ROR ID that the API does not know', async () => {
    fetchMock.mockResolvedValue(mockResponse(404));
    const result = await validateRorId('https://ror.org/05dxps055');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });
});

describe('validateUrl', () => {
  it.each(['ftp://example.org', 'example.org', 'mailto:someone@example.org', ''])(
    'rejects %j because it does not start with http(s) and makes no request',
    async (url) => {
      const result = await validateUrl(url);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/Invalid URL format/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an http(s) string that the URL parser cannot handle', async () => {
    const result = await validateUrl('https://exa mple.org/');
    expect(result.isValid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://doi.org/10.1000/xyz',
    'https://dx.doi.org/10.1000/xyz',
    'https://dandiarchive.org/dandiset/000001',
  ])('accepts %s without a network call', async (url) => {
    const result = await validateUrl(url);
    expect(result.isValid).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks other URLs through the CORS proxy', async () => {
    const result = await validateUrl('https://example.org/page');
    expect(result.isValid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://corsproxy.io/?${encodeURIComponent('https://example.org/page')}`,
    );
  });
});

describe('validateIdentifierInValue', () => {
  it('accepts null and undefined values', async () => {
    expect(await validateIdentifierInValue('contributor.0.identifier', null)).toEqual({ isValid: true });
    expect(await validateIdentifierInValue('contributor.0.identifier', undefined)).toEqual({ isValid: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a Person object whose identifier is not a valid ORCID', async () => {
    const result = await validateIdentifierInValue('contributor.0', {
      schemaKey: 'Person',
      name: 'Doe, Jane',
      identifier: '0000-0002-1825-009',
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid ORCID format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an Organization whose identifier is not a valid ROR URL', async () => {
    const result = await validateIdentifierInValue('contributor.0', {
      schemaKey: 'Organization',
      name: 'Some Institute',
      identifier: 'http://ror.org/05dxps055',
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid ROR ID format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a nested affiliation whose identifier is not a valid ROR URL', async () => {
    const result = await validateIdentifierInValue('contributor.0', {
      schemaKey: 'Person',
      name: 'Doe, Jane',
      affiliation: [{ schemaKey: 'Affiliation', name: 'X', identifier: 'ror.org/05dxps055' }],
    });
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid ROR ID format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes a contributor identifier string to the matching validator', async () => {
    await validateIdentifierInValue('contributor.0.identifier', '0000-0002-1825-0097');
    expect(fetchMock.mock.calls[0][0]).toBe('https://pub.orcid.org/v3.0/0000-0002-1825-0097');

    fetchMock.mockClear();
    await validateIdentifierInValue('contributor.0.identifier', 'https://ror.org/05dxps055');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ror.org/organizations/05dxps055');
  });

  it('passes a contributor identifier string that matches neither pattern through unchanged', async () => {
    // A bare string at this path that is neither an ORCID nor a ROR URL is
    // not validated at all today; this documents that behavior.
    const result = await validateIdentifierInValue('contributor.0.identifier', 'not-an-id');
    expect(result.isValid).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed url field without a network call', async () => {
    const result = await validateIdentifierInValue('contributor.0.url', 'www.example.org');
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid URL format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed entry in the protocol list without a network call', async () => {
    const result = await validateIdentifierInValue('protocol', [
      'https://doi.org/10.1000/xyz',
      'protocols.io/abc',
    ]);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Invalid URL format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
