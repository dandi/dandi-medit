/* eslint-disable @typescript-eslint/no-explicit-any */
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { fetchSchema, getCachedSchema } from "./schemaService";

// Create and configure Ajv instance with JSON Schema 2020-12 support
// (the DANDI schema uses "$schema": "https://json-schema.org/draft/2020-12/schema")
const ajv = new Ajv2020({
  allErrors: true, // Report all errors, not just the first one
  strict: false, // Disable strict mode to allow schema keywords like nskey, sameas, etc.
  validateFormats: true,
});

// Add format validators (uri, email, date-time, etc.)
addFormats(ajv);

// Cache for compiled validators by schema version
const validatorCache: Map<string, ReturnType<typeof ajv.compile>> = new Map();

/**
 * Get or compile a validator for the given schema version (async)
 */
async function getValidatorAsync(): Promise<ReturnType<typeof ajv.compile>> {
  const version = "0.7.0";

  // Check if we have a cached validator
  if (validatorCache.has(version)) {
    return validatorCache.get(version)!;
  }

  // Fetch the schema
  const schema = await fetchSchema(version);

  // Compile the validator
  const validate = ajv.compile(schema);

  // Cache it
  validatorCache.set(version, validate);

  return validate;
}

/**
 * Get a validator synchronously using cached schema
 * Returns null if schema is not cached
 */
function getValidatorSync(): ReturnType<typeof ajv.compile> | null {
  const version = "0.7.0";

  // Check if we have a cached validator
  if (validatorCache.has(version)) {
    return validatorCache.get(version)!;
  }

  // Try to get cached schema
  const schema = getCachedSchema(version);
  if (!schema) {
    return null;
  }

  // Compile the validator
  const validate = ajv.compile(schema);

  // Cache it
  validatorCache.set(version, validate);

  return validate;
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Convert Ajv errors to our ValidationError format
 */
function convertErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors) return [];

  return errors.map((err) => ({
    path: err.instancePath || "/",
    message: err.message || "Unknown error",
    keyword: err.keyword,
  }));
}

/**
 * Validate full metadata against the DANDI schema (synchronous version)
 * Uses cached schema - returns valid:true with empty errors if schema not cached
 * This is the primary validation function used by the UI
 */
export const validateFullMetadata = (
  fullMetadata: any,
): ValidationResult => {
  const validate = getValidatorSync();

  if (!validate) {
    // Schema not cached yet - consider valid (validation will happen once schema loads)
    return {
      valid: true,
      errors: [],
    };
  }

  const valid = validate(fullMetadata);

  return {
    valid: !!valid,
    errors: convertErrors(validate.errors),
  };
};

/**
 * Validate full metadata against the DANDI schema (async version)
 * This will fetch the schema if not cached
 */
export const validateFullMetadataAsync = async (
  fullMetadata: any
): Promise<ValidationResult> => {
  try {
    const validate = await getValidatorAsync();
    const valid = validate(fullMetadata);

    return {
      valid: !!valid,
      errors: convertErrors(validate.errors),
    };
  } catch (error) {
    // If schema fetch fails, return an error
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message:
            error instanceof Error
              ? `Schema validation failed: ${error.message}`
              : "Schema validation failed",
          keyword: "schema",
        },
      ],
    };
  }
};

/**
 * Return the validation errors present in `after` that were not already
 * present in `before`. Errors are matched by instance path, keyword and
 * message, so pre-existing problems in a dandiset do not block later edits,
 * while any error a change introduces is still reported.
 *
 * Because errors are keyed by path, an edit that shifts array indices (for
 * example deleting the first contributor) can make an existing error at
 * /contributor/1 reappear as a "new" error at /contributor/0.
 */
export const findNewValidationErrors = (
  before: ValidationError[],
  after: ValidationError[],
): ValidationError[] => {
  const key = (err: ValidationError) =>
    `${err.path}::${err.keyword}::${err.message}`;
  const existing = new Set(before.map(key));
  return after.filter((err) => !existing.has(key(err)));
};

/**
 * Format validation errors into human-readable strings
 */
export const formatValidationErrors = (
  errors: Array<{ path: string; message: string; keyword: string }> | undefined | null
): string[] => {
  if (!errors || !Array.isArray(errors)) {
    return [];
  }
  return errors.map((err) => `Error at ${err.path}: ${err.message}`);
};

/**
 * Clear the validator cache (useful for testing or when schemas are updated)
 */
export const clearValidatorCache = () => {
  validatorCache.clear();
};

// initialize the validator cache by preloading the default schema
getValidatorAsync().catch((err) => {
  console.warn("Failed to preload schema:", err);
});