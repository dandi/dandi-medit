import { describe, expect, it } from 'vitest';
import { describeCompletionError } from './completionApi';

describe('describeCompletionError', () => {
  it('explains a 402 against the user\'s own key', () => {
    const message = describeCompletionError(402, 'Payment Required', true);
    expect(message).toContain('Your OpenRouter account has no remaining credit');
    expect(message).toContain('https://openrouter.ai/credits');
    expect(message).toContain('Settings');
  });

  it('explains a 402 against the shared key', () => {
    const message = describeCompletionError(402, 'Payment Required', false);
    expect(message).toContain('shared OpenRouter key');
    expect(message).toContain('add your own OpenRouter API key in Settings');
    expect(message).toContain('switching between free models will not help');
  });

  it('matches on the error text even when the status is not 402', () => {
    const message = describeCompletionError(
      500,
      'Insufficient credits to make this request',
      false,
    );
    expect(message).toContain('shared OpenRouter key');
  });

  it('falls back to the generic wording for other failures', () => {
    expect(describeCompletionError(500, 'Internal Server Error', false)).toBe(
      'OpenRouter API error: Internal Server Error',
    );
    expect(describeCompletionError(429, 'Rate limit exceeded', true)).toBe(
      'OpenRouter API error: Rate limit exceeded',
    );
  });
});
