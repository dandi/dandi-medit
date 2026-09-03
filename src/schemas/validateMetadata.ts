/* eslint-disable @typescript-eslint/no-explicit-any */
import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { fetchSchema, getCachedSchema, getCurrentSchemaKey } from "./schemaService";

// Create and configure Ajv instance with JSON Schema 2020-12 support
// (the DANDI schema uses "$schema": "https://json-schema.org/draft/2020-12/schema")
const ajv = new Ajv2020({
  allErrors: true, // Report all errors, not just the first one
  strict: false, // Disable strict mode to allow schema keywords like nskey, sameas, etc.
  validateFormats: true,
});

// Add format validators (uri, email, date-time, etc.)
addFormats(ajv);

// Cache for compiled validators, keyed the same way as the schema cache
// (the bundled schema key or an instance apiUrl)
const validatorCache: Map<string, ReturnType<typeof ajv.compile>> = new Map();

/**
 * Get or compile a validator for the schema currently in use. The bundled
 * schema is always cached, so this always returns a validator.
 */
function getValidator(): ReturnType<typeof ajv.compile> {
  const key = getCurrentSchemaKey();

  const cached = validatorCache.get(key);
  if (cached) {
    return cached;
  }

  const validate = ajv.compile(getCachedSchema(key));
  validatorCache.set(key, validate);
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
 * Validate full metadata against the DANDI schema (synchronous version).
 * Validates against the schema currently in use: the one loaded from the
 * selected DANDI instance if that has arrived, otherwise the bundled copy.
 * Because a schema is always available, this never reports metadata as valid
 * merely for lack of a schema.
 * This is the primary validation function used by the UI
 */
export const validateFullMetadata = (
  fullMetadata: any,
): ValidationResult => {
  const validate = getValidator();
  const valid = validate(fullMetadata);

  return {
    valid: !!valid,
    errors: convertErrors(validate.errors),
  };
};

/**
 * Validate full metadata against the DANDI schema (async version).
 * Waits for any in-flight instance schema load before validating.
 */
export const validateFullMetadataAsync = async (
  fullMetadata: any
): Promise<ValidationResult> => {
  await fetchSchema();
  return validateFullMetadata(fullMetadata);
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
