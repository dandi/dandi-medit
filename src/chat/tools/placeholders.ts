/**
 * Detection of placeholder values in proposed metadata.
 *
 * When a model imports metadata from a paper and finds no source for a field,
 * it sometimes fills the field with a stub such as "N/A", "TBD", "[insert
 * approval number]" or an all-zero ORCID rather than leaving it out. Those
 * stubs pass schema validation and end up in the archive. This module finds
 * them so propose_metadata_change can reject the change and tell the model to
 * omit the field or ask the user instead.
 *
 * Only whole-string matches (after trimming and lowercasing) and explicit
 * template markers are flagged, so ordinary prose that happens to contain a
 * word like "unknown" is not.
 */

export interface PlaceholderFinding {
  path: string;
  value: string;
}

const PLACEHOLDER_WORDS = new Set([
  "",
  "n/a",
  "na",
  "n.a.",
  "none",
  "null",
  "nil",
  "undefined",
  "unknown",
  "not known",
  "not available",
  "not applicable",
  "not specified",
  "not provided",
  "not reported",
  "not listed",
  "not found",
  "no data",
  "no information",
  "tbd",
  "tba",
  "tbc",
  "to be determined",
  "to be added",
  "to be confirmed",
  "todo",
  "pending",
  "placeholder",
  "example",
  "test",
  "xxx",
  "xxxx",
  "???",
  "...",
  "-",
  "--",
  "?",
]);

// Template markers such as "[insert email]", "<approval number>", "{DOI}",
// "INSERT_ORCID", "your name here", and identifier-shaped zero fillers.
const TEMPLATE_PATTERNS: RegExp[] = [
  /^\[.*\]$/, // [Insert ...], [TBD], [author name]
  /^<.*>$/, // <approval number>
  /^\{.*\}$/, // {DOI}
  /\b(insert|enter|add|fill in|provide|replace)\b.*\b(here|value|number|name|email|id|identifier|url|link|date)\b/i,
  /\byour (name|email|orcid|institution|affiliation|title|description)\b/i,
  /\b(lorem ipsum)\b/i,
  /^placeholder\b/i,
  /^(example|sample|dummy|fake|test)[ _-](value|entry|text|email|name|title|description|data)\b/i,
  /^0000-0000-0000-000[0x]$/i, // all-zero ORCID
  /^https?:\/\/ror\.org\/(x+|0+|[a-z0-9]*x{3,}[a-z0-9]*)$/i, // https://ror.org/XXXXXXX
  /^https?:\/\/(doi\.org|dx\.doi\.org)\/10\.(x+|0000)\//i, // https://doi.org/10.xxxx/...
  /@(example|test|email|domain|placeholder)\.(com|org|net)$/i, // someone@example.com
  /^(irb|iacuc|ethics|protocol|approval)[\s_-]?(number|no\.?|#|id)?[\s:#-]*$/i, // "IRB number" with nothing after
];

/** True when a single string looks like a placeholder rather than real data. */
export function isPlaceholderString(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lower)) return true;
  return TEMPLATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Walk a proposed value and return every string leaf that looks like a
 * placeholder, with its dot path relative to the proposal path.
 */
export function findPlaceholderValues(value: unknown, path = ""): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  const visit = (node: unknown, nodePath: string) => {
    if (typeof node === "string") {
      if (isPlaceholderString(node)) findings.push({ path: nodePath, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, nodePath ? `${nodePath}.${index}` : String(index)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        // schemaKey values are fixed constants, never user data
        if (key === "schemaKey") continue;
        visit(child, nodePath ? `${nodePath}.${key}` : key);
      }
    }
  };
  visit(value, path);
  return findings;
}

/** Format findings for the error returned to the model. */
export function describePlaceholderFindings(findings: PlaceholderFinding[]): string {
  const list = findings
    .slice(0, 5)
    .map((f) => `${f.path || "(value)"}: ${JSON.stringify(f.value)}`)
    .join("; ");
  const more = findings.length > 5 ? ` and ${findings.length - 5} more` : "";
  return (
    `The proposed value contains placeholder text (${list}${more}). ` +
    "Do not add stub or placeholder entries for information you do not have. " +
    "Omit the field, or tell the user what is missing and ask them to provide it."
  );
}
