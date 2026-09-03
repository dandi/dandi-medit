import { describe, expect, it } from 'vitest';
import { hasSuggestions, parseSuggestions } from './parseSuggestions';

describe('parseSuggestions', () => {
  it('returns the content unchanged when there is no suggestions line', () => {
    const content = 'Here is some text.\n\nAnd a second paragraph.';
    expect(parseSuggestions(content)).toEqual({ cleanedContent: content, suggestions: [] });
  });

  it('splits a simple comma-separated list', () => {
    const result = parseSuggestions(
      'Done.\nsuggestions: add a keyword, fix the license, add an author',
    );
    expect(result.suggestions).toEqual(['add a keyword', 'fix the license', 'add an author']);
  });

  it('keeps commas inside double-quoted suggestions', () => {
    const result = parseSuggestions('suggestions: first, "second, with comma", third');
    expect(result.suggestions).toEqual(['first', 'second, with comma', 'third']);
  });

  it('matches the prefix case-insensitively and with leading whitespace', () => {
    expect(parseSuggestions('  SUGGESTIONS: a, b').suggestions).toEqual(['a', 'b']);
    expect(parseSuggestions('Suggestions: a, b').suggestions).toEqual(['a', 'b']);
  });

  it('removes the suggestions line from cleanedContent and trims the result', () => {
    const result = parseSuggestions('Intro line.\n\nsuggestions: a, b\n\n');
    expect(result.cleanedContent).toBe('Intro line.');
    expect(result.suggestions).toEqual(['a', 'b']);
  });

  it('removes a suggestions line that appears mid-message', () => {
    const result = parseSuggestions('Before.\nsuggestions: a\nAfter.');
    expect(result.cleanedContent).toBe('Before.\nAfter.');
    expect(result.suggestions).toEqual(['a']);
  });

  it('drops empty entries and trims whitespace around each suggestion', () => {
    const result = parseSuggestions('suggestions:  a ,, b ,');
    expect(result.suggestions).toEqual(['a', 'b']);
  });

  it('returns no suggestions when the line has nothing after the colon', () => {
    const result = parseSuggestions('Text.\nsuggestions:');
    expect(result.suggestions).toEqual([]);
    expect(result.cleanedContent).toBe('Text.');
  });

  it('does not treat a line that merely contains the word as a suggestions line', () => {
    const content = 'Some suggestions: none apply here';
    expect(parseSuggestions(content).suggestions).toEqual([]);
    expect(parseSuggestions(content).cleanedContent).toBe(content);
  });
});

describe('hasSuggestions', () => {
  it('detects the presence of a suggestions line', () => {
    expect(hasSuggestions('text\nsuggestions: a')).toBe(true);
    expect(hasSuggestions('text\n  Suggestions: a')).toBe(true);
    expect(hasSuggestions('no line here')).toBe(false);
  });
});
