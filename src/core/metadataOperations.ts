/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Centralized metadata operations module.
 * 
 * Provides pure functions for modifying metadata objects immutably.
 * All operations return new objects without mutating the original.
 */

export type MetadataOperationType = 'set' | 'delete' | 'insert' | 'append';

export interface MetadataOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Normalize a path to use consistent dot notation for array indices.
 * Converts "foo[0].bar" to "foo.0.bar" and handles mixed notations.
 */
export function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}

/**
 * Parse a dot-notation path into an array of parts.
 */
export function parsePath(path: string): string[] {
  return normalizePath(path).split('.').filter(Boolean);
}

/**
 * Get a value at a dot-notation path in an object.
 */
export function getValueAtPath(obj: any, path: string): any {
  const parts = parsePath(path);
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else {
      current = current[part];
    }
  }
  
  return current;
}

/**
 * Deep clone an object or array.
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }
  const cloned: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone((obj as any)[key]);
    }
  }
  return cloned;
}

/**
 * Set a value at a dot-notation path in an object.
 * Creates intermediate objects/arrays as needed.
 * Returns a new object (does not mutate original).
 */
export function setValueAtPath(obj: any, path: string, value: any): MetadataOperationResult {
  const parts = parsePath(path);
  
  if (parts.length === 0) {
    return { success: false, error: 'Path cannot be empty' };
  }
  
  const result = deepClone(obj);
  let current = result;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const index = parseInt(part, 10);
    const isArrayIndex = !isNaN(index);
    
    if (isLast) {
      // Set the value
      if (isArrayIndex && Array.isArray(current)) {
        current[index] = value;
      } else {
        current[part] = value;
      }
    } else {
      // Navigate deeper, creating intermediate structures if needed
      const nextPart = parts[i + 1];
      const nextIsArrayIndex = !isNaN(parseInt(nextPart, 10));
      
      if (isArrayIndex && Array.isArray(current)) {
        if (current[index] === undefined || current[index] === null) {
          current[index] = nextIsArrayIndex ? [] : {};
        } else {
          current[index] = deepClone(current[index]);
        }
        current = current[index];
      } else {
        if (current[part] === undefined || current[part] === null) {
          current[part] = nextIsArrayIndex ? [] : {};
        } else {
          current[part] = deepClone(current[part]);
        }
        current = current[part];
      }
    }
  }
  
  return { success: true, data: result };
}

/**
 * Delete an item from an array at a dot-notation path.
 * The last part of the path must be an array index.
 * Returns a new object (does not mutate original).
 */
export function deleteArrayItem(obj: any, path: string): MetadataOperationResult {
  const parts = parsePath(path);
  
  if (parts.length === 0) {
    return { success: false, error: 'Path cannot be empty' };
  }
  
  const lastPart = parts[parts.length - 1];
  const index = parseInt(lastPart, 10);
  
  if (isNaN(index)) {
    return { success: false, error: `Cannot delete non-array item. Path "${path}" does not end with an array index.` };
  }
  
  // Get the parent array
  const parentPath = parts.slice(0, -1).join('.');
  const parentArray = parentPath ? getValueAtPath(obj, parentPath) : obj;
  
  if (!Array.isArray(parentArray)) {
    return { success: false, error: `Cannot delete from non-array at path "${parentPath || path}"` };
  }
  
  if (index < 0 || index >= parentArray.length) {
    return { success: false, error: `Index ${index} out of bounds for array of length ${parentArray.length}` };
  }
  
  // Create new array without the item
  const newArray = [...parentArray.slice(0, index), ...parentArray.slice(index + 1)];
  
  // If there's no parent path, we're deleting from the root (which shouldn't happen for metadata)
  if (!parentPath) {
    return { success: true, data: newArray };
  }
  
  // Set the new array at the parent path
  return setValueAtPath(obj, parentPath, newArray);
}

/**
 * Remove a property from an object at a dot-notation path.
 * The last part of the path names the property to delete from its parent object.
 * If the parent is an array, the removal is delegated to deleteArrayItem.
 * Returns a new object (does not mutate original).
 */
export function removeValueAtPath(obj: any, path: string): MetadataOperationResult {
  const parts = parsePath(path);

  if (parts.length === 0) {
    return { success: false, error: 'Path cannot be empty' };
  }

  const parentPath = parts.slice(0, -1).join('.');
  const parent = parentPath ? getValueAtPath(obj, parentPath) : obj;

  if (Array.isArray(parent)) {
    return deleteArrayItem(obj, path);
  }

  if (parent === null || typeof parent !== 'object') {
    return { success: false, error: `Cannot remove property from non-object at path "${parentPath || path}"` };
  }

  // Navigate to the parent within a clone so the original is left untouched
  const result = deepClone(obj);
  let current = result;

  for (const part of parts.slice(0, -1)) {
    const index = parseInt(part, 10);
    current = !isNaN(index) && Array.isArray(current) ? current[index] : current[part];
  }

  delete current[parts[parts.length - 1]];

  return { success: true, data: result };
}

/**
 * Insert an item into an array at a specific index.
 * The last part of the path must be an array index where the item will be inserted.
 * Items at and after the index are shifted right.
 * Returns a new object (does not mutate original).
 */
export function insertArrayItem(obj: any, path: string, value: any): MetadataOperationResult {
  const parts = parsePath(path);
  
  if (parts.length === 0) {
    return { success: false, error: 'Path cannot be empty' };
  }
  
  const lastPart = parts[parts.length - 1];
  const index = parseInt(lastPart, 10);
  
  if (isNaN(index)) {
    return { success: false, error: `Cannot insert at non-array index. Path "${path}" does not end with an array index.` };
  }
  
  // Get the parent array
  const parentPath = parts.slice(0, -1).join('.');
  const parentArray = parentPath ? getValueAtPath(obj, parentPath) : obj;
  
  if (!Array.isArray(parentArray)) {
    return { success: false, error: `Cannot insert into non-array at path "${parentPath || path}"` };
  }
  
  // Allow inserting at the end (index === length)
  if (index < 0 || index > parentArray.length) {
    return { success: false, error: `Index ${index} out of bounds for array of length ${parentArray.length}` };
  }
  
  // Create new array with the item inserted
  const newArray = [...parentArray.slice(0, index), value, ...parentArray.slice(index)];
  
  // If there's no parent path, return the new array
  if (!parentPath) {
    return { success: true, data: newArray };
  }
  
  // Set the new array at the parent path
  return setValueAtPath(obj, parentPath, newArray);
}

/**
 * Append an item to the end of an array.
 * The path should point to the array itself (not an index).
 * Returns a new object (does not mutate original).
 */
export function appendArrayItem(obj: any, path: string, value: any): MetadataOperationResult {
  const targetArray = getValueAtPath(obj, path);
  
  if (!Array.isArray(targetArray)) {
    return { success: false, error: `Cannot append to non-array at path "${path}"` };
  }
  
  // Create new array with the item appended
  const newArray = [...targetArray, value];
  
  // Set the new array at the path
  return setValueAtPath(obj, path, newArray);
}

/**
 * Apply a metadata operation.
 * This is the main entry point for modifying metadata.
 */
export function applyOperation(
  obj: any,
  operation: MetadataOperationType,
  path: string,
  value?: any
): MetadataOperationResult {
  switch (operation) {
    case 'set':
      if (value === undefined) {
        return { success: false, error: 'Value is required for set operation' };
      }
      return setValueAtPath(obj, path, value);
      
    case 'delete':
      return deleteArrayItem(obj, path);
      
    case 'insert':
      if (value === undefined) {
        return { success: false, error: 'Value is required for insert operation' };
      }
      return insertArrayItem(obj, path, value);
      
    case 'append':
      if (value === undefined) {
        return { success: false, error: 'Value is required for append operation' };
      }
      return appendArrayItem(obj, path, value);
      
    default:
      return { success: false, error: `Unknown operation: ${operation}` };
  }
}
