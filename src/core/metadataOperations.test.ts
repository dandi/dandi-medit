import { describe, expect, it } from 'vitest';
import {
  appendArrayItem,
  applyOperation,
  deleteArrayItem,
  getValueAtPath,
  insertArrayItem,
  normalizePath,
  parsePath,
  setValueAtPath,
} from './metadataOperations';

function sampleMetadata() {
  return {
    name: 'Test dandiset',
    contributor: [
      { name: 'Alice', roleName: ['dcite:Author'] },
      { name: 'Bob', roleName: ['dcite:DataCurator'] },
    ],
    about: [{ name: 'Hippocampus' }],
    assetsSummary: { numberOfFiles: 3 },
  };
}

describe('normalizePath and parsePath', () => {
  it('converts bracket indices to dot notation', () => {
    expect(normalizePath('contributor[0].affiliation[2].name')).toBe(
      'contributor.0.affiliation.2.name',
    );
  });

  it('splits a path into parts and drops empty segments', () => {
    expect(parsePath('contributor[0].name')).toEqual(['contributor', '0', 'name']);
    expect(parsePath('')).toEqual([]);
    expect(parsePath('a..b')).toEqual(['a', 'b']);
  });
});

describe('getValueAtPath', () => {
  it('reads nested values with dot and bracket notation', () => {
    const data = sampleMetadata();
    expect(getValueAtPath(data, 'name')).toBe('Test dandiset');
    expect(getValueAtPath(data, 'contributor.1.name')).toBe('Bob');
    expect(getValueAtPath(data, 'contributor[0].roleName[0]')).toBe('dcite:Author');
    expect(getValueAtPath(data, 'assetsSummary.numberOfFiles')).toBe(3);
  });

  it('returns undefined for missing paths and null intermediates', () => {
    const data = { ...sampleMetadata(), license: null };
    expect(getValueAtPath(data, 'doesNotExist')).toBeUndefined();
    expect(getValueAtPath(data, 'contributor.5.name')).toBeUndefined();
    expect(getValueAtPath(data, 'license.name')).toBeUndefined();
    expect(getValueAtPath(null, 'name')).toBeUndefined();
  });

  it('returns the whole object for an empty path', () => {
    const data = sampleMetadata();
    expect(getValueAtPath(data, '')).toBe(data);
  });
});

describe('setValueAtPath', () => {
  it('sets an existing top-level value', () => {
    const result = setValueAtPath(sampleMetadata(), 'name', 'Renamed');
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Renamed');
  });

  it('sets a value inside an array item', () => {
    const result = setValueAtPath(sampleMetadata(), 'contributor[1].name', 'Robert');
    expect(result.success).toBe(true);
    expect(result.data.contributor[1].name).toBe('Robert');
    expect(result.data.contributor[0].name).toBe('Alice');
  });

  it('creates intermediate objects when the path does not exist', () => {
    const result = setValueAtPath({}, 'a.b.c', 42);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ a: { b: { c: 42 } } });
  });

  it('creates intermediate arrays when the next segment is numeric', () => {
    const result = setValueAtPath({}, 'contributor.0.name', 'Alice');
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.contributor)).toBe(true);
    expect(result.data.contributor[0]).toEqual({ name: 'Alice' });
  });

  it('rejects an empty path', () => {
    const result = setValueAtPath(sampleMetadata(), '', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('does not mutate the input object', () => {
    const data = sampleMetadata();
    const snapshot = JSON.parse(JSON.stringify(data));
    const result = setValueAtPath(data, 'contributor[0].roleName[0]', 'dcite:ContactPerson');
    expect(result.success).toBe(true);
    expect(data).toEqual(snapshot);
    expect(result.data).not.toBe(data);
    expect(result.data.contributor).not.toBe(data.contributor);
    expect(result.data.contributor[0].roleName[0]).toBe('dcite:ContactPerson');
    expect(data.contributor[0].roleName[0]).toBe('dcite:Author');
  });
});

describe('deleteArrayItem', () => {
  it('removes the item at the given index', () => {
    const result = deleteArrayItem(sampleMetadata(), 'contributor[0]');
    expect(result.success).toBe(true);
    expect(result.data.contributor).toEqual([
      { name: 'Bob', roleName: ['dcite:DataCurator'] },
    ]);
  });

  it('rejects an index equal to or beyond the array length', () => {
    const result = deleteArrayItem(sampleMetadata(), 'contributor.2');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of bounds/);
  });

  it('rejects a negative index', () => {
    const result = deleteArrayItem(sampleMetadata(), 'contributor.-1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of bounds/);
  });

  it('rejects a path that does not end in an index', () => {
    const result = deleteArrayItem(sampleMetadata(), 'contributor');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not end with an array index/);
  });

  it('rejects deleting from a non-array parent', () => {
    const result = deleteArrayItem(sampleMetadata(), 'assetsSummary.0');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-array/);
  });

  it('does not mutate the input object', () => {
    const data = sampleMetadata();
    const snapshot = JSON.parse(JSON.stringify(data));
    deleteArrayItem(data, 'contributor[1]');
    expect(data).toEqual(snapshot);
  });
});

describe('insertArrayItem', () => {
  it('inserts at the start and shifts existing items right', () => {
    const result = insertArrayItem(sampleMetadata(), 'contributor[0]', { name: 'Carol' });
    expect(result.success).toBe(true);
    expect(result.data.contributor.map((c: { name: string }) => c.name)).toEqual([
      'Carol',
      'Alice',
      'Bob',
    ]);
  });

  it('allows inserting at index equal to the length (end of array)', () => {
    const result = insertArrayItem(sampleMetadata(), 'contributor[2]', { name: 'Carol' });
    expect(result.success).toBe(true);
    expect(result.data.contributor.map((c: { name: string }) => c.name)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
  });

  it('rejects an index beyond the length', () => {
    const result = insertArrayItem(sampleMetadata(), 'contributor[3]', { name: 'Carol' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of bounds/);
  });

  it('rejects a path that does not end in an index', () => {
    const result = insertArrayItem(sampleMetadata(), 'contributor', { name: 'Carol' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not end with an array index/);
  });

  it('does not mutate the input object', () => {
    const data = sampleMetadata();
    const snapshot = JSON.parse(JSON.stringify(data));
    insertArrayItem(data, 'contributor[1]', { name: 'Carol' });
    expect(data).toEqual(snapshot);
  });
});

describe('appendArrayItem', () => {
  it('appends to the end of an existing array', () => {
    const result = appendArrayItem(sampleMetadata(), 'about', { name: 'Cortex' });
    expect(result.success).toBe(true);
    expect(result.data.about).toEqual([{ name: 'Hippocampus' }, { name: 'Cortex' }]);
  });

  it('rejects appending to a non-array value', () => {
    const result = appendArrayItem(sampleMetadata(), 'name', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-array/);
  });

  it('rejects appending to a missing path', () => {
    const result = appendArrayItem(sampleMetadata(), 'keywords', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-array/);
  });

  it('does not mutate the input object', () => {
    const data = sampleMetadata();
    const snapshot = JSON.parse(JSON.stringify(data));
    const result = appendArrayItem(data, 'contributor[0].roleName', 'dcite:ContactPerson');
    expect(result.success).toBe(true);
    expect(data).toEqual(snapshot);
    expect(result.data.contributor[0].roleName).toHaveLength(2);
  });
});

describe('applyOperation', () => {
  it('dispatches to the matching operation', () => {
    const data = sampleMetadata();
    expect(applyOperation(data, 'set', 'name', 'X').data.name).toBe('X');
    expect(applyOperation(data, 'delete', 'about[0]').data.about).toEqual([]);
    expect(applyOperation(data, 'insert', 'about[0]', { name: 'A' }).data.about).toHaveLength(2);
    expect(applyOperation(data, 'append', 'about', { name: 'A' }).data.about).toHaveLength(2);
  });

  it('requires a value for set, insert and append', () => {
    const data = sampleMetadata();
    for (const op of ['set', 'insert', 'append'] as const) {
      const result = applyOperation(data, op, 'about');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Value is required/);
    }
  });

  it('rejects unknown operations', () => {
    // Cast because the type system would otherwise reject the operation name.
    const result = applyOperation(sampleMetadata(), 'rename' as never, 'name', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown operation/);
  });
});
