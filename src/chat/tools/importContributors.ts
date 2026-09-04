/* eslint-disable @typescript-eslint/no-explicit-any */
import { QPTool, ToolExecutionContext } from "../types";
import { normalizeOrcid } from "./validateUrls";

/**
 * Deterministic contributor import from a publication.
 *
 * Asking the model to read an OpenAlex response and retype fifty authors into
 * propose_metadata_change calls is where authors get skipped, reordered, or
 * given invented affiliations. This tool does the transcription in code: it
 * fetches the work from OpenAlex, builds one Person entry per author in
 * publication order, merges them into the existing contributor list without
 * duplicating people, and applies the result through the normal validation
 * and pending-changes review.
 */

export interface OpenAlexInstitution {
  id?: string | null;
  display_name?: string | null;
  ror?: string | null;
}

export interface OpenAlexAuthorship {
  author_position?: string;
  author: { id?: string | null; display_name: string; orcid?: string | null };
  institutions?: OpenAlexInstitution[];
  is_corresponding?: boolean;
  raw_author_name?: string | null;
}

export interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  authorships: OpenAlexAuthorship[];
}

export interface Affiliation {
  schemaKey: "Affiliation";
  name: string;
  identifier?: string;
}

export interface PersonContributor {
  schemaKey: "Person";
  name: string;
  identifier?: string;
  roleName: string[];
  includeInCitation: boolean;
  affiliation?: Affiliation[];
  [key: string]: unknown;
}

export interface MergeResult {
  contributors: any[];
  added: string[];
  matched: string[];
  carriedOver: string[];
}

const OPENALEX_WORKS = "https://api.openalex.org/works";
const ROR_URL_PATTERN = /^https:\/\/ror\.org\/[a-z0-9]+$/;

// Lowercase name particles that belong with the family name.
const PARTICLES = new Set([
  "van", "von", "der", "den", "de", "del", "della", "di", "da", "do", "dos", "das",
  "la", "le", "du", "des", "ten", "ter", "af", "av", "el", "al", "bin", "ibn",
]);

/**
 * Extract a DOI from a bare DOI, a doi: prefix, a doi.org URL, or a bioRxiv
 * or medRxiv content URL. Returns null when nothing DOI-like is present.
 */
export function extractDoi(input: string): string | null {
  const text = input.trim();
  const match = text.match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  if (!match) return null;
  let doi = match[0].replace(/[.,;)\]]+$/, "");
  // bioRxiv and medRxiv URLs carry a version suffix that OpenAlex does not index
  if (/^10\.1101\//i.test(doi)) doi = doi.replace(/v\d+$/i, "");
  return doi;
}

/**
 * Convert "Given Family" to the schema's "Family, Given" form. Names that
 * already contain a comma are left alone, and lowercase particles such as
 * "van" or "de la" stay with the family name.
 */
export function formatPersonName(displayName: string): string {
  const name = displayName.trim().replace(/\s+/g, " ");
  if (!name || name.includes(",")) return name;
  const parts = name.split(" ");
  if (parts.length === 1) return name;
  let familyStart = parts.length - 1;
  while (familyStart > 1 && PARTICLES.has(parts[familyStart - 1]) ) familyStart--;
  return `${parts.slice(familyStart).join(" ")}, ${parts.slice(0, familyStart).join(" ")}`;
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Key used to match people by name: family name plus first given name. */
export function nameMatchKey(name: string): string | null {
  const formatted = formatPersonName(name);
  const comma = formatted.indexOf(",");
  if (comma === -1) return null;
  const family = normalizeText(formatted.slice(0, comma));
  const given = normalizeText(formatted.slice(comma + 1)).split(" ")[0] || "";
  if (!family) return null;
  return `${family}|${given}`;
}

function affiliationFromInstitution(inst: OpenAlexInstitution): Affiliation | null {
  const name = inst.display_name?.trim();
  if (!name) return null;
  const affiliation: Affiliation = { schemaKey: "Affiliation", name };
  if (inst.ror && ROR_URL_PATTERN.test(inst.ror)) affiliation.identifier = inst.ror;
  return affiliation;
}

/** Build a Person contributor from one OpenAlex authorship. */
export function authorshipToContributor(authorship: OpenAlexAuthorship): PersonContributor {
  const person: PersonContributor = {
    schemaKey: "Person",
    name: formatPersonName(authorship.author.display_name),
    roleName: ["dcite:Author"],
    includeInCitation: true,
  };
  if (authorship.author.orcid) {
    const orcid = normalizeOrcid(authorship.author.orcid);
    if (orcid) person.identifier = orcid;
  }
  const seen = new Set<string>();
  const affiliations: Affiliation[] = [];
  for (const inst of authorship.institutions || []) {
    const affiliation = affiliationFromInstitution(inst);
    if (!affiliation) continue;
    const key = affiliation.identifier || normalizeText(affiliation.name);
    if (seen.has(key)) continue;
    seen.add(key);
    affiliations.push(affiliation);
  }
  if (affiliations.length > 0) person.affiliation = affiliations;
  return person;
}

/** Build contributors for every authorship, in publication order. */
export function authorshipsToContributors(work: OpenAlexWork): PersonContributor[] {
  return (work.authorships || [])
    .filter((a) => a?.author?.display_name)
    .map(authorshipToContributor);
}

function affiliationKey(aff: any): string | null {
  if (!aff || typeof aff !== "object") return null;
  if (typeof aff.identifier === "string" && aff.identifier) return aff.identifier;
  if (typeof aff.name === "string" && aff.name) return normalizeText(aff.name);
  return null;
}

/**
 * Merge imported authors into an existing contributor list.
 *
 * People are matched by ORCID first and then by family name plus first given
 * name. A matched entry keeps everything it already has (name spelling, email,
 * roles, extra fields); it only gains a missing ORCID, missing affiliations,
 * and the dcite:Author role. The result lists the publication's authors in
 * publication order followed by any existing contributors that were not
 * matched, such as funders and organizations, so re-running the import is
 * idempotent.
 */
export function mergeContributors(existing: any[], imported: PersonContributor[]): MergeResult {
  const remaining = (existing || []).map((c) => ({ ...c }));
  const merged: any[] = [];
  const added: string[] = [];
  const matched: string[] = [];

  const findMatch = (person: PersonContributor): number => {
    const orcid = person.identifier;
    if (orcid) {
      const byOrcid = remaining.findIndex(
        (c) => c?.schemaKey === "Person" && typeof c.identifier === "string" && normalizeOrcid(c.identifier) === orcid,
      );
      if (byOrcid !== -1) return byOrcid;
    }
    const key = nameMatchKey(person.name);
    if (!key) return -1;
    return remaining.findIndex(
      (c) => c?.schemaKey === "Person" && typeof c.name === "string" && nameMatchKey(c.name) === key,
    );
  };

  for (const person of imported) {
    const index = findMatch(person);
    if (index === -1) {
      merged.push(person);
      added.push(person.name);
      continue;
    }
    const [current] = remaining.splice(index, 1);
    const updated: any = { ...current };
    if (!updated.identifier && person.identifier) updated.identifier = person.identifier;
    const roles: string[] = Array.isArray(updated.roleName) ? [...updated.roleName] : [];
    if (!roles.includes("dcite:Author")) roles.push("dcite:Author");
    updated.roleName = roles;
    if (person.affiliation) {
      const existingAffiliations: any[] = Array.isArray(updated.affiliation) ? [...updated.affiliation] : [];
      const keys = new Set(existingAffiliations.map(affiliationKey).filter(Boolean));
      for (const aff of person.affiliation) {
        const key = affiliationKey(aff);
        if (key && !keys.has(key)) {
          existingAffiliations.push(aff);
          keys.add(key);
        }
      }
      if (existingAffiliations.length > 0) updated.affiliation = existingAffiliations;
    }
    merged.push(updated);
    matched.push(updated.name);
  }

  return {
    contributors: [...merged, ...remaining],
    added,
    matched,
    carriedOver: remaining.map((c) => (typeof c?.name === "string" ? c.name : "(unnamed)")),
  };
}

/** Fetch a work with its authorships from OpenAlex. */
export async function fetchOpenAlexWork(doi: string): Promise<OpenAlexWork> {
  const url = `${OPENALEX_WORKS}/doi:${encodeURIComponent(doi)}?select=id,doi,title,authorships`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (response.status === 404) {
    throw new Error(`OpenAlex has no record for DOI ${doi}`);
  }
  if (!response.ok) {
    throw new Error(`OpenAlex returned ${response.status} ${response.statusText}`);
  }
  const work = (await response.json()) as OpenAlexWork;
  if (!Array.isArray(work.authorships)) {
    throw new Error("OpenAlex response did not include authorships");
  }
  return work;
}

export const importContributorsTool: QPTool = {
  toolFunction: {
    name: "import_contributors_from_publication",
    description:
      "Import the authors of a publication as contributors, deterministically. Give it a DOI (or a doi.org, bioRxiv or medRxiv link) and it fetches the author list from OpenAlex, builds a Person entry for each author in publication order with a bare ORCID and ROR-linked affiliations where available, merges them into the existing contributors without duplicating anyone, and proposes the result as a pending change. Use this instead of transcribing author lists by hand.",
    parameters: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          description: "The publication DOI, for example 10.7554/eLife.78362, or a doi.org, bioRxiv or medRxiv URL.",
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
          error: `Could not find a DOI in "${params.doi}". Provide a DOI such as 10.7554/eLife.78362 or a doi.org link.`,
        }),
      };
    }

    let work: OpenAlexWork;
    try {
      work = await fetchOpenAlexWork(doi);
    } catch (error) {
      return {
        result: JSON.stringify({
          success: false,
          doi,
          error: error instanceof Error ? error.message : "Failed to fetch the publication from OpenAlex",
        }),
      };
    }

    const imported = authorshipsToContributors(work);
    if (imported.length === 0) {
      return {
        result: JSON.stringify({
          success: false,
          doi,
          title: work.title,
          error: "OpenAlex lists no authors for this publication.",
        }),
      };
    }

    const currentMetadata = context.modifiedMetadata || context.originalMetadata;
    const existing: any[] = Array.isArray(currentMetadata?.contributor) ? currentMetadata.contributor : [];
    const merge = mergeContributors(existing, imported);

    const missingOrcid = imported.filter((p) => !p.identifier).map((p) => p.name);
    const missingRor = imported
      .filter((p) => (p.affiliation || []).some((a) => !a.identifier))
      .map((p) => p.name);

    const summary: any = {
      success: true,
      doi,
      title: work.title,
      authorCount: imported.length,
      added: merge.added,
      matchedExisting: merge.matched,
      carriedOverUnchanged: merge.carriedOver,
      missingOrcid,
      affiliationsWithoutRor: missingRor,
      contributors: merge.contributors,
    };

    if (params.dryRun) {
      summary.applied = false;
      summary.message = "Dry run: nothing was proposed. Call again without dryRun to propose these contributors.";
      return { result: JSON.stringify(summary) };
    }

    const noChange = merge.added.length === 0 && JSON.stringify(existing) === JSON.stringify(merge.contributors);
    if (noChange) {
      summary.applied = false;
      summary.message = "All authors are already present with the same details; nothing to change.";
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
    summary.message = `Proposed ${merge.added.length} new contributor(s) and updated ${merge.matched.length} existing one(s) from "${work.title}". The change is pending user review.`;
    return { result: JSON.stringify(summary) };
  },

  getDetailedDescription: () => {
    return `Use this tool whenever contributors should be added from a paper. Do not read an OpenAlex response and retype the authors yourself; this tool does that in code so that no author is skipped or reordered.

**Usage:**
- { "doi": "10.7554/eLife.78362" } fetches the work from OpenAlex and proposes the merged contributor list.
- { "doi": "https://doi.org/10.7554/eLife.78362", "dryRun": true } reports what would change without proposing it. Use a dry run first when the dandiset already has contributors, then show the user the summary before applying.

**What it does:**
- One Person entry per author, in publication order, with name as "Family, Given", a bare ORCID when OpenAlex has one, the dcite:Author role, and affiliations with ROR identifiers where available.
- Existing contributors are matched by ORCID, then by family name plus first given name. Matched entries keep their spelling, email, roles and other fields, and only gain a missing ORCID, missing affiliations and the Author role.
- Existing contributors that are not authors of the paper (funders, organizations, other people) are kept after the authors.
- The result is proposed as a single change to the contributor array and goes through schema validation like any other change.

**After it runs:**
- Tell the user how many contributors were added or updated, and list any authors without an ORCID or affiliations without a ROR so they can be completed by hand.
- Contact person and email are not set by this tool; ask the user who the contact person is if the dandiset has none.
- Funding information is not imported here; use fetch_url on https://api.openalex.org/works/doi:{doi}?select=id,title,funders,awards for that.`;
  },
};
