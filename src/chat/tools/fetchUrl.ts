import { QPTool, ToolExecutionContext } from "../types";
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

// List of allowed domains to prevent misuse
const ALLOWED_DOMAINS = [
  "elifesciences.org",
  "doi.org",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "biorxiv.org",
  "medrxiv.org",
  "arxiv.org",
  "nature.com",
  "science.org",
  "cell.com",
  "pnas.org",
  "plos.org",
  "frontiersin.org",
  "springer.com",
  "wiley.com",
  "sciencedirect.com",
  "nih.gov",
  "github.com",
  "dandiarchive.org",
  "wikipedia.org",
  "crossref.org",
  // Ontology services
  "ebi.ac.uk",
  "ontobee.org",
  "purl.obolibrary.org",
  "obofoundry.org",
  "identifiers.org",
  "cognitiveatlas.org",
  // Academic APIs
  "openalex.org",
  "ror.org",
  "europepmc.org",
  "orcid.org",
];

// Fields useful for metadata extraction; keeps OpenAlex responses small
const OPENALEX_WORK_SELECT =
  "id,doi,title,display_name,authorships,publication_year,publication_date,funders,keywords";

const EUROPE_PMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";

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

    if (record.pmcid && record.isOpenAccess === "Y") {
      try {
        const response = await fetch(`${EUROPE_PMC_REST}/${record.pmcid}/fullTextXML`, {
          headers: { Accept: "application/xml" },
        });
        if (response.ok) {
          const xml = await response.text();
          parts.push(`Full text (Europe PMC ${record.pmcid}):\n${extractTextFromHtml(xml)}`);
        } else {
          notes.push(`Europe PMC full text for ${record.pmcid} is not available: HTTP ${response.status}`);
        }
      } catch (error) {
        notes.push(`Europe PMC full text fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  return { content: parts.join("\n\n"), notes };
};

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
      "Fetch content from an external URL to retrieve information. Use this tool when you need to get data from a scientific article, publication, or other external resource. Publication links (doi.org, PubMed, bioRxiv, medRxiv) are resolved through OpenAlex and Europe PMC and return structured metadata, the abstract, and open-access full text when available; prefer these over journal landing pages. Other web pages can only be fetched when the deployment has a CORS proxy configured.",
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
      },
      required: ["url"],
    },
  },

  execute: async (
    params: { url: string; reason?: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ToolExecutionContext
  ) => {
    const { url, reason } = params;

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
        return { result: serializeResult({ url, reason, content, notes }) };
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

**Usage:**
- Provide the URL you want to fetch
- Optionally explain why you need to fetch it

**Publication links (work in every deployment):**
- doi.org / dx.doi.org links, PubMed links (pubmed.ncbi.nlm.nih.gov/<pmid>), and bioRxiv / medRxiv pages are not fetched as web pages. They are resolved through OpenAlex (structured metadata: title, authors, dates, funders, keywords) and Europe PMC (abstract, and full text for open-access papers).
- When a user gives you a journal landing page, prefer its DOI link if you know it; the DOI route returns cleaner data than the page.

**Other pages (need a configured CORS proxy):**
- Journal sites, GitHub, Wikipedia and similar pages are fetched directly when the site permits it, otherwise through the proxy configured by the deployment. If no proxy is configured, the tool returns an error saying so; in that case suggest a DOI or PubMed link, or ask the user to paste the relevant text.
- APIs that send CORS headers (OpenAlex, Crossref, ROR, EBI, Europe PMC) are fetched directly.

**Allowed domains:**
This tool only works with approved scientific/academic domains including:
- Scientific journals (eLife, Nature, Science, Cell, PNAS, PLOS, etc.)
- Preprint servers (bioRxiv, medRxiv, arXiv)
- DOI resolvers (doi.org)
- PubMed/NIH resources
- GitHub, DANDI Archive, Wikipedia

**Examples:**
- Resolve a DOI: { "url": "https://doi.org/10.7554/eLife.78362", "reason": "To get publication details" }
- Resolve a PubMed entry: { "url": "https://pubmed.ncbi.nlm.nih.gov/36193886/", "reason": "To get the abstract" }
- Fetch an eLife article page (requires a proxy): { "url": "https://elifesciences.org/articles/78362", "reason": "To extract metadata for the dandiset" }

**Notes:**
- Content is returned as text extracted from the webpage or API responses
- Very long content will be truncated; metadata and abstract come before full text so they survive truncation
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
