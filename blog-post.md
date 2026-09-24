# Introducing the DANDI Metadata Assistant: AI-Powered Metadata Curation for Neuroscience Datasets

*Making dandiset metadata curation faster, more accurate, and less tedious*

---

Managing metadata for neuroscience datasets shouldn't be a chore. Yet for many researchers uploading data to the DANDI Archive, filling in comprehensive metadata—contributor information with ORCIDs, funding sources, ontological references for brain regions, related publications—can be time-consuming and error-prone.

Today we're excited to introduce the **DANDI Metadata Assistant**, a new tool that combines the power of large language models with rigorous validation to help researchers curate high-quality dandiset metadata in minutes instead of hours.

## The Problem: Metadata Friction

When you publish a dataset to DANDI, rich metadata makes your data discoverable and reusable. But creating that metadata means:

- Looking up ORCID identifiers for each author
- Finding the correct ROR identifiers for institutions
- Identifying the right ontology terms (UBERON, DOID, etc.) for anatomical structures and conditions
- Ensuring funding information is complete with proper funder registry IDs
- Linking related publications with correct DOIs and relationship types

This process can take significant time, especially for datasets with many contributors or complex experimental setups.

## The Solution: AI + Validation

The DANDI Metadata Assistant is a web application that lets you describe what you want in natural language, and an AI assistant does the heavy lifting—while ensuring every piece of data is validated and verifiable.

### A Real Example

Text can be copy/pasted from any source and the assistant will determine how to update the metadata accordingly. 

The assistant also has access to external sources of information. Given this single prompt:

> "Add data from 10.1016/j.neuron.2016.12.011, which describes this dataset. Make this paper a related resource, and pull author and funding information, as well as study targets and a title and description, replacing the existing metadata"

The assistant made **22 consecutive tool calls** and automatically populated:

- **Title and description** extracted from the paper
- **All authors** with their ORCID identifiers (looked up via OpenAlex)
- **Institutional affiliations** with ROR identifiers
- **Funding sources** with proper funder registry entries
- **Brain regions** as validated ontology terms
- **The paper itself** correctly formatted as a related resource

All without the user having to manually look up a single identifier.

## Key Features

### 1. Grounded in Real Data (No Hallucinations)

The assistant never makes up information. When it needs external data, it uses a **fetch_url** tool restricted to a whitelist of trusted scientific sources:

- Publication databases: PubMed, Crossref, OpenAlex
- Preprint servers: bioRxiv, medRxiv, arXiv
- Major journals: Nature, Science, Cell, eLife, PLOS, Frontiers
- Ontology services: EBI OLS, Ontobee, PURL OBO Library

If you ask about a paper, the assistant fetches the actual paper metadata. It can't fabricate DOIs or author names.

### 2. Validated Ontology Lookups

Adding anatomical or disease terms to your dataset? The assistant includes a **lookup_ontology_term** tool that searches real ontology databases:

- **UBERON** for anatomical structures
- **DOID** for diseases
- **CL** for cell types
- **Cognitive Atlas** for cognitive concepts

When you say "Add that the dataset is recording from the primary visual cortex," the correct change is proposed to the metadata and the assistant responds with:

> I've proposed adding the primary visual cortex (UBERON:0002436) to the dandiset "about" field to indicate the recordings were made from that brain region. The change is pending review — let me know if you'd prefer a different term (e.g., broader "visual cortex" or a specific Brodmann area) or want to add multiple regions.

### 3. Real-Time Schema Validation

Every proposed change is validated against the official DANDI metadata schema (currently v0.7.0) before being accepted. The assistant:

- Validates data types, required fields, and enum values
- Checks that contributor roles use valid dcite role terms
- Ensures URLs, emails, and dates are properly formatted
- Prevents modification of read-only system fields (like `citation` or `dateCreated`)

Invalid changes are rejected with helpful error messages explaining what went wrong.

### 4. Review Before You Commit

The assistant never modifies your metadata directly. Instead, it proposes changes that appear as **color-coded diffs** in the interface:

- Green highlighting shows additions
- Red highlighting shows removals
- You can review all changes before committing any of them
- Individual changes can be removed if you disagree with a suggestion

This keeps you in full control while letting the AI do the tedious lookup work.

### 5. Direct JSON Editing with Validation

For power users, there's also a JSON editor that lets you edit metadata directly. The editor:

- Filters out read-only fields automatically
- Validates your changes in real-time against the DANDI schema
- Shows clear error messages for invalid JSON or schema violations
- Prevents saving until all validation errors are resolved

### 6. Works with Your Dandisets

Connect your DANDI API key to:

- See a list of your own dandisets
- Access embargoed datasets
- Commit changes directly to the archive

## How It Works Under the Hood

The assistant is powered by a large language model with access to three specialized tools:

1. **fetch_url**: Retrieves content from whitelisted scientific websites and APIs
2. **lookup_ontology_term**: Searches ontology databases for validated terms
3. **propose_metadata_change**: Suggests modifications to specific metadata fields

The system prompt includes the complete DANDI metadata schema and documentation, so the model understands exactly what fields exist and how they should be formatted.

When you make a request, the model might:
1. Fetch a paper's metadata from OpenAlex using its DOI
2. Extract author names and look up their ORCIDs
3. Look up institution ROR IDs for affiliations
4. Search UBERON for brain region terms mentioned in the abstract
5. Propose a series of metadata changes, each validated against the schema

All of this happens in a single conversation turn, with the AI making as many tool calls as needed to complete the task.

Different model options are available via the OpenRouter API, allowing users to choose based on their preferences for speed, cost, and performance. Several are available for free use with rate limits.

## Try It Out

The DANDI Metadata Assistant is available now at [URL]. To get started:

1. Enter a dandiset ID (or add your API key to see your own dandisets)
2. Describe what metadata you want to add or update
3. Review the proposed changes
4. Commit when you're satisfied

Whether you're uploading a new dataset or improving the metadata on an existing one, the assistant can help you create richer, more discoverable metadata with far less effort.

## Technical Details

- **Frontend**: React with Material-UI
- **AI Backend**: OpenRouter API with multiple model options
- **Schema**: Dynamically loaded from the DANDI schema repository (v0.7.0)
- **Validation**: AJV (Another JSON Validator) with format extensions
- **Source Code**: Available on GitHub at [repo URL]

## What's Next

We're continuing to improve the assistant with:
- Integration with additional data sources
- Expanded ontology coverage
- Improved suggestions based on dataset content

We'd love your feedback! Try the tool and let us know how it works for your datasets.

---

*The DANDI Metadata Assistant was developed to reduce the friction of sharing neuroscience data. High-quality metadata benefits everyone—it makes data discoverable, enables meta-analyses, and ensures proper attribution for data creators.*
