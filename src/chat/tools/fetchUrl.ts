import { QPTool, ToolExecutionContext } from "../types";
import allowedDomains from "./allowedDomains.json";
import { getProxiedUrl } from "../../utils/corsProxy";

/**
 * A tool that allows the AI to fetch content from external URLs.
 * This addresses the hallucination issue where the AI would fabricate
 * metadata instead of actually retrieving it from external sources.
 *
 * The browser cannot read most cross-origin pages directly, so publication
 * links (DOI, PubMed, bioRxiv, medRxiv) are resolved through OpenAlex and
 * Europe PMC, both of which send CORS headers. Other pages are fetched
 * directly when the site allows it and otherwise through the optional proxy
 * configured with VITE_CORS_PROXY_URL.
 */

// Domains fetch_url may retrieve. The list is shared with the CORS proxy
// worker in proxy/, which enforces the same allowlist server side.
const ALLOWED_DOMAINS: string[] = allowedDomains;

// Fields useful for metadata extraction; keeps OpenAlex responses small
const OPENALEX_WORK_SELECT =
  "id,doi,title,display_name,authorships,publication_year,publication_date,funders,keywords";

const EUROPE_PMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";
// PubMed Central full text through NCBI E-utilities, which sends CORS headers
const NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

// Limits for the `find` option: how many passages to return and how long
// the combined excerpt may be, so a targeted search stays cheap.
const MAX_PASSAGES = 15;
const MAX_PASSAGE_LENGTH = 700;
const MAX_EXCERPT_LENGTH = 8000;

const FETCH_HEADERS = {
  Accept:
    "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// OpenRouter rejects messages over 100000 characters, and the JSON wrapper
// adds indentation and escaping overhead, so cap the final serialized
// result well below that limit rather than the raw content length.
const MAX_RESULT_LENGTH = 80000;

const isUrlAllowed = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
};

/**
 * A publication identified from a URL: either a DOI or a PubMed ID.
 */
type PublicationRef = { doi: string; pmid?: undefined } | { pmid: string; doi?: undefined };

/**
 * Recognize URLs that point at a publication we can resolve through
 * OpenAlex and Europe PMC instead of fetching the page itself.
 */
const identifyPublication = (parsedUrl: URL): PublicationRef | null => {
  const hostname = parsedUrl.hostname.toLowerCase();
  const path = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, "");

  if (hostname === "doi.org" || hostname === "dx.doi.org") {
    return path.startsWith("10.") ? { doi: path } : null;
  }

  if (hostname.endsWith("biorxiv.org") || hostname.endsWith("medrxiv.org")) {
    // Preprint pages look like /content/10.1101/2023.05.10.540238v2.full or
    // /content/early/2023/05/12/2023.05.10.540238. The DOI is 10.1101/<id>
    // without the version suffix.
    const withPrefix = path.match(/10\.1101\/(\d[\d.]*\d)/);
    const bare = path.match(/(?:^|\/)(\d{4}\.\d{2}\.\d{2}\.\d{6,})(?:v\d+)?(?:[./]|$)/);
    const id = withPrefix?.[1] ?? bare?.[1];
    return id ? { doi: `10.1101/${id}` } : null;
  }

  if (hostname === "pubmed.ncbi.nlm.nih.gov") {
    const match = path.match(/^(\d+)/);
    return match ? { pmid: match[1] } : null;
  }

  return null;
};

interface EuropePmcResult {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  journalInfo?: { journal?: { title?: string } };
  pubYear?: string;
  abstractText?: string;
  isOpenAccess?: string;
}

const searchEuropePmc = async (query: string): Promise<EuropePmcResult | null> => {
  const searchUrl = `${EUROPE_PMC_REST}/search?query=${encodeURIComponent(query)}&format=json&resultType=core`;
  const response = await fetch(searchUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Europe PMC search failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { resultList?: { result?: EuropePmcResult[] } };
  return data.resultList?.result?.[0] ?? null;
};

/**
 * Resolve a publication through OpenAlex and Europe PMC. The pieces are
 * combined into one text result: OpenAlex metadata first, then the abstract,
 * then open-access full text when Europe PMC has it.
 */
const fetchPublication = async (ref: PublicationRef): Promise<{ content: string; notes: string[] }> => {
  const parts: string[] = [];
  const notes: string[] = [];

  let record: EuropePmcResult | null = null;
  try {
    const query = ref.doi ? `DOI:${ref.doi}` : `EXT_ID:${ref.pmid} AND SRC:MED`;
    record = await searchEuropePmc(query);
    if (!record) {
      notes.push("Europe PMC has no record for this publication.");
    }
  } catch (error) {
    notes.push(`Europe PMC lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const doi = ref.doi ?? record?.doi;
  if (doi) {
    try {
      const openAlexUrl = `https://api.openalex.org/works/doi:${doi}?select=${OPENALEX_WORK_SELECT}`;
      const response = await fetch(openAlexUrl, { headers: { Accept: "application/json" } });
      if (response.ok) {
        const work = await response.json();
        parts.push(`OpenAlex metadata for DOI ${doi}:\n${JSON.stringify(work, null, 2)}`);
      } else {
        notes.push(`OpenAlex lookup for DOI ${doi} failed: HTTP ${response.status}`);
      }
    } catch (error) {
      notes.push(`OpenAlex lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  } else {
    notes.push("No DOI could be determined for this publication, so OpenAlex was not queried.");
  }

  if (record) {
    const header = [
      record.title ? `Title: ${record.title}` : null,
      record.journalInfo?.journal?.title ? `Journal: ${record.journalInfo.journal.title}` : null,
      record.pubYear ? `Year: ${record.pubYear}` : null,
      record.pmid ? `PMID: ${record.pmid}` : null,
      record.pmcid ? `PMCID: ${record.pmcid}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n");
    const abstract = record.abstractText
      ? extractTextFromHtml(record.abstractText)
      : "(no abstract available)";
    parts.push(`Europe PMC record:\n${header}\n\nAbstract:\n${abstract}`);

    if (record.pmcid) {
      const fullText = await fetchFullText(record.pmcid, notes);
      if (fullText) {
        parts.push(`Full text (${fullText.source}):\n${fullText.text}`);
      } else {
        notes.push(
          "Full text is not available from Europe PMC or PubMed Central. These are the only full-text sources this tool can read, so do not try other URLs for this paper; ask the user for the information instead.",
        );
      }
    } else {
      notes.push(
        "This publication has no PubMed Central record, so no full text is available to this tool. Do not try other URLs for this paper; ask the user for the information instead.",
      );
    }
  }

  return { content: parts.join("\n\n"), notes };
};

/**
 * Fetch the full text of a PubMed Central article. Europe PMC serves XML for
 * open-access articles; author manuscripts and others are often only in
 * PubMed Central itself, which NCBI's E-utilities serve with CORS headers.
 * Returns null, with a note per source tried, when neither has it.
 */
const fetchFullText = async (
  pmcid: string,
  notes: string[],
): Promise<{ text: string; source: string } | null> => {
  try {
    const response = await fetch(`${EUROPE_PMC_REST}/${pmcid}/fullTextXML`, {
      headers: { Accept: "application/xml" },
    });
    if (response.ok) {
      return { text: extractTextFromHtml(await response.text()), source: `Europe PMC ${pmcid}` };
    }
    notes.push(`Europe PMC has no full text for ${pmcid} (HTTP ${response.status}).`);
  } catch (error) {
    notes.push(`Europe PMC full text fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const numericId = pmcid.replace(/^PMC/i, "");
  try {
    const response = await fetch(`${NCBI_EFETCH}?db=pmc&id=${encodeURIComponent(numericId)}&rettype=xml`, {
      headers: { Accept: "application/xml" },
    });
    if (response.ok) {
      const xml = await response.text();
      // E-utilities answers 200 with a small error document when there is no article
      if (/<pmc-articleset|<article\b/i.test(xml)) {
        return { text: extractTextFromHtml(xml), source: `PubMed Central ${pmcid} via NCBI E-utilities` };
      }
      notes.push(`PubMed Central has no full text for ${pmcid}.`);
    } else {
      notes.push(`PubMed Central full text for ${pmcid} is not available (HTTP ${response.status}).`);
    }
  } catch (error) {
    notes.push(`PubMed Central full text fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  return null;
};

/**
 * Build a case-insensitive pattern from a `find` value: terms separated by
 * "|" are matched as literal alternatives.
 */
const buildFindPattern = (find: string): RegExp | null => {
  const terms = find
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return terms.length > 0 ? new RegExp(terms.join("|"), "i") : null;
};

/**
 * Return the passages of a text that mention any of the `find` terms, each
 * with one sentence of context on either side, so a question like "does the
 * paper state an IACUC protocol" costs a few hundred characters instead of
 * the whole article.
 */
export function extractPassages(text: string, find: string): { excerpt: string; matches: number } {
  const pattern = buildFindPattern(find);
  if (!pattern) return { excerpt: "", matches: 0 };
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'([])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const hits = sentences.map((sentence) => pattern.test(sentence));
  const matches = hits.filter(Boolean).length;
  const passages: string[] = [];
  let i = 0;
  while (i < sentences.length && passages.length < MAX_PASSAGES) {
    if (!hits[i]) {
      i += 1;
      continue;
    }
    // Extend the window over consecutive hits, then add one sentence each side
    let end = i;
    while (end + 1 < sentences.length && hits[end + 1]) end += 1;
    const start = Math.max(0, i - 1);
    const stop = Math.min(sentences.length - 1, end + 1);
    let passage = sentences.slice(start, stop + 1).join(" ");
    if (passage.length > MAX_PASSAGE_LENGTH) {
      const at = passage.search(pattern);
      const from = Math.max(0, at - Math.floor(MAX_PASSAGE_LENGTH / 2));
      passage = `${from > 0 ? "..." : ""}${passage.slice(from, from + MAX_PASSAGE_LENGTH)}...`;
    }
    passages.push(passage);
    i = stop + 1;
  }

  let excerpt = passages.map((passage, index) => `${index + 1}. ${passage}`).join("\n\n");
  if (excerpt.length > MAX_EXCERPT_LENGTH) {
    excerpt = `${excerpt.slice(0, MAX_EXCERPT_LENGTH)}\n\n[Excerpt truncated]`;
  }
  return { excerpt, matches };
}

/**
 * Fetch an arbitrary page. Try the site directly first, since some send CORS
 * headers, and fall back to the configured proxy when the direct request is
 * blocked. Throws when neither works.
 */
const fetchPage = async (url: string): Promise<Response> => {
  try {
    return await fetch(url, { method: "GET", headers: FETCH_HEADERS });
  } catch (directError) {
    const proxiedUrl = getProxiedUrl(url);
    if (!proxiedUrl) {
      throw directError;
    }
    return await fetch(proxiedUrl, { method: "GET", headers: FETCH_HEADERS });
  }
};

/**
 * Serialize a successful result, truncating the content so that the final
 * JSON string stays under MAX_RESULT_LENGTH.
 */
const serializeResult = (fields: {
  url: string;
  reason?: string;
  content: string;
  jsonContent?: unknown;
  notes?: string[];
}): string => {
  const { url, reason, content, jsonContent, notes } = fields;

  const buildResult = (body: unknown, truncated: boolean) =>
    JSON.stringify(
      {
        success: true,
        url,
        reason: reason || "Not specified",
        contentLength: content.length,
        truncated,
        ...(notes && notes.length > 0 ? { notes } : {}),
        // For JSON responses, include the parsed object directly to avoid double-stringification
        // For HTML/text responses, include the extracted text
        content: body,
      },
      null,
      2
    );

  let result = buildResult(jsonContent ?? content, false);
  if (result.length > MAX_RESULT_LENGTH) {
    const truncationNotice = "\n\n[Content truncated due to length...]";
    const overhead = buildResult(truncationNotice, true).length;
    let keep = Math.max(0, MAX_RESULT_LENGTH - overhead);
    result = buildResult(content.substring(0, keep) + truncationNotice, true);
    // JSON escaping can expand the content, so shave further until it fits
    while (result.length > MAX_RESULT_LENGTH && keep > 0) {
      keep = Math.floor(keep * 0.9);
      result = buildResult(content.substring(0, keep) + truncationNotice, true);
    }
  }
  return result;
};

export const fetchUrlTool: QPTool = {
  toolFunction: {
    name: "fetch_url",
    description:
      "Fetch content from an external URL to retrieve information. Use this tool when you need to get data from a scientific article, publication, or other external resource. Publication links (doi.org, PubMed, bioRxiv, medRxiv) are resolved in one call: OpenAlex metadata, the abstract, and the full text from Europe PMC or PubMed Central when either has it. If the result says full text is not available, no other URL will get it; ask the user. Use the optional 'find' parameter to return only the passages mentioning given terms instead of the whole text. Other web pages can only be fetched when the deployment has a CORS proxy configured.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The URL to fetch content from. Must be a valid URL from an allowed domain (scientific publications, DOI resolvers, etc.). DOI, PubMed, bioRxiv and medRxiv links work in every deployment.",
        },
        reason: {
          type: "string",
          description:
            "A brief explanation of why you need to fetch this URL and what information you're looking for.",
        },
        find: {
          type: "string",
          description:
            "Optional. Terms separated by '|' (for example 'IACUC|ethics|approved|protocol'). When given, the result contains only the passages that mention any term, with a sentence of context, instead of the full content. Use it whenever you are looking for something specific in a long paper.",
        },
      },
      required: ["url"],
    },
  },

  execute: async (
    params: { url: string; reason?: string; find?: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ToolExecutionContext
  ) => {
    const { url, reason } = params;
    const find = typeof params.find === "string" && params.find.trim() ? params.find.trim() : null;

    // Reduce a long text to the passages that mention the requested terms
    const applyFind = (content: string, notes: string[]): { content: string; notes: string[] } => {
      if (!find) return { content, notes };
      const { excerpt, matches } = extractPassages(content, find);
      const summary =
        matches === 0
          ? `No passages mention "${find}" in the ${content.length} characters retrieved.`
          : `${matches} sentence${matches === 1 ? "" : "s"} mention${matches === 1 ? "s" : ""} "${find}"; showing ${matches === 1 ? "it" : "them"} with context.`;
      return {
        content: matches === 0 ? summary : `${summary}\n\n${excerpt}`,
        notes: [...notes, `The full content (${content.length} characters) was searched for "${find}" and only matching passages are shown.`],
      };
    };

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        result: JSON.stringify({
          success: false,
          error: `Invalid URL format: "${url}". Please provide a valid URL.`,
        }),
      };
    }

    // Check if the domain is allowed
    if (!isUrlAllowed(url)) {
      return {
        result: JSON.stringify({
          success: false,
          error: `Domain not allowed: "${parsedUrl.hostname}". For security reasons, only URLs from allowed scientific publication domains can be fetched. Allowed domains include: ${ALLOWED_DOMAINS.slice(0, 10).join(", ")}, and others.`,
        }),
      };
    }

    // Publications are resolved through CORS-enabled APIs rather than the page itself
    const publication = identifyPublication(parsedUrl);
    if (publication) {
      try {
        const { content, notes } = await fetchPublication(publication);
        if (!content) {
          return {
            result: JSON.stringify({
              success: false,
              error: `Could not resolve this publication through OpenAlex or Europe PMC. ${notes.join(" ")}`,
              url,
            }),
          };
        }
        const found = applyFind(content, notes);
        return { result: serializeResult({ url, reason, content: found.content, notes: found.notes }) };
      } catch (error) {
        return {
          result: JSON.stringify({
            success: false,
            error: `Error resolving publication: ${error instanceof Error ? error.message : "Unknown error"}`,
            url,
          }),
        };
      }
    }

    try {
      const hostname = parsedUrl.hostname.toLowerCase();

      // For OpenAlex works API, automatically add select parameter to reduce response size
      let finalUrl = url;
      if (hostname === "api.openalex.org" && parsedUrl.pathname.startsWith("/works") && !parsedUrl.search.includes("select=")) {
        const separator = parsedUrl.search ? "&" : "?";
        finalUrl = `${url}${separator}select=${OPENALEX_WORK_SELECT}`;
      }

      let response: Response;
      try {
        response = await fetchPage(finalUrl);
      } catch (error) {
        if (getProxiedUrl(finalUrl)) {
          throw error;
        }
        return {
          result: JSON.stringify({
            success: false,
            error: `Could not fetch "${parsedUrl.hostname}" from the browser: the site does not send CORS headers and this deployment has no CORS proxy configured (VITE_CORS_PROXY_URL is unset). DOI, PubMed, bioRxiv and medRxiv links can still be fetched, so if this page has a DOI or PubMed entry, try that URL instead, or ask the user to paste the relevant text.`,
            url,
          }),
        };
      }

      if (!response.ok) {
        return {
          result: JSON.stringify({
            success: false,
            error: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
            url,
          }),
        };
      }

      const contentType = response.headers.get("content-type") || "";
      let content: string;

      let jsonContent: unknown = null;
      if (contentType.includes("application/json")) {
        jsonContent = await response.json();
        content = JSON.stringify(jsonContent, null, 2);
      } else {
        // For HTML/text content, get the raw text
        const html = await response.text();
        // Extract meaningful text from HTML, removing scripts and styles
        content = extractTextFromHtml(html);
      }

      if (find) {
        const found = applyFind(content, []);
        return { result: serializeResult({ url, reason, content: found.content, notes: found.notes }) };
      }
      return { result: serializeResult({ url, reason, content, jsonContent }) };
    } catch (error) {
      return {
        result: JSON.stringify({
          success: false,
          error: `Error fetching URL: ${error instanceof Error ? error.message : "Unknown error"}`,
          url,
          hint: "The URL might be inaccessible, blocked by CORS, or the server might be down. Please verify the URL is correct.",
        }),
      };
    }
  },

  getDetailedDescription: () => {
    return `Use this tool to fetch content from external URLs when you need to retrieve information from scientific articles, publications, or other external resources.

**IMPORTANT: Always use this tool when a user asks you to get information from an external URL. Never fabricate or hallucinate information - if you cannot fetch the URL, tell the user.**

**Publications (DOI, PubMed, bioRxiv, medRxiv links):**
- One call returns OpenAlex metadata (authors, ORCIDs, affiliations, funders), the Europe PMC record with the abstract, and the full text when Europe PMC or PubMed Central has it.
- The result's notes say which full-text source answered. If they say full text is not available, that is final: this tool has no other way to read the paper, so do not try journal pages, PMC pages, or other URL forms. Ask the user for what you need.
- Use "find" when you are looking for something specific, for example { "url": "https://doi.org/10.1016/j.neuron.2016.03.036", "find": "IACUC|ethics|approved|protocol" } returns only the sentences that mention those terms, with context. This is much cheaper than reading the whole paper.

**Other pages:**
- Pages on allowed domains (GitHub, Wikipedia, ontology services, OpenAlex, ROR, Europe PMC) are fetched directly or through the deployment's CORS proxy. Sites that block automated access (for example PMC's browser check) cannot be read.
- Identifiers do not need to be verified with this tool: propose_metadata_change checks ORCIDs against the ORCID API and ROR identifiers against the ROR API when a change is applied.

**Examples:**
- Resolve a DOI: { "url": "https://doi.org/10.7554/eLife.78362", "reason": "To get publication details" }
- Find the ethics statement: { "url": "https://doi.org/10.7554/eLife.78362", "find": "IACUC|IRB|ethics|approved" }
- Funding for a paper: { "url": "https://api.openalex.org/works/doi:10.7554/eLife.78362?select=id,title,funders,awards" }

**Notes:**
- Very long content is truncated; use "find" to avoid that for long papers
- If fetching fails, an error message will explain why
- Always verify the fetched content before using it to propose metadata changes`;
  },
};

/**
 * Extract readable text from HTML, removing scripts, styles, and excessive whitespace
 */
function extractTextFromHtml(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Remove HTML tags but keep their content
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&rsquo;/g, "'");
  text = text.replace(/&lsquo;/g, "'");
  text = text.replace(/&rdquo;/g, '"');
  text = text.replace(/&ldquo;/g, '"');
  text = text.replace(/&mdash;/g, "—");
  text = text.replace(/&ndash;/g, "–");

  // Collapse multiple whitespace characters into single spaces
  text = text.replace(/\s+/g, " ");

  // Trim
  text = text.trim();

  return text;
}
