/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Service for loading and caching the DANDI dandiset JSON schema.
 *
 * A copy of the schema is bundled with the app and seeded into the cache at
 * module load, so synchronous consumers (validation, readOnly field
 * protection) always have a schema to work with. When a DANDI instance is
 * selected, the schema that instance actually serves is fetched from
 * `${apiUrl}/schemas/?model=Dandiset` and becomes the current schema. If that
 * request fails, the bundled copy stays in use.
 *
 * The bundled copy should be refreshed when dandischema releases a new
 * version: replace src/schemas/dandiset-schema-<version>.json, update the
 * import below, and update BUNDLED_SCHEMA_VERSION.
 */

import bundledSchema from "./dandiset-schema-0.7.0.json";

/** Version of the schema bundled with the app. */
export const BUNDLED_SCHEMA_VERSION = "0.7.0";

/** Cache key under which the bundled schema is stored. */
export const BUNDLED_SCHEMA_KEY = "bundled";

// Cache of loaded schemas. The bundled schema is keyed by BUNDLED_SCHEMA_KEY;
// schemas fetched from a DANDI instance are keyed by that instance's apiUrl.
const schemaCache: Map<string, any> = new Map([[BUNDLED_SCHEMA_KEY, bundledSchema]]);

// Key of the schema that consumers should currently use.
let currentSchemaKey: string = BUNDLED_SCHEMA_KEY;

// The apiUrl most recently requested via loadSchemaForInstance. Used to make
// sure a slow response for an earlier instance does not overwrite the schema
// for the instance the user has since switched to.
let requestedApiUrl: string | null = null;

// The in-flight instance load, if any, so async consumers can wait for it.
let pendingLoad: Promise<any> | null = null;

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

/**
 * Get the URL from which a DANDI instance serves its dandiset schema
 */
export function getInstanceSchemaUrl(apiUrl: string): string {
  return `${normalizeApiUrl(apiUrl)}/schemas/?model=Dandiset`;
}

/**
 * Key of the schema currently in use (BUNDLED_SCHEMA_KEY or an instance apiUrl)
 */
export function getCurrentSchemaKey(): string {
  return currentSchemaKey;
}

/**
 * Get a cached schema synchronously. With no key, returns the current schema,
 * which is always available because the bundled schema seeds the cache.
 */
export function getCachedSchema(key?: string): any | undefined {
  return schemaCache.get(key ?? currentSchemaKey);
}

/**
 * Read the schema version string out of a schema (from the schemaVersion
 * property's default), if present.
 */
export function getSchemaVersion(schema: any): string | undefined {
  const version = schema?.properties?.schemaVersion?.default;
  return typeof version === "string" ? version : undefined;
}

/**
 * Get the version of the schema currently in use
 */
export function getCurrentSchemaVersion(): string {
  return getSchemaVersion(getCachedSchema()) ?? BUNDLED_SCHEMA_VERSION;
}

/**
 * Load the dandiset schema served by a DANDI instance and make it the current
 * schema. Falls back to the bundled schema if the request fails. Never rejects.
 */
export async function loadSchemaForInstance(apiUrl: string): Promise<any> {
  const key = normalizeApiUrl(apiUrl);
  requestedApiUrl = key;

  if (schemaCache.has(key)) {
    currentSchemaKey = key;
    return schemaCache.get(key);
  }

  const load = (async () => {
    try {
      const response = await fetch(getInstanceSchemaUrl(key));
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const schema = await response.json();
      if (!schema || typeof schema !== "object" || !schema.properties) {
        throw new Error("Response does not look like a JSON schema");
      }
      schemaCache.set(key, schema);
      if (requestedApiUrl === key) {
        currentSchemaKey = key;
      }
      return schema;
    } catch (error) {
      console.warn(
        `Failed to load dandiset schema from ${key}; using bundled schema v${BUNDLED_SCHEMA_VERSION}:`,
        error
      );
      if (requestedApiUrl === key) {
        currentSchemaKey = BUNDLED_SCHEMA_KEY;
      }
      return schemaCache.get(BUNDLED_SCHEMA_KEY);
    }
  })();

  pendingLoad = load;
  try {
    return await load;
  } finally {
    if (pendingLoad === load) {
      pendingLoad = null;
    }
  }
}

/**
 * Get the current schema, waiting for any in-flight instance load first.
 * Always resolves, because the bundled schema is available as a fallback.
 */
export async function fetchSchema(): Promise<any> {
  if (pendingLoad) {
    await pendingLoad;
  }
  return getCachedSchema();
}

/**
 * Reset the cache to just the bundled schema
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
  schemaCache.set(BUNDLED_SCHEMA_KEY, bundledSchema);
  currentSchemaKey = BUNDLED_SCHEMA_KEY;
  requestedApiUrl = null;
}

/**
 * Extract all top-level readOnly field names from the schema
 */
export function getReadOnlyFields(schema: any): Set<string> {
  const readOnlyFields = new Set<string>();

  if (!schema?.properties) {
    return readOnlyFields;
  }

  for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
    if ((fieldDef as any)?.readOnly === true) {
      readOnlyFields.add(fieldName);
    }
  }

  return readOnlyFields;
}

/**
 * Get readOnly fields from the current schema (sync)
 */
export function getReadOnlyFieldsSync(): Set<string> {
  return getReadOnlyFields(getCachedSchema());
}

/**
 * Remove readOnly fields from a metadata object
 */
export function filterOutReadOnlyFields(metadata: any, schema: any): any {
  if (!metadata || typeof metadata !== "object") {
    return metadata;
  }

  const readOnlyFields = getReadOnlyFields(schema);
  const filtered: any = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!readOnlyFields.has(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
}
