/* eslint-disable @typescript-eslint/no-explicit-any */
import { QPTool, ToolExecutionContext } from "../types";

/**
 * Deterministic tool that fetches OpenAlex authorship data for a DOI
 * and converts it to dandiset contributor format.
 *
 * This avoids LLM "context rot" when processing large author lists —
 * the mapping is done in code, not by the model.
 */

interface OpenAlexAffiliation {
  display_name?: string;
  ror?: string;
}

interface OpenAlexAuthorship {
  author_position?: string;
  author?: {
    display_name?: string;
    orcid?: string;
  };
  institutions?: OpenAlexAffiliation[];
}

interface DandiContributor {
  name: string;
  schemaKey: "Person";
  roleName: string[];
  includeInCitation: boolean;
  identifier?: string;
  affiliation?: {
    name: string;
    schemaKey: "Affiliation";
    identifier?: string;
  }[];
}

/**
 * Convert "First Middle Last" to "Last, First Middle"
 */
function toLastFirst(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length <= 1) return displayName.trim();
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}

/**
 * Extract bare ORCID ID from a URL like "https://orcid.org/0000-0002-1234-5678".
 * The DANDI schema expects just the bare ID (e.g., "0000-0002-1234-5678"), not a URL.
 */
function normalizeOrcid(orcidRaw: string): string | undefined {
  if (!orcidRaw) return undefined;
  const bare = orcidRaw.replace(/^https?:\/\/orcid\.org\//, "");
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(bare)) {
    return bare;
  }
  return undefined;
}

/**
 * Normalize a ROR URL to its canonical form.
 */
function normalizeRor(rorRaw: string): string | undefined {
  if (!rorRaw) return undefined;
  // Accept https://ror.org/XXXXX
  if (/^https?:\/\/ror\.org\/\w+$/.test(rorRaw)) {
    return rorRaw.replace(/^http:/, "https:");
  }
  return undefined;
}

function convertAuthorship(authorship: OpenAlexAuthorship): DandiContributor {
  const author = authorship.author || {};
  const name = toLastFirst(author.display_name || "Unknown");

  const contributor: DandiContributor = {
    name,
    schemaKey: "Person",
    roleName: ["dcite:Author"],
    includeInCitation: true,
  };

  // ORCID
  if (author.orcid) {
    const orcid = normalizeOrcid(author.orcid);
    if (orcid) {
      contributor.identifier = orcid;
    }
  }

  // Affiliations
  if (authorship.institutions && authorship.institutions.length > 0) {
    contributor.affiliation = authorship.institutions
      .filter((inst) => inst.display_name)
      .map((inst) => {
        const aff: DandiContributor["affiliation"] extends (infer T)[] | undefined ? T : never = {
          name: inst.display_name!,
          schemaKey: "Affiliation" as const,
        };
        if (inst.ror) {
          const ror = normalizeRor(inst.ror);
          if (ror) {
            aff.identifier = ror;
          }
        }
        return aff;
      });
    if (contributor.affiliation.length === 0) {
      delete contributor.affiliation;
    }
  }

  return contributor;
}

export const importContributorsFromDoiTool: QPTool = {
  toolFunction: {
    name: "import_contributors_from_doi",
    description:
      "Deterministically import all contributors (authors) from a publication DOI using OpenAlex. " +
      "Returns properly formatted dandiset contributor objects with names, ORCIDs, and affiliations. " +
      "Author order is preserved exactly as returned by OpenAlex. " +
      "Use this tool instead of manually parsing OpenAlex author data.",
    parameters: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          description:
            'The DOI of the publication (e.g., "10.1016/j.neuron.2016.12.011"). Can include or omit the "https://doi.org/" prefix.',
        },
      },
      required: ["doi"],
    },
  },

  execute: async (
    params: { doi: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ToolExecutionContext,
  ) => {
    let { doi } = params;

    // Strip URL prefix if provided
    doi = doi.replace(/^https?:\/\/doi\.org\//, "");

    const apiUrl = `https://api.openalex.org/works/doi:${doi}?select=id,doi,title,display_name,authorships`;

    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        return {
          result: JSON.stringify({
            success: false,
            error: `OpenAlex API returned HTTP ${response.status}. The DOI "${doi}" may not be indexed.`,
          }),
        };
      }

      const data = await response.json();
      const authorships: OpenAlexAuthorship[] = data.authorships || [];

      if (authorships.length === 0) {
        return {
          result: JSON.stringify({
            success: true,
            doi,
            title: data.title || data.display_name,
            contributors: [],
            message: "No authorships found in OpenAlex for this DOI.",
          }),
        };
      }

      const contributors = authorships.map(convertAuthorship);

      return {
        result: JSON.stringify({
          success: true,
          doi,
          title: data.title || data.display_name,
          totalAuthors: contributors.length,
          contributors,
          message:
            `Successfully imported ${contributors.length} contributors from OpenAlex. ` +
            `Author order is preserved exactly as listed in the publication. ` +
            `Use propose_metadata_change to append these to the contributor array.`,
        }),
      };
    } catch (error) {
      return {
        result: JSON.stringify({
          success: false,
          error: `Failed to fetch from OpenAlex: ${error instanceof Error ? error.message : "Unknown error"}`,
          doi,
        }),
      };
    }
  },

  getDetailedDescription: () => {
    return `Use this tool to import contributors from a publication DOI via OpenAlex.

**This tool deterministically converts OpenAlex author data to dandiset contributor format.**
It guarantees:
- All authors are included
- Author order matches the publication exactly
- ORCID identifiers are correctly formatted
- Institutional affiliations with ROR IDs are mapped
- Name format is "Last, First" as required by DANDI

**Usage:**
- Provide the DOI of the publication
- The tool returns an array of contributor objects ready for use with propose_metadata_change

**Example:**
{ "doi": "10.1016/j.neuron.2016.12.011" }

**After calling this tool**, use propose_metadata_change to append each contributor:
{ "changes": [
    { "operation": "append", "path": "contributor", "value": <contributor_object> },
    ...
  ]
}

**Notes:**
- ORCIDs and ROR IDs from OpenAlex are included as-is (they come from OpenAlex's curated data)
- If the dandiset already has contributors, compare the returned list with existing ones before adding
- The first and last authors may need additional roles (e.g., dcite:ContactPerson for corresponding author)`;
  },
};
