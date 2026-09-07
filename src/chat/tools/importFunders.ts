/* eslint-disable @typescript-eslint/no-explicit-any */
import { QPTool, ToolExecutionContext } from "../types";
import { extractDoi } from "./importContributors";
import { stripAwardNumberPrefix } from "./proposeMetadataChange";

/**
 * Deterministic funder import from a publication.
 *
 * The funding section of a dandiset is a mechanical transcription of what
 * OpenAlex already knows: one Organization contributor per award, carrying the
 * funder name, the funder's ROR and the bare award identifier. Asking the model
 * to do that transcription costs a fetch of the work, a ROR lookup per funder
 * to confirm identifiers that OpenAlex already supplies, and six hand-typed
 * entries in a propose_metadata_change call. This tool does it in code: it
 * fetches the work once, builds the entries, merges them into the existing
 * contributor list without duplicating funders, and applies the result through
 * the normal validation and pending-changes review.
 */

export interface OpenAlexFunder {
  id?: string | null;
  display_name?: string | null;
  ror?: string | null;
}

export interface OpenAlexAward {
  id?: string | null;
  display_name?: string | null;
  funder_award_id?: string | null;
  funder_id?: string | null;
  funder_display_name?: string | null;
}

export interface OpenAlexFundingWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  funders?: OpenAlexFunder[];
  awards?: OpenAlexAward[];
}

export interface FunderContributor {
  schemaKey: "Organization";
  name: string;
  identifier?: string;
  roleName: string[];
  awardNumber?: string;
  includeInCitation: boolean;
  [key: string]: unknown;
}

export interface FunderMergeResult {
  contributors: any[];
  added: string[];
  matched: string[];
}

const OPENALEX_WORKS = "https://api.openalex.org/works";
const ROR_URL_PATTERN = /^https:\/\/ror\.org\/[a-z0-9]+$/;
const FUNDER_ROLES = new Set(["dcite:Funder", "dcite:Sponsor"]);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeOrganizationName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a contributor already carries a funding role. */
function hasFunderRole(contributor: any): boolean {
  const roles = Array.isArray(contributor?.roleName) ? contributor.roleName : [];
  return roles.some((role: unknown) => typeof role === "string" && FUNDER_ROLES.has(role));
}

/**
 * The bare award identifier, with any descriptive prefix removed. OpenAlex
 * mostly stores clean identifiers, but some records carry text such as
 * "Grant No. 12345", and the schema wants only the identifier.
 */
export function cleanAwardNumber(rawAward: string | null | undefined): string | null {
  if (typeof rawAward !== "string") return null;
  const cleaned = stripAwardNumberPrefix(rawAward.trim()).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function funderEntry(funder: OpenAlexFunder, awardNumber: string | null): FunderContributor | null {
  const name = funder.display_name?.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const entry: FunderContributor = {
    schemaKey: "Organization",
    name,
    roleName: ["dcite:Funder"],
    includeInCitation: false,
  };
  // Only a ROR that OpenAlex actually supplies, in the shape the schema wants.
  if (funder.ror && ROR_URL_PATTERN.test(funder.ror)) entry.identifier = funder.ror;
  if (awardNumber) entry.awardNumber = awardNumber;
  return entry;
}

/**
 * Build one Organization contributor per award, in funder order and then in the
 * order OpenAlex lists the awards. A funder with no awards becomes a single
 * entry with no award number so the user can supply it. An award whose funder is
 * not in the funders list still becomes an entry, using the funder name the
 * award carries and no identifier.
 */
export function fundersToContributors(work: OpenAlexFundingWork): FunderContributor[] {
  const funders = (work.funders || []).filter((f) => f?.display_name);
  const awards = work.awards || [];
  const entries: FunderContributor[] = [];
  const usedAwards = new Set<OpenAlexAward>();

  for (const funder of funders) {
    const own = awards.filter((a) => a?.funder_id && funder.id && a.funder_id === funder.id);
    if (own.length === 0) {
      const entry = funderEntry(funder, null);
      if (entry) entries.push(entry);
      continue;
    }
    for (const award of own) {
      usedAwards.add(award);
      const entry = funderEntry(funder, cleanAwardNumber(award.funder_award_id));
      if (entry) entries.push(entry);
    }
  }

  for (const award of awards) {
    if (usedAwards.has(award)) continue;
    const entry = funderEntry({ display_name: award?.funder_display_name }, cleanAwardNumber(award?.funder_award_id));
    if (entry) entries.push(entry);
  }

  return entries;
}

/** Funders that OpenAlex lists with no award attached. */
export function fundersWithoutAward(work: OpenAlexFundingWork): string[] {
  return fundersToContributors(work)
    .filter((entry) => !entry.awardNumber)
    .map((entry) => entry.name);
}

/** Distinct funder names for which OpenAlex has no ROR. */
export function fundersWithoutRor(work: OpenAlexFundingWork): string[] {
  const names: string[] = [];
  for (const entry of fundersToContributors(work)) {
    if (entry.identifier || names.includes(entry.name)) continue;
    names.push(entry.name);
  }
  return names;
}

/** True when an existing funder entry refers to the same organization. */
function sameOrganization(existing: any, proposed: FunderContributor): boolean {
  if (!hasFunderRole(existing)) return false;
  if (
    proposed.identifier &&
    typeof existing.identifier === "string" &&
    existing.identifier.trim() === proposed.identifier
  ) {
    return true;
  }
  return (
    typeof existing.name === "string" &&
    normalizeOrganizationName(existing.name) === normalizeOrganizationName(proposed.name)
  );
}

function existingAwardNumber(contributor: any): string | null {
  return typeof contributor?.awardNumber === "string" && contributor.awardNumber.trim()
    ? contributor.awardNumber.trim()
    : null;
}

/**
 * Merge imported funders into an existing contributor list.
 *
 * A proposed entry matches an existing contributor that carries a Funder or
 * Sponsor role, refers to the same organization (same ROR, or the same name
 * after normalization), and has the same award number, or has none when the
 * proposed entry has none either. A matched entry is kept exactly as it is,
 * including its spelling, roles and any extra fields; it only gains an
 * identifier or an award number that it was missing. Once those exact matches
 * are settled, a proposed entry that still has no match adopts an existing
 * entry for the same organization that carries no award number at all, which is
 * how a bare "National Institutes of Health" with no grant number gets
 * completed rather than duplicated.
 *
 * New entries are appended after the existing contributors, since funders
 * conventionally follow the people. Running the import twice therefore changes
 * nothing the second time.
 */
export function mergeFunders(existing: any[], imported: FunderContributor[]): FunderMergeResult {
  const contributors = (existing || []).map((c) => (c && typeof c === "object" ? { ...c } : c));
  const claimed = new Set<number>();
  const added: string[] = [];
  const matched: string[] = [];

  const findMatch = (proposed: FunderContributor, requireSameAward: boolean): number => {
    return contributors.findIndex((existingEntry, index) => {
      if (claimed.has(index)) return false;
      if (!sameOrganization(existingEntry, proposed)) return false;
      const award = existingAwardNumber(existingEntry);
      return requireSameAward ? award === (proposed.awardNumber || null) : award === null;
    });
  };

  const unmatched: FunderContributor[] = [];
  for (const proposed of imported) {
    const index = findMatch(proposed, true);
    if (index === -1) {
      unmatched.push(proposed);
      continue;
    }
    claimed.add(index);
    const current = contributors[index];
    if (!current.identifier && proposed.identifier) current.identifier = proposed.identifier;
    matched.push(current.name);
  }

  for (const proposed of unmatched) {
    const index = findMatch(proposed, false);
    if (index === -1) {
      contributors.push(proposed);
      added.push(proposed.name);
      continue;
    }
    claimed.add(index);
    const current = contributors[index];
    if (!current.identifier && proposed.identifier) current.identifier = proposed.identifier;
    if (proposed.awardNumber) current.awardNumber = proposed.awardNumber;
    matched.push(current.name);
  }

  return { contributors, added, matched };
}

/** Fetch a work with its funders and awards from OpenAlex. */
export async function fetchOpenAlexFunding(doi: string): Promise<OpenAlexFundingWork> {
  const url = `${OPENALEX_WORKS}/doi:${encodeURIComponent(doi)}?select=id,doi,title,funders,awards`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (response.status === 404) {
    throw new Error(`OpenAlex has no record for DOI ${doi}`);
  }
  if (!response.ok) {
    throw new Error(`OpenAlex returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as OpenAlexFundingWork;
}

export const importFundersTool: QPTool = {
  toolFunction: {
    name: "import_funders_from_publication",
    description:
      "Import the funders of a publication as contributors, deterministically. Give it a DOI (or a doi.org, bioRxiv or medRxiv link) and it fetches the funding record from OpenAlex, builds one Organization entry per award with the funder name, the funder's ROR and the bare award number, merges them into the existing contributors without duplicating funders, and proposes the result as a pending change. Use this instead of fetching OpenAlex and typing funder entries by hand.",
    parameters: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          description: "The publication DOI, for example 10.1016/j.neuron.2016.03.036, or a doi.org, bioRxiv or medRxiv URL.",
        },
        dryRun: {
          type: "boolean",
          description: "When true, report what would change without proposing it. Default false.",
        },
      },
      required: ["doi"],
    },
  },

  execute: async (params: { doi: string; dryRun?: boolean }, context: ToolExecutionContext) => {
    const doi = extractDoi(params.doi || "");
    if (!doi) {
      return {
        result: JSON.stringify({
          success: false,
          error: `Could not find a DOI in "${params.doi}". Provide a DOI such as 10.1016/j.neuron.2016.03.036 or a doi.org link.`,
        }),
      };
    }

    let work: OpenAlexFundingWork;
    try {
      work = await fetchOpenAlexFunding(doi);
    } catch (error) {
      return {
        result: JSON.stringify({
          success: false,
          doi,
          error: error instanceof Error ? error.message : "Failed to fetch the publication from OpenAlex",
        }),
      };
    }

    const imported = fundersToContributors(work);
    if (imported.length === 0) {
      return {
        result: JSON.stringify({
          success: false,
          doi,
          title: work.title,
          error: "OpenAlex lists no funders for this publication. Ask the user for the funders and award numbers.",
        }),
      };
    }

    const currentMetadata = context.modifiedMetadata || context.originalMetadata;
    const existing: any[] = Array.isArray(currentMetadata?.contributor) ? currentMetadata.contributor : [];
    const merge = mergeFunders(existing, imported);

    const summary: any = {
      success: true,
      doi,
      title: work.title,
      funderEntryCount: imported.length,
      added: merge.added,
      matchedExisting: merge.matched,
      fundersWithoutAward: fundersWithoutAward(work),
      fundersWithoutRor: fundersWithoutRor(work),
      contributors: merge.contributors,
    };

    if (params.dryRun) {
      summary.applied = false;
      summary.message = "Dry run: nothing was proposed. Call again without dryRun to propose these funders.";
      return { result: JSON.stringify(summary) };
    }

    if (JSON.stringify(existing) === JSON.stringify(merge.contributors)) {
      summary.applied = false;
      summary.message = "All funders are already present with the same details; nothing to change.";
      return { result: JSON.stringify(summary) };
    }

    const result = context.modifyMetadata("set", "contributor", merge.contributors);
    if (!result.success) {
      summary.success = false;
      summary.applied = false;
      summary.error = result.error || "The contributor list was rejected by validation.";
      return { result: JSON.stringify(summary) };
    }

    summary.applied = true;
    summary.message = `Proposed ${merge.added.length} new funder entr${merge.added.length === 1 ? "y" : "ies"} and updated ${merge.matched.length} existing one(s) from "${work.title}". The change is pending user review.`;
    return { result: JSON.stringify(summary) };
  },

  getDetailedDescription: () => {
    return `Use this tool whenever funding should be added from a paper. Do not fetch the OpenAlex work yourself and retype the funders into propose_metadata_change, and do not look up RORs for funders; OpenAlex already supplies them and this tool copies them across.

**Usage:**
- { "doi": "10.1016/j.neuron.2016.03.036" } fetches the funding record from OpenAlex and proposes the merged contributor list.
- { "doi": "https://doi.org/10.1016/j.neuron.2016.03.036", "dryRun": true } reports what would change without proposing it. Use a dry run first when the dandiset already has funders, then show the user the summary before applying.

**What it does:**
- One Organization entry per award, with schemaKey Organization, the funder name as OpenAlex spells it, the funder's ROR as identifier when OpenAlex has one, the dcite:Funder role, the bare award number, and includeInCitation false. A funder with several grants gets one entry per grant.
- Award numbers are the identifier only. A descriptive prefix such as "Grant No." is stripped, matching what propose_metadata_change requires.
- A funder that OpenAlex lists with no award becomes one entry with no award number, reported under fundersWithoutAward.
- No ROR is invented. A funder with no ROR in OpenAlex gets no identifier and is reported under fundersWithoutRor.
- Existing funders are matched by ROR or by name plus the same award number, kept exactly as they are, and only gain a missing identifier or award number. Everything else in the contributor list is left untouched.

**After it runs:**
- Tell the user which funders are missing an award number or a ROR so they can supply them, since the metadata checklist asks for both.
- Running it a second time on the same DOI changes nothing.`;
  },
};
