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

// Create a configured jsondiffpatch instance
const diffpatcher = jsondiffpatch.create({
  // Match objects by id or @id field (common in JSON-LD metadata)
  objectHash: function (obj: any) {
    return obj?.['@id'] || obj?.id || obj?.identifier || JSON.stringify(obj);
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
