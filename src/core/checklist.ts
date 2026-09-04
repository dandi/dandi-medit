/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Metadata quality checklist, computed from the metadata itself.
 *
 * The checklist used to live only in the system prompt, and the model was
 * asked to tick boxes in its replies. That made the state a guess: nothing
 * was derived from the metadata, nothing persisted, and thorough dandisets
 * scored badly (#47). The rule-based items below are evaluated in code, so
 * the panel, the chat and the landing page all agree. The three judgment
 * items (title, description, methodology) are assessed by the model; until
 * an assessment is supplied they are reported as pending.
 */

export type ChecklistStatus = "pass" | "fail" | "pending";
export type ChecklistKind = "rule" | "assessment";

export interface ChecklistItem {
  id: string;
  label: string;
  kind: ChecklistKind;
  status: ChecklistStatus;
  /** One line explaining the status, naming what is missing where possible. */
  detail: string;
}

/** A model's verdict on one judgment item. */
export interface AssessmentVerdict {
  pass: boolean;
  reason: string;
}

/** Model assessment of the judgment items, keyed by item id. */
export interface ChecklistAssessment {
  titleInformative?: AssessmentVerdict;
  descriptionInformative?: AssessmentVerdict;
  methodologySummary?: AssessmentVerdict;
}

export interface ChecklistSummary {
  passed: number;
  failed: number;
  pending: number;
  total: number;
  /** Rule-based items only, which need no model and are comparable across dandisets. */
  rulesPassed: number;
  rulesTotal: number;
}

const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-(\d{3}X|\d{4})$/;
const ROR_PATTERN = /^https:\/\/ror\.org\/[a-z0-9]+$/;
const DOI_PATTERN = /(?:^|doi\.org\/|doi:|DOI:)\s*10\.\d{4,9}\/\S+/i;

/**
 * Keywords that add nothing beyond what the structured fields already say.
 * Compared after lowercasing and trimming.
 */
export const GENERIC_KEYWORDS = new Set([
  "neuroscience",
  "brain",
  "data",
  "dataset",
  "science",
  "biology",
  "research",
  "experiment",
  "experiments",
  "recording",
  "recordings",
  "nwb",
  "dandi",
  "dandiset",
  "neural data",
  "neural activity",
]);

/** Roles that mark a contributor as a funding organization. */
const FUNDER_ROLES = new Set(["dcite:Funder", "dcite:Sponsor"]);

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const roles = (c: any): string[] => asArray(c?.roleName).map(asString);
const isPerson = (c: any): boolean => c?.schemaKey === "Person";
const isFunder = (c: any): boolean => roles(c).some((r) => FUNDER_ROLES.has(r));
const displayName = (c: any): string => asString(c?.name) || "(unnamed)";

function listNames(names: string[], limit = 4): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

function hasDoi(resource: any): boolean {
  return DOI_PATTERN.test(asString(resource?.identifier)) || DOI_PATTERN.test(asString(resource?.url));
}

function ruleLicense(metadata: any): ChecklistItem {
  const license = asArray(metadata?.license).map(asString).filter(Boolean);
  return {
    id: "license",
    label: "License specified",
    kind: "rule",
    status: license.length > 0 ? "pass" : "fail",
    detail: license.length > 0 ? license.join(", ") : "No license is set.",
  };
}

function ruleAuthors(metadata: any): ChecklistItem {
  const people = asArray(metadata?.contributor).filter(isPerson);
  const authors = people.filter((c) => roles(c).includes("dcite:Author"));
  if (authors.length > 0) {
    return {
      id: "authors",
      label: "Authors listed as contributors",
      kind: "rule",
      status: "pass",
      detail: `${authors.length} author${authors.length === 1 ? "" : "s"}.`,
    };
  }
  return {
    id: "authors",
    label: "Authors listed as contributors",
    kind: "rule",
    status: "fail",
    detail:
      people.length > 0
        ? "No contributor has the dcite:Author role."
        : "No people are listed as contributors.",
  };
}

function ruleOrcids(metadata: any): ChecklistItem {
  const people = asArray(metadata?.contributor).filter(isPerson);
  const missing = people.filter((c) => !ORCID_PATTERN.test(asString(c?.identifier))).map(displayName);
  if (people.length === 0) {
    return { id: "orcids", label: "Contributors have ORCIDs", kind: "rule", status: "fail", detail: "No people are listed as contributors." };
  }
  return {
    id: "orcids",
    label: "Contributors have ORCIDs",
    kind: "rule",
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0 ? `All ${people.length} have an ORCID.` : `Missing ORCID: ${listNames(missing)}.`,
  };
}

function ruleAffiliations(metadata: any): ChecklistItem {
  const people = asArray(metadata?.contributor).filter(isPerson);
  const withoutRor = people
    .filter((c) => !asArray(c?.affiliation).some((a) => ROR_PATTERN.test(asString(a?.identifier))))
    .map(displayName);
  if (people.length === 0) {
    return { id: "affiliations", label: "Affiliations with ROR identifiers", kind: "rule", status: "fail", detail: "No people are listed as contributors." };
  }
  return {
    id: "affiliations",
    label: "Affiliations with ROR identifiers",
    kind: "rule",
    status: withoutRor.length === 0 ? "pass" : "fail",
    detail:
      withoutRor.length === 0
        ? `All ${people.length} have a ROR-linked affiliation.`
        : `No ROR-linked affiliation: ${listNames(withoutRor)}.`,
  };
}

function ruleFunders(metadata: any): ChecklistItem {
  const funders = asArray(metadata?.contributor).filter(isFunder);
  if (funders.length === 0) {
    return {
      id: "funders",
      label: "Funders with award numbers and RORs",
      kind: "rule",
      status: "fail",
      detail: "No funder (dcite:Funder or dcite:Sponsor) is listed.",
    };
  }
  const noAward = funders.filter((f) => !asString(f?.awardNumber)).map(displayName);
  const noRor = funders.filter((f) => !ROR_PATTERN.test(asString(f?.identifier))).map(displayName);
  const problems: string[] = [];
  if (noAward.length > 0) problems.push(`missing award number: ${listNames(noAward)}`);
  if (noRor.length > 0) problems.push(`missing ROR: ${listNames(noRor)}`);
  return {
    id: "funders",
    label: "Funders with award numbers and RORs",
    kind: "rule",
    status: problems.length === 0 ? "pass" : "fail",
    detail: problems.length === 0 ? `${funders.length} funder${funders.length === 1 ? "" : "s"}, all complete.` : `${problems.join("; ")}.`,
  };
}

function ruleAbout(metadata: any): ChecklistItem {
  const about = asArray(metadata?.about);
  const withId = about.filter((a) => asString(a?.identifier));
  if (about.length === 0) {
    return { id: "about", label: "Subject matter (brain regions, diseases, concepts)", kind: "rule", status: "fail", detail: "The about field is empty." };
  }
  return {
    id: "about",
    label: "Subject matter (brain regions, diseases, concepts)",
    kind: "rule",
    status: withId.length === about.length ? "pass" : "fail",
    detail:
      withId.length === about.length
        ? `${about.length} term${about.length === 1 ? "" : "s"}.`
        : `${about.length - withId.length} of ${about.length} entries have no ontology identifier.`,
  };
}

function ruleKeywords(metadata: any): ChecklistItem {
  const keywords = asArray(metadata?.keywords).map(asString).filter(Boolean);
  if (keywords.length === 0) {
    return { id: "keywords", label: "Specific keywords", kind: "rule", status: "fail", detail: "No keywords are set." };
  }
  const generic = keywords.filter((k) => GENERIC_KEYWORDS.has(k.toLowerCase()));
  return {
    id: "keywords",
    label: "Specific keywords",
    kind: "rule",
    status: generic.length === 0 ? "pass" : "fail",
    detail:
      generic.length === 0
        ? `${keywords.length} keyword${keywords.length === 1 ? "" : "s"}.`
        : `Too generic to add search value: ${listNames(generic)}.`,
  };
}

function rulePublication(metadata: any): ChecklistItem {
  const resources = asArray(metadata?.relatedResource);
  const withDoi = resources.filter(hasDoi);
  const complete = withDoi.filter((r) => asString(r?.relation));
  if (resources.length === 0) {
    return { id: "publication", label: "Related publication with DOI and relation", kind: "rule", status: "fail", detail: "No related resources are listed." };
  }
  if (withDoi.length === 0) {
    return { id: "publication", label: "Related publication with DOI and relation", kind: "rule", status: "fail", detail: "No related resource has a DOI." };
  }
  return {
    id: "publication",
    label: "Related publication with DOI and relation",
    kind: "rule",
    status: complete.length > 0 ? "pass" : "fail",
    detail:
      complete.length > 0
        ? `${complete.length} resource${complete.length === 1 ? "" : "s"} with a DOI and a relation.`
        : "A resource has a DOI but no relation (for example dcite:IsDescribedBy).",
  };
}

function ruleEthics(metadata: any): ChecklistItem {
  const approvals = asArray(metadata?.ethicsApproval).filter((e) => asString(e?.identifier));
  return {
    id: "ethics",
    label: "Ethics approval recorded",
    kind: "rule",
    status: approvals.length > 0 ? "pass" : "fail",
    detail:
      approvals.length > 0
        ? approvals.map((e) => asString(e.identifier)).join(", ")
        : "No ethics approval (IRB or IACUC protocol) is recorded. Ask the user for the protocol number.",
  };
}

function assessed(
  id: keyof ChecklistAssessment,
  label: string,
  verdict: AssessmentVerdict | undefined,
): ChecklistItem {
  if (!verdict) {
    return { id, label, kind: "assessment", status: "pending", detail: "Awaiting the assistant's assessment." };
  }
  return { id, label, kind: "assessment", status: verdict.pass ? "pass" : "fail", detail: verdict.reason };
}

/** Evaluate the checklist for a metadata object. */
export function computeChecklist(metadata: any, assessment: ChecklistAssessment = {}): ChecklistItem[] {
  return [
    assessed("titleInformative", "Title is informative", assessment.titleInformative),
    assessed("descriptionInformative", "Description is informative", assessment.descriptionInformative),
    assessed("methodologySummary", "Description summarizes the methodology", assessment.methodologySummary),
    ruleLicense(metadata),
    ruleAuthors(metadata),
    ruleOrcids(metadata),
    ruleAffiliations(metadata),
    ruleFunders(metadata),
    ruleAbout(metadata),
    ruleKeywords(metadata),
    rulePublication(metadata),
    ruleEthics(metadata),
  ];
}

export function summarizeChecklist(items: ChecklistItem[]): ChecklistSummary {
  const rules = items.filter((i) => i.kind === "rule");
  return {
    passed: items.filter((i) => i.status === "pass").length,
    failed: items.filter((i) => i.status === "fail").length,
    pending: items.filter((i) => i.status === "pending").length,
    total: items.length,
    rulesPassed: rules.filter((i) => i.status === "pass").length,
    rulesTotal: rules.length,
  };
}

/** Render the checklist as markdown for the system prompt. */
export function formatChecklistForPrompt(items: ChecklistItem[]): string {
  const lines = items.map((item) => {
    const box = item.status === "pass" ? "[x]" : item.status === "fail" ? "[ ]" : "[?]";
    return `- ${box} ${item.label}: ${item.detail}`;
  });
  const summary = summarizeChecklist(items);
  return `${lines.join("\n")}\n\n${summary.rulesPassed} of ${summary.rulesTotal} rule-based items pass; ${summary.pending} item${summary.pending === 1 ? "" : "s"} awaiting assessment.`;
}
