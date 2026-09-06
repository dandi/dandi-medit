import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessmentInputKey, fetchChecklistAssessment, getAssessmentEndpoint } from './assessment';

const verdict = {
  titleInformative: { pass: true, reason: 'ok' },
  descriptionInformative: { pass: false, reason: 'missing why' },
  methodologySummary: { pass: true, reason: 'ok' },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_CORS_PROXY_URL', 'https://worker.example/?{url}');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getAssessmentEndpoint', () => {
  it('derives the endpoint from the worker origin in the proxy template', () => {
    expect(getAssessmentEndpoint()).toBe('https://worker.example/assess');
    vi.stubEnv('VITE_CORS_PROXY_URL', '');
    expect(getAssessmentEndpoint()).toBeNull();
  });
});

describe('assessmentInputKey', () => {
  it('ignores surrounding whitespace and distinguishes fields', () => {
    expect(assessmentInputKey(' T ', ' D ')).toBe(assessmentInputKey('T', 'D'));
    expect(assessmentInputKey('T', 'D')).not.toBe(assessmentInputKey('TD', ''));
  });
});

describe('fetchChecklistAssessment', () => {
  it('posts the trimmed title and description and returns the verdict', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ assessment: verdict, model: 'm', cached: true }) });
    const result = await fetchChecklistAssessment(' My title ', ' My description ');
    expect(result).toEqual({ assessment: verdict, model: 'm', cached: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://worker.example/assess');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'My title', description: 'My description' });
  });

  it('throws with the worker error message on a refusal', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Assessment is not configured on this deployment' }) });
    await expect(fetchChecklistAssessment('T', 'D')).rejects.toThrow(/not configured/);
  });

  it('throws on an incomplete verdict and when no endpoint is configured', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ assessment: { titleInformative: verdict.titleInformative } }) });
    await expect(fetchChecklistAssessment('T', 'D')).rejects.toThrow(/incomplete/);
    vi.stubEnv('VITE_CORS_PROXY_URL', '');
    await expect(fetchChecklistAssessment('T', 'D')).rejects.toThrow(/No assessment endpoint/);
  });
});
