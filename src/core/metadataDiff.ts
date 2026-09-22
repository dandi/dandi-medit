/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Metadata diff computation utilities using jsondiffpatch.
 * 
 * Uses jsondiffpatch's native delta format for efficient change tracking.
 * The delta format:
 * - Modified values: [oldValue, newValue]
 * - Added values: [newValue]
 * - Deleted values: [oldValue, 0, 0]
 * - Arrays have _t: 'a' marker with index-based changes
 */

import * as jsondiffpatch from 'jsondiffpatch';
import type { Delta } from 'jsondiffpatch';

// Re-export Delta type for consumers
export type { Delta };

/**
 * Pairing of array items between the original and the modified metadata.
 *
 * jsondiffpatch decides which items of an array correspond to each other by
 * an `objectHash`, so an edit to an item is reported as a change inside it
 * only when both versions hash the same. No single field works as that key
 * for dandiset metadata: the `identifier` (an ORCID, a ROR, a DOI) is often
 * the field being added, so an item keyed by it does not match itself once
 * it gains one, and an item keyed by its `name` does not match itself after
 * a rename. Instead, `computeDelta` pairs the items of corresponding arrays
 * up front, trying the more specific key first, and hands jsondiffpatch a
 * shared key for each pair:
 *
 *   1. the same object reference on both sides
 *   2. `@id` or `id`
 *   3. `identifier`
 *   4. `schemaKey` and `name`
 *   5. `url`
 *   6. the same position, for items that have none of those fields (for
 *      example the single entry of `access`)
 *
 * Adding an ORCID to a person, renaming a funder that has a ROR, and fixing
 * an access status all show up as edits within the item. Renaming an item
 * that has no identifier still shows as a removal plus an addition.
 *
 * Only diff computation uses this; patching addresses array items by index,
 * so deltas computed before this pairing existed (for example in proposal
 * links that are already in circulation) still apply.
 */
const itemKeys = new WeakMap<object, string>();
let nextItemKey = 0;

const KEY_STAGES: Array<(item: any) => string | undefined> = [
  (item) => (item['@id'] != null ? `@id:${item['@id']}` : item.id != null ? `id:${item.id}` : undefined),
  (item) => (item.identifier ? `identifier:${item.identifier}` : undefined),
  (item) => (item.name ? `name:${item.schemaKey ?? ''}:${item.name}` : undefined),
  (item) => (item.url ? `url:${item.url}` : undefined),
];

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNoKeys(item: any): boolean {
  return KEY_STAGES.every((stage) => stage(item) === undefined);
}

/**
 * Pair the object items of two arrays. Returns index pairs [old, new];
 * items left out of the result have no counterpart on the other side.
 */
export function pairArrayItems(oldItems: any[], newItems: any[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const oldFree = new Set<number>();
  const newFree = new Set<number>();
  oldItems.forEach((item, i) => { if (isPlainObject(item)) oldFree.add(i); });
  newItems.forEach((item, j) => { if (isPlainObject(item)) newFree.add(j); });
  const pair = (i: number, j: number) => {
    pairs.push([i, j]);
    oldFree.delete(i);
    newFree.delete(j);
  };

  const oldByRef = new Map<object, number>();
  for (const i of oldFree) oldByRef.set(oldItems[i], i);
  for (const j of [...newFree]) {
    const i = oldByRef.get(newItems[j]);
    if (i !== undefined && oldFree.has(i)) pair(i, j);
  }

  for (const stage of KEY_STAGES) {
    const oldByKey = new Map<string, number[]>();
    for (const i of oldFree) {
      const key = stage(oldItems[i]);
      if (key === undefined) continue;
      const list = oldByKey.get(key);
      if (list) list.push(i); else oldByKey.set(key, [i]);
    }
    for (const j of [...newFree]) {
      const key = stage(newItems[j]);
      if (key === undefined) continue;
      const i = oldByKey.get(key)?.shift();
      if (i !== undefined) pair(i, j);
    }
  }

  for (const j of [...newFree]) {
    if (oldFree.has(j) && hasNoKeys(newItems[j]) && hasNoKeys(oldItems[j])) pair(j, j);
  }

  pairs.sort((a, b) => a[1] - b[1]);
  return pairs;
}

/**
 * Walk two versions of the metadata together and record a shared key for
 * every pair of array items that correspond, and a unique key for every
 * item without a counterpart.
 */
function recordItemKeys(oldValue: any, newValue: any): void {
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const pairs = pairArrayItems(oldValue, newValue);
    const paired = new Set<object>();
    for (const [i, j] of pairs) {
      const key = `$pair:${nextItemKey++}`;
      itemKeys.set(oldValue[i], key);
      itemKeys.set(newValue[j], key);
      paired.add(oldValue[i]);
      paired.add(newValue[j]);
      recordItemKeys(oldValue[i], newValue[j]);
    }
    for (const item of [...oldValue, ...newValue]) {
      if (isPlainObject(item) && !paired.has(item)) {
        itemKeys.set(item, `$only:${nextItemKey++}`);
      }
    }
  } else if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    for (const key of Object.keys(oldValue)) {
      if (key in newValue) recordItemKeys(oldValue[key], newValue[key]);
    }
  }
}

// Create a configured jsondiffpatch instance
const diffpatcher = jsondiffpatch.create({
  objectHash: function (obj: any, index?: number) {
    // Arrays reached through the walk in computeDelta always have a recorded
    // key; the fallback covers anything else, such as an array of arrays.
    return itemKeys.get(obj) ?? obj?.['@id'] ?? obj?.id ?? obj?.identifier ?? `$index:${index}`;
  },
  arrays: {
    detectMove: true,
    includeValueOnMove: false,
  },
  // Ignore properties starting with $
  propertyFilter: function (name: string) {
    return name.slice(0, 1) !== '$';
  },
});

/**
 * Compute the differences between two metadata objects.
 * Returns a jsondiffpatch Delta object, or undefined if no differences.
 */
export function computeDelta(original: any, modified: any): Delta | undefined {
  recordItemKeys(original, modified);
  return diffpatcher.diff(original, modified);
}

/**
 * Apply a delta to an object (in-place mutation).
 */
export function applyDelta<T>(target: T, delta: Delta): T {
  return diffpatcher.patch(target, delta) as T;
}

/**
 * Reverse a delta (for undo operations).
 */
export function reverseDelta(delta: Delta): Delta {
  return diffpatcher.reverse(delta) as Delta;
}

/**
 * Check if there are any differences between two metadata objects.
 */
export function hasDifferences(original: any, modified: any): boolean {
  return computeDelta(original, modified) !== undefined;
}

// =============================================================================
// Legacy interface support - converts delta to MetadataChange[] for backwards compat
// =============================================================================

export type ChangeType = 'added' | 'removed' | 'modified';

export interface MetadataChange {
  path: string;
  type: ChangeType;
  oldValue?: any;
  newValue?: any;
}

/**
 * Check if a value represents an array in delta format
 */
function isArrayDelta(delta: any): boolean {
  return delta && typeof delta === 'object' && delta._t === 'a';
}

/**
 * Convert a jsondiffpatch delta to an array of MetadataChange objects.
 * This provides backwards compatibility with existing code.
 */
export function deltaToChanges(delta: Delta | undefined, basePath: string = ''): MetadataChange[] {
  if (!delta) return [];
  
  const changes: MetadataChange[] = [];
  
  if (isArrayDelta(delta)) {
    // Handle array changes
    for (const [key, value] of Object.entries(delta)) {
      if (key === '_t') continue; // Skip array marker
      
      if (key.startsWith('_')) {
        // Removed or moved item (key is _index)
        const index = key.slice(1);
        const itemPath = basePath ? `${basePath}[${index}]` : `[${index}]`;
        
        if (Array.isArray(value)) {
          if (value.length === 3 && value[1] === 0 && value[2] === 0) {
            // Deleted: [oldValue, 0, 0]
            changes.push({ path: itemPath, type: 'removed', oldValue: value[0] });
          } else if (value.length === 3 && value[2] === 3) {
            // Moved: ['', toIndex, 3] - we can skip these as they're represented elsewhere
            // Or show as a modification if needed
          }
        }
      } else {
        // Added or modified item at index
        const itemPath = basePath ? `${basePath}[${key}]` : `[${key}]`;
        
        if (Array.isArray(value)) {
          if (value.length === 1) {
            // Added: [newValue]
            changes.push({ path: itemPath, type: 'added', newValue: value[0] });
          } else if (value.length === 2) {
            // Modified: [oldValue, newValue]
            changes.push({ path: itemPath, type: 'modified', oldValue: value[0], newValue: value[1] });
          }
        } else if (typeof value === 'object') {
          // Nested changes within array item
          changes.push(...deltaToChanges(value, itemPath));
        }
      }
    }
  } else if (typeof delta === 'object' && !Array.isArray(delta)) {
    // Handle object changes
    for (const [key, value] of Object.entries(delta)) {
      const newPath = basePath ? `${basePath}.${key}` : key;
      
      if (Array.isArray(value)) {
        if (value.length === 1) {
          // Added: [newValue]
          changes.push({ path: newPath, type: 'added', newValue: value[0] });
        } else if (value.length === 2) {
          // Modified: [oldValue, newValue]
          changes.push({ path: newPath, type: 'modified', oldValue: value[0], newValue: value[1] });
        } else if (value.length === 3 && value[1] === 0 && value[2] === 0) {
          // Deleted: [oldValue, 0, 0]
          changes.push({ path: newPath, type: 'removed', oldValue: value[0] });
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested object or array changes
        changes.push(...deltaToChanges(value as Delta, newPath));
      }
    }
  }
  
  return changes;
}

/**
 * Format a value for display in the changes summary.
 * Truncates long strings and formats objects/arrays.
 */
export function formatValue(value: any, maxLength: number = 50): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  if (typeof value === 'string') {
    if (value.length > maxLength) {
      return `"${value.substring(0, maxLength)}..."`;
    }
    return `"${value}"`;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const preview = JSON.stringify(value);
    if (preview.length > maxLength) {
      return `[${value.length} items]`;
    }
    return preview;
  }
  
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const preview = JSON.stringify(value);
    if (preview.length > maxLength) {
      return `{${keys.length} fields}`;
    }
    return preview;
  }
  
  return String(value);
}

/**
 * Convert a MetadataChange to a human-readable description.
 */
export function changeToDescription(change: MetadataChange): string {
  switch (change.type) {
    case 'added':
      return `Added ${change.path}: ${formatValue(change.newValue)}`;
    case 'removed':
      return `Removed ${change.path}`;
    case 'modified':
      return `Changed ${change.path}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`;
    default:
      return `Unknown change at ${change.path}`;
  }
}

/**
 * Summary of the pending changes between two metadata objects, prepared for
 * display in a confirmation dialog.
 */
export interface PendingChangesSummary {
  /** Human-readable description of each change, capped at `limit` entries. */
  lines: string[];
  /** How many changes were left out of `lines` because of the cap. */
  hidden: number;
  /** Total number of changes, including the ones not listed. */
  total: number;
}

/**
 * Describe the changes between two metadata objects, capping the number of
 * described lines so a long list stays readable.
 */
export function summarizePendingChanges(
  original: any,
  modified: any,
  limit: number = 15
): PendingChangesSummary {
  const changes = deltaToChanges(computeDelta(original, modified));
  const total = changes.length;
  const cap = Math.max(0, limit);
  const lines = changes.slice(0, cap).map(changeToDescription);
  return { lines, hidden: total - lines.length, total };
}
