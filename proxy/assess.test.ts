import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssessmentKey,
  buildAssessmentMessages,
  handleAssess,
  parseAssessment,
  validateAssessmentInput,
} from './assess.js';

const verdict = {
  titleInformative: { pass: true, reason: 'Names region, preparation and task.' },
  descriptionInformative: { pass: false, reason: 'Does not say why the data were collected.' },
  methodologySummary: { pass: true, reason: 'Silicon probes during a maze task.' },
};

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

const request = (body: unknown) =>
  new Request('https://worker.example/assess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const headers = { 'Access-Control-Allow-Origin': 'https://medit.dandiarchive.org' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAssessmentKey', () => {
  it('is stable for the same input and changes with any input', async () => {
    const a = await buildAssessmentKey('m', 'Title', 'Desc');
    expect(a).toMatch(/^assess:v1:[0-9a-f]{64}$/);
    expect(await buildAssessmentKey('m', 'Title', 'Desc')).toBe(a);
    expect(await buildAssessmentKey('other-model', 'Title', 'Desc')).not.toBe(a);
    expect(await buildAssessmentKey('m', 'Title', 'Desc.')).not.toBe(a);
    expect(await buildAssessmentKey('m', 'Titl', 'eDesc')).not.toBe(a);
  });
});

describe('parseAssessment', () => {
  it('accepts a bare object and one wrapped in prose or a code fence', () => {
    expect(parseAssessment(JSON.stringify(verdict))).toEqual(verdict);
    expect(parseAssessment('Here you go:\n```json\n' + JSON.stringify(verdict) + '\n```')).toEqual(verdict);
  });

  it('rejects missing items, wrong types, and non-JSON', () => {
    expect(parseAssessment('no json here')).toBeNull();
    expect(parseAssessment(JSON.stringify({ titleInformative: verdict.titleInformative }))).toBeNull();
    expect(parseAssessment(JSON.stringify({ ...verdict, methodologySummary: { pass: 'yes', reason: 'x' } }))).toBeNull();
    expect(parseAssessment(undefined as unknown as string)).toBeNull();
  });

  it('recovers verdicts when a reason contains an unescaped double quote', () => {
    const text = '{"titleInformative": {"pass": true, "reason": "Names "motor cortex" and the cell types."}, "descriptionInformative": {"pass": false, "reason": "Restates the title."}, "methodologySummary": {"pass": true, "reason": "Patch-seq recordings."}}';
    expect(parseAssessment(text)).toEqual({
      titleInformative: { pass: true, reason: 'Names "motor cortex" and the cell types.' },
      descriptionInformative: { pass: false, reason: 'Restates the title.' },
      methodologySummary: { pass: true, reason: 'Patch-seq recordings.' },
    });
  });

  it('trims and caps the reasons', () => {
    const long = { ...verdict, titleInformative: { pass: true, reason: '  ' + 'x'.repeat(500) } };
    expect(parseAssessment(JSON.stringify(long))!.titleInformative.reason).toHaveLength(300);
  });
});

describe('validateAssessmentInput and buildAssessmentMessages', () => {
  it('trims fields and enforces length limits', () => {
    expect(validateAssessmentInput({ title: ' T ', description: ' D ' })).toEqual({ title: 'T', description: 'D' });
    expect(validateAssessmentInput({ title: 'x'.repeat(1001) }).error).toMatch(/title/);
    expect(validateAssessmentInput({ description: 'x'.repeat(20001) }).error).toMatch(/description/);
    expect(validateAssessmentInput(null).error).toBeDefined();
  });

  it('puts the rubric in the system message and the text in the user message', () => {
    const [system, user] = buildAssessmentMessages('My title', 'My description');
    expect(system.role).toBe('system');
    expect(system.content).toContain('titleInformative');
    expect(user.content).toBe('Title:\nMy title\n\nDescription:\nMy description');
  });
});

describe('handleAssess', () => {
  it('returns a cached verdict without calling the model', async () => {
    const key = await buildAssessmentKey('deepseek/deepseek-v4-flash-0731', 'T', 'D');
    const kv = fakeKv({ [key]: JSON.stringify({ assessment: verdict, model: 'deepseek/deepseek-v4-flash-0731' }) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleAssess(request({ title: 'T', description: 'D' }), { ASSESSMENTS: kv, OPENROUTER_API_KEY: 'k' }, headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assessment: verdict, cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://medit.dandiarchive.org');
  });

  it('calls the model on a miss, caches the verdict, and reports cached: false', async () => {
    const kv = fakeKv();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('custom/model');
      expect(body.messages[1].content).toContain('My title');
      expect(body.max_tokens).toBeGreaterThanOrEqual(1000);
      expect(body.response_format).toEqual({ type: 'json_object' });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const res = await handleAssess(
      request({ title: 'My title', description: 'My description' }),
      { ASSESSMENTS: kv, OPENROUTER_API_KEY: 'k', ASSESS_MODEL: 'custom/model', ASSESS_LIMITER: limiter },
      headers,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assessment: verdict, model: 'custom/model', cached: false });
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(kv.put).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(kv.store.get(await buildAssessmentKey('custom/model', 'My title', 'My description'))!);
    expect(stored.assessment).toEqual(verdict);
  });

  it('falls back to the reasoning field when the content is empty', async () => {
    const kv = fakeKv();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '', reasoning: 'Thinking... ' + JSON.stringify(verdict) } }] }) })));
    const res = await handleAssess(request({ title: 'T', description: 'D' }), { ASSESSMENTS: kv, OPENROUTER_API_KEY: 'k' }, headers);
    expect(res.status).toBe(200);
    expect((await res.json()).assessment).toEqual(verdict);
  });

  it('does not cache a malformed model reply', async () => {
    const kv = fakeKv();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) })));
    const res = await handleAssess(request({ title: 'T', description: 'D' }), { ASSESSMENTS: kv, OPENROUTER_API_KEY: 'k' }, headers);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ detail: 'not json', finishReason: null });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects bad input, refuses when unconfigured, and honours the rate limit', async () => {
    expect((await handleAssess(request('nope'), {}, headers)).status).toBe(400);
    expect((await handleAssess(request({ title: '', description: '' }), {}, headers)).status).toBe(400);
    expect((await handleAssess(request({ title: 'T' }), { ASSESSMENTS: fakeKv() }, headers)).status).toBe(503);
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const res = await handleAssess(request({ title: 'T' }), { ASSESSMENTS: fakeKv(), OPENROUTER_API_KEY: 'k', ASSESS_LIMITER: limiter }, headers);
    expect(res.status).toBe(429);
  });
});
