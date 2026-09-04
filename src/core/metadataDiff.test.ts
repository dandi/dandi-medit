import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  changeToDescription,
  computeDelta,
  deltaToChanges,
  formatValue,
  hasDifferences,
  reverseDelta,
  summarizePendingChanges,
} from './metadataDiff';

describe('computeDelta and hasDifferences', () => {
  it('returns undefined when the objects are equal', () => {
    const a = { name: 'x', contributor: [{ name: 'Alice' }] };
    const b = JSON.parse(JSON.stringify(a));
    expect(computeDelta(a, b)).toBeUndefined();
    expect(hasDifferences(a, b)).toBe(false);
  });

  it('returns a delta when the objects differ', () => {
    expect(computeDelta({ name: 'x' }, { name: 'y' })).toBeDefined();
    expect(hasDifferences({ name: 'x' }, { name: 'y' })).toBe(true);
  });

  it('ignores properties whose names start with $', () => {
    expect(computeDelta({ name: 'x', $meta: 1 }, { name: 'x', $meta: 2 })).toBeUndefined();
  });

  it('round-trips through applyDelta and reverseDelta', () => {
    const original = { name: 'x', keywords: ['a'] };
    const modified = { name: 'y', keywords: ['a', 'b'], license: 'CC0' };
    const delta = computeDelta(original, modified)!;
    const patched = applyDelta(JSON.parse(JSON.stringify(original)), delta);
    expect(patched).toEqual(modified);
    const reverted = applyDelta(JSON.parse(JSON.stringify(modified)), reverseDelta(delta));
    expect(reverted).toEqual(original);
  });
});

describe('deltaToChanges', () => {
  it('returns an empty list for an undefined delta', () => {
    expect(deltaToChanges(undefined)).toEqual([]);
  });

  it('reports an added top-level field', () => {
    const delta = computeDelta({ name: 'x' }, { name: 'x', license: 'CC0' });
    expect(deltaToChanges(delta)).toEqual([
      { path: 'license', type: 'added', newValue: 'CC0' },
    ]);
  });

  it('reports a modified top-level field with old and new values', () => {
    const delta = computeDelta({ name: 'x' }, { name: 'y' });
    expect(deltaToChanges(delta)).toEqual([
      { path: 'name', type: 'modified', oldValue: 'x', newValue: 'y' },
    ]);
  });

  it('reports a removed top-level field', () => {
    const delta = computeDelta({ name: 'x', license: 'CC0' }, { name: 'x' });
    expect(deltaToChanges(delta)).toEqual([
      { path: 'license', type: 'removed', oldValue: 'CC0' },
    ]);
  });

  it('uses dot paths for nested object changes', () => {
    const delta = computeDelta(
      { assetsSummary: { numberOfFiles: 1, numberOfBytes: 10 } },
      { assetsSummary: { numberOfFiles: 2, numberOfBytes: 10 } },
    );
    expect(deltaToChanges(delta)).toEqual([
      { path: 'assetsSummary.numberOfFiles', type: 'modified', oldValue: 1, newValue: 2 },
    ]);
  });

  it('reports a change inside an array item with a bracketed index', () => {
    // Items carry an identifier so jsondiffpatch matches them by hash and
    // diffs their contents rather than treating the edit as a remove and add.
    const original = {
      contributor: [
        { identifier: '0000-0001-2345-6789', name: 'Alice' },
        { identifier: '0000-0002-3456-7890', name: 'Bob' },
      ],
    };
    const modified = {
      contributor: [
        { identifier: '0000-0001-2345-6789', name: 'Alice' },
        { identifier: '0000-0002-3456-7890', name: 'Robert' },
      ],
    };
    const delta = computeDelta(original, modified);
    expect(deltaToChanges(delta)).toEqual([
      { path: 'contributor[1].name', type: 'modified', oldValue: 'Bob', newValue: 'Robert' },
    ]);
  });

  it('reports items added to and removed from an array', () => {
    const added = deltaToChanges(
      computeDelta({ keywords: ['a'] }, { keywords: ['a', 'b'] }),
    );
    expect(added).toEqual([{ path: 'keywords[1]', type: 'added', newValue: 'b' }]);

    const removed = deltaToChanges(
      computeDelta({ keywords: ['a', 'b'] }, { keywords: ['a'] }),
    );
    expect(removed).toEqual([{ path: 'keywords[1]', type: 'removed', oldValue: 'b' }]);
  });
});

describe('computeDelta with deltaToChanges', () => {
  it('reports the same changes regardless of key order', () => {
    const original = { name: 'x', license: 'CC0' };
    const modified = { license: 'CC-BY', name: 'x' };
    expect(deltaToChanges(computeDelta(original, modified))).toEqual([
      { path: 'license', type: 'modified', oldValue: 'CC0', newValue: 'CC-BY' },
    ]);
  });
});

describe('formatValue and changeToDescription', () => {
  it('formats primitives, strings and containers', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue('abc')).toBe('"abc"');
    expect(formatValue('x'.repeat(60), 10)).toBe(`"${'x'.repeat(10)}..."`);
    expect(formatValue(3)).toBe('3');
    expect(formatValue(true)).toBe('true');
    expect(formatValue([])).toBe('[]');
    expect(formatValue([1, 2])).toBe('[1,2]');
    expect(formatValue(Array.from({ length: 30 }, (_, i) => i))).toBe('[30 items]');
    expect(formatValue({})).toBe('{}');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue({ key: 'x'.repeat(60) })).toBe('{1 fields}');
  });

  it('describes each change type', () => {
    expect(changeToDescription({ path: 'a', type: 'added', newValue: 1 })).toBe('Added a: 1');
    expect(changeToDescription({ path: 'a', type: 'removed', oldValue: 1 })).toBe('Removed a');
    expect(
      changeToDescription({ path: 'a', type: 'modified', oldValue: 1, newValue: 2 }),
    ).toBe('Changed a: 1 → 2');
  });
});

describe('summarizePendingChanges', () => {
  it('reports nothing when the two objects are identical', () => {
    const original = { name: 'Study', keywords: ['a', 'b'] };
    const modified = JSON.parse(JSON.stringify(original));
    expect(summarizePendingChanges(original, modified)).toEqual({
      lines: [],
      hidden: 0,
      total: 0,
    });
  });

  it('describes a handful of changes without hiding any', () => {
    const original = { name: 'Study', description: 'old', license: ['CC0'] };
    const modified = { name: 'Study', description: 'new', url: 'https://example.org' };

    const summary = summarizePendingChanges(original, modified);

    expect(summary.total).toBe(3);
    expect(summary.hidden).toBe(0);
    expect(summary.lines).toHaveLength(3);
    expect(summary.lines).toContain('Changed description: "old" → "new"');
    expect(summary.lines).toContain('Added url: "https://example.org"');
    expect(summary.lines).toContain('Removed license');
  });

  it('caps the listed lines at the limit and counts the rest as hidden', () => {
    const original: Record<string, string> = {};
    const modified: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      original[`field${i}`] = 'before';
      modified[`field${i}`] = 'after';
    }

    const summary = summarizePendingChanges(original, modified, 15);

    expect(summary.total).toBe(20);
    expect(summary.lines).toHaveLength(15);
    expect(summary.hidden).toBe(5);
    expect(summary.lines[0]).toBe('Changed field0: "before" → "after"');
  });

  it('honors a limit smaller than the default', () => {
    const original = { a: 1, b: 2, c: 3 };
    const modified = { a: 10, b: 20, c: 30 };

    const summary = summarizePendingChanges(original, modified, 2);

    expect(summary.lines).toHaveLength(2);
    expect(summary.hidden).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('returns an empty summary when metadata has not been loaded yet', () => {
    expect(summarizePendingChanges(null, null)).toEqual({ lines: [], hidden: 0, total: 0 });
  });
});
