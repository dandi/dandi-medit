/**
 * URL validation utilities for validating ORCID, ROR IDs, and other URLs
 * before they are added to the metadata schema.
 */

import { getProxiedUrl } from "../../utils/corsProxy";

// ORCID pattern: 0000-0000-0000-0000 or 0000-0000-0000-000X
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-(\d{3}X|\d{4})$/;

// ROR pattern: https://ror.org/0xxxxxxxx (alphanumeric)
const ROR_URL_PATTERN = /^https:\/\/ror\.org\/[a-z0-9]+$/;

// Generic URL pattern
const URL_PATTERN = /^https?:\/\/.+/;

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Strip an orcid.org prefix from an ORCID value, leaving the bare identifier
 * that the dandiset schema requires (for example "0000-0000-0000-0000").
 */
export function normalizeOrcid(value: string): string {
  return value.trim().replace(/^(https?:\/\/)?(www\.)?orcid\.org\//i, "").trim();
}

/**
 * Validate that an ORCID identifier resolves to a real person
 */
export async function validateOrcid(orcid: string): Promise<ValidationResult> {
  // Accept the URL form by reducing it to the bare identifier first
  orcid = normalizeOrcid(orcid);

  // First check format
  if (!ORCID_PATTERN.test(orcid)) {
    return {
      isValid: false,
      error: `Invalid ORCID format: "${orcid}". Expected format: 0000-0000-0000-0000 or 0000-0000-0000-000X`,
    };
  }

  // Check if it resolves via ORCID API
  try {
    const response = await fetch(`https://pub.orcid.org/v3.0/${orcid}`, {
      method: "HEAD",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return { isValid: true };
    } else if (response.status === 404) {
      return {
        isValid: false,
        error: `ORCID "${orcid}" does not exist. Please verify the ORCID is correct.`,
      };
    } else {
      // For other errors, we'll be lenient and assume it might be valid
      console.warn(`ORCID validation returned status ${response.status} for ${orcid}`);
      return { isValid: true };
    }
  } catch (error) {
    // Network error - be lenient
    console.warn(`Could not validate ORCID ${orcid}:`, error);
    return { isValid: true };
  }
}

/**
 * Validate that a ROR ID resolves to a real organization
 */
export async function validateRorId(rorUrl: string): Promise<ValidationResult> {
  // First check format
  if (!ROR_URL_PATTERN.test(rorUrl)) {
    return {
      isValid: false,
      error: `Invalid ROR ID format: "${rorUrl}". Expected format: https://ror.org/[alphanumeric]`,
    };
  }

  // Extract the ROR ID from the URL
  const rorId = rorUrl.replace("https://ror.org/", "");

  // Check if it resolves via ROR API
  try {
    const response = await fetch(`https://api.ror.org/organizations/${rorId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return { isValid: true };
    } else if (response.status === 404) {
      return {
        isValid: false,
        error: `ROR ID "${rorUrl}" does not exist. Please verify the ROR ID is correct.`,
      };
    } else {
      // For other errors, be lenient
      console.warn(`ROR validation returned status ${response.status} for ${rorUrl}`);
      return { isValid: true };
    }
  } catch (error) {
    // Network error - be lenient
    console.warn(`Could not validate ROR ID ${rorUrl}:`, error);
    return { isValid: true };
  }
}

/**
 * Validate that a generic URL resolves (returns 2xx or 3xx status)
 */
export async function validateUrl(url: string): Promise<ValidationResult> {
  // First check format
  if (!URL_PATTERN.test(url)) {
    return {
      isValid: false,
      error: `Invalid URL format: "${url}". URLs must start with http:// or https://`,
    };
  }

  // Skip validation for certain URLs that don't support HEAD requests well
  const skipValidationDomains = [
    "doi.org", // DOIs redirect and can be slow
    "dx.doi.org",
    "dandiarchive.org", // Internal DANDI URLs
  ];

  try {
    const parsedUrl = new URL(url);
    if (skipValidationDomains.some(domain => parsedUrl.hostname.includes(domain))) {
      return { isValid: true };
    }
  } catch {
    return {
      isValid: false,
      error: `Invalid URL: "${url}"`,
    };
  }

  // Browsers block cross-origin requests to sites that do not send CORS
  // headers, which is most of the web, so without a proxy a failed request
  // tells us nothing about whether the page exists. Rather than report a
  // validation that did not happen, accept the URL and skip the network call.
  const proxyUrl = getProxiedUrl(url);
  if (!proxyUrl) {
    return { isValid: true };
  }

  // Try to validate the URL resolves
  try {
    const response = await fetch(proxyUrl, {
      method: "HEAD",
    });

    if (response.ok || response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      return { isValid: true };
    } else if (response.status === 404) {
      return {
        isValid: false,
        error: `URL "${url}" does not exist (404 Not Found).`,
      };
    } else if (response.status === 405) {
      // Method not allowed - try GET instead
      const getResponse = await fetch(proxyUrl, { method: "GET" });
      if (getResponse.ok) {
        return { isValid: true };
      }
    }
    
    // For other status codes, be lenient
    return { isValid: true };
  } catch (error) {
    // Network error - be lenient
    console.warn(`Could not validate URL ${url}:`, error);
    return { isValid: true };
  }
}

/**
 * Detect and validate identifiers/URLs in a value based on the path
 */
export async function validateIdentifierInValue(
  path: string,
  value: unknown
): Promise<ValidationResult> {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return { isValid: true };
  }

  // Check if this is a Person identifier (ORCID)
  if (path.match(/contributor\.\d+\.identifier$/) || path.match(/affiliation\.\d+\.identifier$/)) {
    // Could be ORCID (Person) or ROR (Organization affiliation)
    if (typeof value === "string") {
      // Check if it looks like an ORCID
      if (ORCID_PATTERN.test(value)) {
        return validateOrcid(value);
      }
      // Check if it looks like a ROR URL
      if (ROR_URL_PATTERN.test(value)) {
        return validateRorId(value);
      }
    }
  }

  // Check for Person.identifier (ORCID)
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    
    // If it's a Person object with an identifier
    if (obj.schemaKey === "Person" && typeof obj.identifier === "string" && obj.identifier) {
      const orcidResult = await validateOrcid(obj.identifier);
      if (!orcidResult.isValid) {
        return orcidResult;
      }
    }
    
    // If it's an Organization or Affiliation with an identifier (ROR)
    if ((obj.schemaKey === "Organization" || obj.schemaKey === "Affiliation") && 
        typeof obj.identifier === "string" && obj.identifier) {
      const rorResult = await validateRorId(obj.identifier);
      if (!rorResult.isValid) {
        return rorResult;
      }
    }

    // Check nested affiliations
    if (Array.isArray(obj.affiliation)) {
      for (const aff of obj.affiliation) {
        if (typeof aff === "object" && aff !== null) {
          const affObj = aff as Record<string, unknown>;
          if (typeof affObj.identifier === "string" && affObj.identifier) {
            const rorResult = await validateRorId(affObj.identifier);
            if (!rorResult.isValid) {
              return rorResult;
            }
          }
        }
      }
    }

    // Check URL fields
    if (typeof obj.url === "string" && obj.url) {
      const urlResult = await validateUrl(obj.url);
      if (!urlResult.isValid) {
        return urlResult;
      }
    }
  }

  // Direct identifier field for Person
  if (path.endsWith(".identifier") && typeof value === "string") {
    // Check the parent path to determine type
    const parentPath = path.replace(/\.identifier$/, "");
    
    // If under contributor, could be ORCID or ROR
    if (parentPath.match(/contributor\.\d+$/)) {
      // Check format to determine type
      if (ORCID_PATTERN.test(value)) {
        return validateOrcid(value);
      }
      if (ROR_URL_PATTERN.test(value)) {
        return validateRorId(value);
      }
    }
    
    // Affiliation identifiers are ROR IDs
    if (parentPath.match(/affiliation\.\d+$/)) {
      if (ROR_URL_PATTERN.test(value)) {
        return validateRorId(value);
      }
    }
  }

  // Check URL fields
  if (path.endsWith(".url") && typeof value === "string" && value) {
    return validateUrl(value);
  }

  // Check protocol URLs (array of URLs)
  if (path === "protocol" && Array.isArray(value)) {
    for (const url of value) {
      if (typeof url === "string") {
        const result = await validateUrl(url);
        if (!result.isValid) {
          return result;
        }
      }
    }
  }

  return { isValid: true };
}
