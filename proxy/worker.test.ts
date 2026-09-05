import { describe, expect, it } from 'vitest';
import {
  isAllowedOrigin,
  isAllowedTarget,
  parseAllowedOrigins,
  parseTargetUrl,
} from './worker.js';

describe('parseAllowedOrigins and isAllowedOrigin', () => {
  const origins = parseAllowedOrigins('https://medit.dandiarchive.org, http://localhost:5173/');

  it('parses a comma separated list and strips trailing slashes', () => {
    expect(origins).toEqual(['https://medit.dandiarchive.org', 'http://localhost:5173']);
  });

  it('matches a single wildcard host label for preview deployments', () => {
    const withPreviews = parseAllowedOrigins('https://medit.dandiarchive.org,https://*.dandi-medit.pages.dev');
    expect(isAllowedOrigin('https://feat-x.dandi-medit.pages.dev', withPreviews)).toBe(true);
    expect(isAllowedOrigin('https://abc123.dandi-medit.pages.dev/', withPreviews)).toBe(true);
    expect(isAllowedOrigin('https://dandi-medit.pages.dev', withPreviews)).toBe(false);
    expect(isAllowedOrigin('https://a.b.dandi-medit.pages.dev', withPreviews)).toBe(false);
    expect(isAllowedOrigin('https://evil.dandi-medit.pages.dev.attacker.example', withPreviews)).toBe(false);
    expect(isAllowedOrigin('http://feat-x.dandi-medit.pages.dev', withPreviews)).toBe(false);
  });

  it('accepts listed origins and rejects others or none', () => {
    expect(isAllowedOrigin('https://medit.dandiarchive.org', origins)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', origins)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', origins)).toBe(false);
    expect(isAllowedOrigin('', origins)).toBe(false);
    expect(isAllowedOrigin(null, origins)).toBe(false);
  });
});

describe('isAllowedTarget', () => {
  it('accepts hosts on the shared allowlist, including subdomains', () => {
    expect(isAllowedTarget(new URL('https://en.wikipedia.org/wiki/Hippocampus'))).toBe(true);
    expect(isAllowedTarget(new URL('https://elifesciences.org/articles/78362'))).toBe(true);
    expect(isAllowedTarget(new URL('https://www.ebi.ac.uk/ols4/api/search'))).toBe(true);
  });

  it('rejects hosts off the allowlist and lookalikes', () => {
    expect(isAllowedTarget(new URL('https://example.com/'))).toBe(false);
    expect(isAllowedTarget(new URL('https://notwikipedia.org/'))).toBe(false);
    expect(isAllowedTarget(new URL('https://wikipedia.org.evil.example/'))).toBe(false);
    expect(isAllowedTarget(new URL('ftp://wikipedia.org/'))).toBe(false);
  });
});

describe('parseTargetUrl', () => {
  it('reads the bare encoded query string used by the {url} template', () => {
    const target = parseTargetUrl(
      `https://proxy.example/?${encodeURIComponent('https://doi.org/10.1/abc?x=1&y=2')}`,
    );
    expect(target?.toString()).toBe('https://doi.org/10.1/abc?x=1&y=2');
  });

  it('reads a url query parameter', () => {
    const target = parseTargetUrl(
      `https://proxy.example/?url=${encodeURIComponent('https://en.wikipedia.org/wiki/A')}`,
    );
    expect(target?.toString()).toBe('https://en.wikipedia.org/wiki/A');
  });

  it('returns null for a missing or unparsable target', () => {
    expect(parseTargetUrl('https://proxy.example/')).toBeNull();
    expect(parseTargetUrl('https://proxy.example/?not-a-url')).toBeNull();
  });
});
