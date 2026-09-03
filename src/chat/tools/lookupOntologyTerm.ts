import { QPTool, ToolExecutionContext } from "../types";
import { getProxiedUrl } from "../../utils/corsProxy";
import cognitiveAtlasSnapshot from "../../data/cognitive-atlas-concepts.json";

/**
 * A tool that allows the AI to look up validated ontology terms from
 * UBERON (anatomy), DOID (diseases), Cognitive Atlas (cognitive concepts),
 * and other biomedical ontologies using the EBI Ontology Lookup Service (OLS)
 * and a bundled snapshot of the Cognitive Atlas concept list.
 *
 * The Cognitive Atlas API does not send CORS headers, so a browser cannot
 * query it directly, and it returns every concept on each call anyway. The
 * search therefore runs over src/data/cognitive-atlas-concepts.json, which
 * npm run update-cognitive-atlas refreshes. When a CORS proxy is configured
 * the live list is fetched through it first and the snapshot is the fallback.
 */

// Ontology configurations with their OLS identifiers and DANDI schemaKey mappings
const OLS_ONTOLOGY_CONFIG: Record<
  string,
  { olsId: string; schemaKey: "Anatomy" | "Disorder" | "GenericType"; description: string }
> = {
  UBERON: {
    olsId: "uberon",
    schemaKey: "Anatomy",
    description: "Ubiquitous Anatomical Ontology - for anatomical structures",
  },
  DOID: {
    olsId: "doid",
    schemaKey: "Disorder",
    description: "Human Disease Ontology - for diseases and disorders",
  },
  NCIT: {
    olsId: "ncit",
    schemaKey: "Disorder",
    description: "NCI Thesaurus - for diseases, anatomy, and other biomedical concepts",
  },
  HP: {
    olsId: "hp",
    schemaKey: "Disorder",
    description: "Human Phenotype Ontology - for phenotypic abnormalities",
  },
  GO: {
    olsId: "go",
    schemaKey: "GenericType",
    description: "Gene Ontology - for molecular functions, biological processes, and cellular components",
  },
  CL: {
    olsId: "cl",
    schemaKey: "Anatomy",
    description: "Cell Ontology - for cell types",
  },
};

interface OLSSearchResult {
  iri: string;
  label: string;
  description?: string[];
  ontology_name: string;
  obo_id?: string;
  short_form?: string;
}

interface OLSResponse {
  response: {
    numFound: number;
    docs: OLSSearchResult[];
  };
}

export interface CognitiveAtlasConcept {
  id: string;
  name: string;
  alias?: string;
  definition?: string;
}

export type CognitiveAtlasSource = "live" | "snapshot";

interface FormattedResult {
  identifier: string;
  name: string;
  schemaKey: "Anatomy" | "Disorder" | "GenericType";
  ontology: string;
  description?: string;
  oboId?: string;
}

export const lookupOntologyTermTool: QPTool = {
  toolFunction: {
    name: "lookup_ontology_term",
    description:
      "Look up validated ontology terms for brain regions, anatomical structures, diseases, disorders, or cognitive concepts. Returns standardized identifiers (URIs) that can be used with propose_metadata_change to add entries to the 'about' field.",
    parameters: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description:
            "The term to search for (e.g., 'hippocampus', 'Parkinson disease', 'working memory', 'attention')",
        },
        category: {
          type: "string",
          enum: ["anatomy", "disorder", "cognitive", "auto"],
          description:
            "The category to search in: 'anatomy' for brain regions and anatomical structures (searches UBERON, CL), 'disorder' for diseases and conditions (searches DOID, HP, NCIT), 'cognitive' for cognitive concepts and mental processes (searches Cognitive Atlas), or 'auto' to search all and return the best matches. Default is 'auto'.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (1-10). Default is 5.",
        },
      },
      required: ["term"],
    },
  },

  execute: async (
    params: { term: string; category?: string; maxResults?: number },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ToolExecutionContext
  ) => {
    const { term, category = "auto", maxResults = 5 } = params;

    if (!term || term.trim().length === 0) {
      return {
        result: JSON.stringify({
          success: false,
          error: "Please provide a search term.",
        }),
      };
    }

    const clampedMaxResults = Math.min(Math.max(1, maxResults), 10);

    // Determine which ontologies to search based on category
    let olsOntologiesToSearch: string[];
    let searchCognitiveAtlas = false;

    if (category === "anatomy") {
      olsOntologiesToSearch = ["UBERON", "CL"];
    } else if (category === "disorder") {
      olsOntologiesToSearch = ["DOID", "HP", "NCIT"];
    } else if (category === "cognitive") {
      olsOntologiesToSearch = [];
      searchCognitiveAtlas = true;
    } else {
      // auto - search all
      olsOntologiesToSearch = ["UBERON", "DOID", "HP", "CL"];
      searchCognitiveAtlas = true;
    }

    try {
      const allResults: FormattedResult[] = [];

      // Search OLS ontologies
      for (const ontology of olsOntologiesToSearch) {
        const config = OLS_ONTOLOGY_CONFIG[ontology];
        if (!config) continue;

        try {
          const results = await searchOLS(term, config.olsId, clampedMaxResults);

          for (const result of results) {
            allResults.push({
              identifier: result.iri,
              name: result.label,
              schemaKey: config.schemaKey,
              ontology: ontology,
              description: result.description?.[0],
              oboId: result.obo_id,
            });
          }
        } catch (error) {
          // Continue with other ontologies if one fails
          console.error(`Error searching ${ontology}:`, error);
        }
      }

      // Search Cognitive Atlas (live through the CORS proxy when one is
      // configured, otherwise the bundled snapshot)
      let cognitiveAtlasSource: CognitiveAtlasSource | undefined;
      if (searchCognitiveAtlas) {
        const { concepts, source } = await searchCognitiveAtlasConcepts(term, clampedMaxResults);
        cognitiveAtlasSource = source;
        for (const concept of concepts) {
          allResults.push({
            identifier: `https://www.cognitiveatlas.org/concept/id/${concept.id}`,
            name: concept.name,
            schemaKey: "GenericType",
            ontology: "CognitiveAtlas",
            description: concept.definition,
          });
        }
      }

      if (allResults.length === 0) {
        return {
          result: JSON.stringify({
            success: true,
            term,
            category,
            results: [],
            ...(cognitiveAtlasSource ? { cognitiveAtlasSource } : {}),
            message: `No matching terms found for "${term}". Try different search terms or check spelling.`,
          }),
        };
      }

      // Sort by relevance (exact matches first, then by label length as a rough proxy)
      allResults.sort((a, b) => {
        const termLower = term.toLowerCase();
        const aExact = a.name.toLowerCase() === termLower;
        const bExact = b.name.toLowerCase() === termLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = a.name.toLowerCase().startsWith(termLower);
        const bStarts = b.name.toLowerCase().startsWith(termLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return a.name.length - b.name.length;
      });

      // Limit results
      const limitedResults = allResults.slice(0, clampedMaxResults);

      return {
        result: JSON.stringify({
          success: true,
          term,
          category,
          resultsCount: limitedResults.length,
          totalFound: allResults.length,
          ...(cognitiveAtlasSource ? { cognitiveAtlasSource } : {}),
          results: limitedResults,
          usage: `To add a term to the dandiset metadata, use propose_metadata_change with:
- path: "about.${"{next_index}"}" (use the next available index in the about array)
- newValue: { "schemaKey": "${limitedResults[0]?.schemaKey}", "identifier": "${limitedResults[0]?.identifier}", "name": "${limitedResults[0]?.name}" }`,
        }),
      };
    } catch (error) {
      return {
        result: JSON.stringify({
          success: false,
          error: `Error searching ontologies: ${error instanceof Error ? error.message : "Unknown error"}`,
          hint: "The OLS API might be temporarily unavailable. Please try again later.",
        }),
      };
    }
  },

  getDetailedDescription: () => {
    return `Use this tool to look up validated ontology terms when users mention brain regions, anatomical structures, diseases, disorders, or cognitive concepts.

**IMPORTANT: Always use this tool to get the correct ontology identifier before proposing changes to the 'about' field. Never guess or fabricate ontology identifiers.**

**Usage:**
- Search for a term (e.g., "hippocampus", "Parkinson disease", "working memory")
- Optionally specify a category: "anatomy", "disorder", or "cognitive"
- The tool returns validated identifiers that conform to the DANDI schema

**Ontologies searched:**
- **Anatomy**: UBERON (anatomical structures), CL (cell types)
- **Disorder**: DOID (diseases), HP (phenotypes), NCIT (NCI thesaurus)
- **Cognitive**: Cognitive Atlas (cognitive concepts, mental processes, psychological constructs), searched from a bundled copy of its concept list, so results do not depend on reaching cognitiveatlas.org

**Examples:**
- Look up a brain region: { "term": "hippocampus", "category": "anatomy" }
- Look up a disease: { "term": "Parkinson", "category": "disorder" }
- Look up a cognitive concept: { "term": "working memory", "category": "cognitive" }
- Auto-detect category: { "term": "epilepsy" }

**Workflow:**
1. User mentions a brain area, disease, or cognitive concept
2. Use this tool to find the validated ontology term
3. Present options to the user if multiple matches exist
4. Use propose_metadata_change to add the selected term to the "about" array

**Result format:**
Each result includes:
- identifier: The URI to use in propose_metadata_change
- name: Human-readable label
- schemaKey: "Anatomy", "Disorder", or "GenericType" (determines the type for the about field)
- ontology: Source ontology (UBERON, DOID, CognitiveAtlas, etc.)
- description: Optional definition of the term`;
  },
};

/**
 * Search the EBI Ontology Lookup Service for terms
 */
async function searchOLS(
  term: string,
  ontologyId: string,
  maxResults: number
): Promise<OLSSearchResult[]> {
  const baseUrl = "https://www.ebi.ac.uk/ols4/api/search";
  const params = new URLSearchParams({
    q: term,
    ontology: ontologyId,
    rows: String(maxResults),
    exact: "false",
    queryFields: "label,synonym",
  });

  const response = await fetch(`${baseUrl}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`OLS API returned ${response.status}: ${response.statusText}`);
  }

  const data: OLSResponse = await response.json();
  return data.response?.docs || [];
}

const COGNITIVE_ATLAS_API = "https://www.cognitiveatlas.org/api/v-alpha/concept";
const COGNITIVE_ATLAS_TIMEOUT_MS = 8000;

/**
 * Rank a concept against a search term. Lower is better; null means no match.
 * Exact name matches come first, then names that start with the term, then
 * names that contain it, then alias matches, then definition matches.
 */
function rankCognitiveAtlasConcept(concept: CognitiveAtlasConcept, termLower: string): number | null {
  const name = concept.name.toLowerCase();
  if (name === termLower) return 0;
  if (name.startsWith(termLower)) return 1;
  if (name.includes(termLower)) return 2;
  if (concept.alias?.toLowerCase().includes(termLower)) return 3;
  if (concept.definition?.toLowerCase().includes(termLower)) return 4;
  return null;
}

/**
 * Search a list of Cognitive Atlas concepts for a term. Exported for tests;
 * defaults to the bundled snapshot.
 */
export function searchCognitiveAtlasSnapshot(
  term: string,
  maxResults: number,
  concepts: CognitiveAtlasConcept[] = cognitiveAtlasSnapshot.concepts,
): CognitiveAtlasConcept[] {
  const termLower = term.trim().toLowerCase();
  if (!termLower) return [];
  return concepts
    .map((concept) => ({ concept, rank: rankCognitiveAtlasConcept(concept, termLower) }))
    .filter((entry): entry is { concept: CognitiveAtlasConcept; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.concept.name.length - b.concept.name.length)
    .slice(0, maxResults)
    .map((entry) => entry.concept);
}

/**
 * Fetch the live concept list through the configured CORS proxy. Returns
 * null when no proxy is configured or the request fails, so the caller can
 * fall back to the snapshot.
 */
async function fetchLiveCognitiveAtlasConcepts(): Promise<CognitiveAtlasConcept[] | null> {
  const proxied = getProxiedUrl(COGNITIVE_ATLAS_API);
  if (!proxied) return null;
  try {
    const response = await fetch(proxied, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(COGNITIVE_ATLAS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Cognitive Atlas API returned ${response.status}: ${response.statusText}`);
    }
    const raw: { id?: unknown; name?: unknown; alias?: unknown; definition_text?: unknown }[] =
      await response.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Cognitive Atlas API returned no concepts");
    }
    return raw
      .filter((c) => typeof c.id === "string" && typeof c.name === "string")
      .map((c) => ({
        id: c.id as string,
        name: (c.name as string).trim(),
        ...(typeof c.alias === "string" && c.alias.trim() ? { alias: c.alias.trim() } : {}),
        ...(typeof c.definition_text === "string" && c.definition_text.trim()
          ? { definition: c.definition_text.trim() }
          : {}),
      }));
  } catch (error) {
    console.warn("Live Cognitive Atlas lookup failed, using the bundled snapshot:", error);
    return null;
  }
}

/**
 * Search Cognitive Atlas concepts, live through the proxy when possible and
 * otherwise from the bundled snapshot. Reports which source answered.
 */
export async function searchCognitiveAtlasConcepts(
  term: string,
  maxResults: number,
): Promise<{ concepts: CognitiveAtlasConcept[]; source: CognitiveAtlasSource }> {
  const live = await fetchLiveCognitiveAtlasConcepts();
  if (live) {
    return { concepts: searchCognitiveAtlasSnapshot(term, maxResults, live), source: "live" };
  }
  return { concepts: searchCognitiveAtlasSnapshot(term, maxResults), source: "snapshot" };
}
