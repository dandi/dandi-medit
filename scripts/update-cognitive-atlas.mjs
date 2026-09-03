#!/usr/bin/env node
/**
 * Refresh the bundled Cognitive Atlas concept snapshot.
 *
 * The Cognitive Atlas API does not send CORS headers, so the browser cannot
 * query it directly, and the endpoint returns every concept on each call
 * regardless of the search parameter. The app therefore searches a bundled
 * copy of the concept list. This script downloads the list, keeps only the
 * fields the search uses, and rewrites src/data/cognitive-atlas-concepts.json
 * when the concepts have changed.
 *
 * Usage: npm run update-cognitive-atlas
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL = "https://www.cognitiveatlas.org/api/v-alpha/concept";
const OUTPUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "data",
  "cognitive-atlas-concepts.json",
);

const response = await fetch(SOURCE_URL, {
  headers: { Accept: "application/json", "User-Agent": "dandi-medit (snapshot refresh)" },
});
if (!response.ok) {
  throw new Error(`Cognitive Atlas API returned ${response.status} ${response.statusText}`);
}
const raw = await response.json();
if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error("Cognitive Atlas API returned no concepts");
}

const concepts = raw
  .filter((c) => typeof c.id === "string" && typeof c.name === "string")
  .map((c) => {
    const concept = { id: c.id, name: c.name.trim() };
    if (typeof c.alias === "string" && c.alias.trim()) concept.alias = c.alias.trim();
    if (typeof c.definition_text === "string" && c.definition_text.trim()) {
      concept.definition = c.definition_text.trim();
    }
    return concept;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

let previous = null;
try {
  previous = JSON.parse(await readFile(OUTPUT, "utf8"));
} catch {
  // No existing snapshot
}

if (previous && JSON.stringify(previous.concepts) === JSON.stringify(concepts)) {
  console.log(`Snapshot unchanged: ${concepts.length} concepts (fetched ${previous.fetchedAt})`);
} else {
  const snapshot = {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString().slice(0, 10),
    concepts,
  };
  await writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `Wrote ${concepts.length} concepts to ${path.relative(process.cwd(), OUTPUT)}` +
      (previous ? ` (was ${previous.concepts.length})` : ""),
  );
}
