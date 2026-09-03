/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Proposal link utilities for sharing metadata changes.
 * 
 * A proposal link contains:
 * - The dandiset ID (in the URL path/query)
 * - A SHA-256 hash of the original metadata (for verification)
 * - A jsondiffpatch delta (the proposed changes)
 */

import type { Delta } from 'jsondiffpatch';
import { computeDelta, applyDelta } from './metadataDiff';
import type { DandisetMetadata } from '../types/dandiset';

export interface ProposalData {
  /** SHA-256 hash (lowercase hex) of the canonical original metadata JSON */
  h: string;
  /** jsondiffpatch delta representing the changes */
  d: Delta;
}

export type ProposalValidationResult = {
  success: true;
  modifiedMetadata: DandisetMetadata;
} | {
  success: false;
  error: string;
};

/**
 * Produce a canonical JSON string for a value: object keys are sorted
 * recursively at every level of nesting and array order is preserved.
 *
 * Note that JSON.stringify(obj, keys) with an array as the second argument
 * treats it as a property whitelist applied at every level, which would drop
 * nested properties whose names are not also top-level keys.
 */
function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function toCanonicalJson(obj: any): string {
  return JSON.stringify(canonicalize(obj));
}

/**
 * Compute the SHA-256 hash (lowercase hex) of the canonical JSON
 * representation of metadata.
 */
export async function computeMetadataHash(metadata: any): Promise<string> {
  const canonical = toCanonicalJson(metadata);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a proposal link URL for sharing metadata changes.
 * 
 * @param dandisetId - The dandiset ID
 * @param originalMetadata - The original (unmodified) metadata
 * @param modifiedMetadata - The metadata with proposed changes
 * @returns The full URL with proposal encoded, or null if no changes
 */
export async function createProposalLink(
  dandisetId: string,
  originalMetadata: DandisetMetadata,
  modifiedMetadata: DandisetMetadata
): Promise<string | null> {
  // Compute the delta
  const delta = computeDelta(originalMetadata, modifiedMetadata);
  
  if (!delta) {
    // No changes to share
    return null;
  }
  
  // Compute hash of original metadata
  const hash = await computeMetadataHash(originalMetadata);
  
  // Create proposal data
  const proposalData: ProposalData = {
    h: hash,
    d: delta
  };
  
  // Encode as base64
  const jsonStr = JSON.stringify(proposalData);
  const base64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) => 
    String.fromCharCode(parseInt(p1, 16))
  ));
  
  // Build URL
  const url = new URL(window.location.href);
  url.searchParams.set('dandiset', dandisetId);
  url.searchParams.set('proposal', base64);
  url.searchParams.set('review', '1');
  // Remove any other params that shouldn't be shared
  url.searchParams.delete('version');
  
  return url.toString();
}

/**
 * Parse proposal data from URL query parameters.
 *
 * @returns The proposal data if present and valid, null otherwise
 */
export function parseProposalFromUrl(): ProposalData | null {
  const params = new URLSearchParams(window.location.search);
  const proposalParam = params.get('proposal');

  if (!proposalParam) {
    return null;
  }

  try {
    // Decode from base64
    const decoded = atob(proposalParam);
    const jsonStr = decodeURIComponent(
      decoded
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const data = JSON.parse(jsonStr) as ProposalData;

    // Validate structure
    if (!data.h || typeof data.h !== 'string' || !data.d) {
      console.error('[Proposal Parse] Invalid proposal data structure:', data);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[Proposal Parse] Failed to parse proposal from URL:', error);
    return null;
  }
}

/**
 * Validate a proposal against current metadata and apply it if valid.
 * 
 * @param proposal - The proposal data from the URL
 * @param currentMetadata - The current metadata from the server
 * @returns Result indicating success with modified metadata, or failure with error
 */
export async function validateAndApplyProposal(
  proposal: ProposalData,
  currentMetadata: DandisetMetadata
): Promise<ProposalValidationResult> {
  // Compute hash of current metadata
  const currentHash = await computeMetadataHash(currentMetadata);
  
  // Check if hashes match
  if (currentHash !== proposal.h) {
    return {
      success: false,
      error: 'The metadata has changed since this proposal was created. The proposed changes can no longer be applied safely.'
    };
  }
  
  try {
    // Clone the metadata and apply the delta
    const cloned = JSON.parse(JSON.stringify(currentMetadata)) as DandisetMetadata;
    const modified = applyDelta(cloned, proposal.d);
    
    return {
      success: true,
      modifiedMetadata: modified
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply proposed changes: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Clear proposal-related parameters from the URL without reloading.
 */
export function clearProposalFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('proposal');
  window.history.replaceState({}, '', url.toString());
}
