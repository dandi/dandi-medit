import { QPTool, ToolExecutionContext } from "../types";

/**
 * A tool that allows the AI to fetch content from external URLs.
 * This addresses the hallucination issue where the AI would fabricate
 * metadata instead of actually retrieving it from external sources.
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

export const fetchUrlTool: QPTool = {
  toolFunction: {
    name: "fetch_url",
    description:
      "Fetch content from an external URL to retrieve information. Use this tool when you need to get data from a scientific article, publication, or other external resource. The content will be returned as text that you can then analyze to extract relevant metadata.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The URL to fetch content from. Must be a valid URL from an allowed domain (scientific publications, DOI resolvers, etc.).",
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

    try {
      // Some APIs support CORS natively, so we can fetch directly
      // For others, we need to use a CORS proxy
      const corsEnabledDomains = [
        "api.openalex.org",
        "api.crossref.org",
        "api.ror.org",
        "ebi.ac.uk",
        "europepmc.org",
      ];

      const hostname = parsedUrl.hostname.toLowerCase();
      const needsProxy = !corsEnabledDomains.some(
        (domain) => hostname === domain || hostname.endsWith("." + domain)
      );

      // For OpenAlex works API, automatically add select parameter to reduce response size
      let finalUrl = url;
      if (hostname === "api.openalex.org" && parsedUrl.pathname.startsWith("/works") && !parsedUrl.search.includes("select=")) {
        const separator = parsedUrl.search ? "&" : "?";
        // Select only fields useful for metadata extraction
        finalUrl = `${url}${separator}select=id,doi,title,display_name,authorships,publication_year,publication_date,funders,keywords`;
      }

      const fetchUrl = needsProxy
        ? `https://corsproxy.io/?${encodeURIComponent(finalUrl)}`
        : finalUrl;

      const response = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          Accept: "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

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

      // Truncate if too long (to avoid overwhelming the context)
      // 25000 chars accommodates most OpenAlex responses with full authorship data
      const maxLength = 250000;
      const truncated = content.length > maxLength;
      const finalContent = truncated
        ? content.substring(0, maxLength) + "\n\n[Content truncated due to length...]"
        : content;

      return {
        result: JSON.stringify(
          {
            success: true,
            url,
            reason: reason || "Not specified",
            contentLength: content.length,
            truncated,
            // For JSON responses, include the parsed object directly to avoid double-stringification
            // For HTML/text responses, include the extracted text
            content: jsonContent && !truncated ? jsonContent : finalContent,
          },
          null,
          2
        ),
      };
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

**Allowed domains:**
This tool only works with approved scientific/academic domains including:
- Scientific journals (eLife, Nature, Science, Cell, PNAS, PLOS, etc.)
- Preprint servers (bioRxiv, medRxiv, arXiv)
- DOI resolvers (doi.org)
- PubMed/NIH resources
- GitHub, DANDI Archive, Wikipedia

**Examples:**
- Fetch an eLife article: { "url": "https://elifesciences.org/articles/78362", "reason": "To extract metadata for the dandiset" }
- Resolve a DOI: { "url": "https://doi.org/10.7554/eLife.78362", "reason": "To get publication details" }

**Notes:**
- Content is returned as text extracted from the webpage
- Very long content will be truncated
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
