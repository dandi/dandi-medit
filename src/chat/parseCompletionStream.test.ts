import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeltaToToolCalls, parseCompletionStream } from './parseCompletionStream';

/**
 * Build a reader over a sequence of chunks. Strings are UTF-8 encoded;
 * Uint8Array chunks are passed through as-is so a test can split a
 * multi-byte character across chunk boundaries.
 */
function makeReader(chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return stream.getReader();
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentChunk(content: string) {
  return {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ finish_reason: null, delta: { role: 'assistant', content } }],
  };
}

function toolCallChunk(toolCalls: unknown[]) {
  return {
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ finish_reason: null, delta: { role: 'assistant', content: null, tool_calls: toolCalls } }],
  };
}

describe('parseCompletionStream', () => {
  beforeEach(() => {
    // The parser logs when it cannot parse a line; keep test output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accumulates text deltas and reports progress after each one', async () => {
    const onChunk = vi.fn();
    const reader = makeReader([
      sse(contentChunk('Hello')),
      sse(contentChunk(', ')),
      sse(contentChunk('world')),
      'data: [DONE]\n\n',
    ]);

    const result = await parseCompletionStream(reader, onChunk);

    expect(result.assistantContent).toBe('Hello, world');
    expect(result.toolCalls).toBeUndefined();
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(['Hello', 'Hello, ', 'Hello, world']);
  });

  it('handles several data lines arriving in a single chunk', async () => {
    const reader = makeReader([
      sse(contentChunk('a')) + sse(contentChunk('b')) + sse(contentChunk('c')) + 'data: [DONE]\n\n',
    ]);
    const result = await parseCompletionStream(reader);
    expect(result.assistantContent).toBe('abc');
  });

  it('accumulates tool call arguments across chunks', async () => {
    const reader = makeReader([
      sse(
        toolCallChunk([
          { index: 0, id: 'call_1', type: 'function', function: { name: 'set_value', arguments: '' } },
        ]),
      ),
      sse(toolCallChunk([{ index: 0, function: { arguments: '{"path":' } }])),
      sse(toolCallChunk([{ index: 0, function: { arguments: '"name","value":"x"}' } }])),
      'data: [DONE]\n\n',
    ]);

    const result = await parseCompletionStream(reader);

    expect(result.assistantContent).toBe('');
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'set_value', arguments: '{"path":"name","value":"x"}' },
      },
    ]);
  });

  it('tracks multiple tool calls by index', async () => {
    const reader = makeReader([
      sse(
        toolCallChunk([
          { index: 0, id: 'call_a', type: 'function', function: { name: 'first', arguments: '{}' } },
        ]),
      ),
      sse(
        toolCallChunk([
          { index: 1, id: 'call_b', type: 'function', function: { name: 'second', arguments: '{"a":' } },
        ]),
      ),
      sse(toolCallChunk([{ index: 1, function: { arguments: '1}' } }])),
      'data: [DONE]\n\n',
    ]);

    const result = await parseCompletionStream(reader);

    expect(result.toolCalls?.map((t) => [t.id, t.function.name, t.function.arguments])).toEqual([
      ['call_a', 'first', '{}'],
      ['call_b', 'second', '{"a":1}'],
    ]);
  });

  it('reassembles a data line that is split across two chunks', async () => {
    const line = sse(contentChunk('split across chunks'));
    const cut = Math.floor(line.length / 2);
    const reader = makeReader([line.slice(0, cut), line.slice(cut), 'data: [DONE]\n\n']);

    const result = await parseCompletionStream(reader);

    expect(result.assistantContent).toBe('split across chunks');
  });

  it('reads usage from the final chunk, including one without a trailing newline', async () => {
    const usageChunk = {
      ...contentChunk('done'),
      usage: { prompt_tokens: 120, completion_tokens: 7, total_tokens: 127 },
    };
    const reader = makeReader([
      sse(contentChunk('all ')),
      // No trailing newline: the parser must process what is left in its buffer.
      `data: ${JSON.stringify(usageChunk)}`,
    ]);

    const result = await parseCompletionStream(reader);

    expect(result.assistantContent).toBe('all done');
    expect(result.promptTokens).toBe(120);
    expect(result.completionTokens).toBe(7);
  });

  it('stops reading after [DONE] even if more data follows', async () => {
    const reader = makeReader([
      sse(contentChunk('before')),
      'data: [DONE]\n\n',
      sse(contentChunk('after')),
    ]);
    const result = await parseCompletionStream(reader);
    expect(result.assistantContent).toBe('before');
  });

  it('ignores lines that are not data lines and keeps going after a bad JSON line', async () => {
    const reader = makeReader([
      ': keep-alive comment\n',
      'event: ping\n',
      'data: {not json}\n',
      sse(contentChunk('ok')),
      'data: [DONE]\n\n',
    ]);
    const result = await parseCompletionStream(reader);
    expect(result.assistantContent).toBe('ok');
  });

  // A multi-byte character whose bytes are split across two chunks must
  // survive decoding; this relies on the decoder running in streaming mode.
  it('decodes a multi-byte UTF-8 character split across two chunks', async () => {
    const line = sse(contentChunk('café'));
    const bytes = new TextEncoder().encode(line);
    // "é" is two bytes (0xC3 0xA9); cut between them.
    const splitAt = bytes.indexOf(0xc3) + 1;
    const reader = makeReader([bytes.slice(0, splitAt), bytes.slice(splitAt), 'data: [DONE]\n\n']);

    const result = await parseCompletionStream(reader);

    expect(result.assistantContent).toBe('café');
  });
});

describe('applyDeltaToToolCalls', () => {
  it('starts a new list when there is no current one', () => {
    const result = applyDeltaToToolCalls(undefined, [
      { index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: '{' } },
    ]);
    expect(result).toEqual([{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{' } }]);
  });

  it('appends argument fragments and fills in a late id or name', () => {
    const current = applyDeltaToToolCalls(undefined, [
      { index: 0, type: 'function', function: { arguments: '{"a":' } },
    ]);
    const result = applyDeltaToToolCalls(current, [
      { index: 0, id: 'c1', function: { name: 'f', arguments: '1}' } },
    ]);
    expect(result).toEqual([{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }]);
  });
});
