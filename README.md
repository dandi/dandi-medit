# Dandiset Metadata Assistant

A web application for viewing and editing DANDI Archive dandiset metadata with the help of an AI assistant.

https://medit.dandiarchive.org

The application loads the draft version of a dandiset, shows its metadata in an editable view, and lets you change it either by hand or by asking the assistant. Changes accumulate as a set of pending edits that you review as inline diffs before they are written back to the archive.

## Loading a Dandiset

The welcome screen lists dandisets from the selected DANDI instance, sorted by identifier or by modification date, with an option to hide empty ones. Clicking a row loads that dandiset. You can also type an identifier such as `000003` into the ID field and click Load. Once you have entered an API key, a "Only mine" checkbox restricts the list to dandisets you own.

The application always works on the draft version. There is no version selector, and published versions are immutable in DANDI, so any edit you make applies to the draft.

## DANDI Instances

Four instances are available from the selector in the toolbar: DANDI Production, DANDI Sandbox, EMBER, and EMBER Sandbox. The selection is remembered in browser local storage and is locked once a dandiset is loaded, so you switch instances from the welcome screen.

Two URL parameters control what gets loaded on startup:

- `?instance=` takes the API URL of one of the known instances, for example `https://api.sandbox.dandiarchive.org/api`. An unrecognized value produces an error message listing the instances the application knows about.
- `?dandiset=` takes a dandiset identifier and loads its draft version automatically.

Both parameters are kept up to date in the address bar as you work, so the current URL is always a link back to what you are looking at.

## DANDI API Key

An API key is optional for browsing and editing locally, and required for two things: listing the dandisets you own, and committing changes back to the archive. To get one, log in to the instance you are using and click your user initials in the top-right corner of the archive web interface.

When you enter the key you choose whether to persist it. By default it goes into session storage and is cleared when the browser closes. Checking "Save API key in browser" puts it in local storage instead, where it survives across sessions but is also readable by anyone else using that browser profile, so it is not a good choice on a shared computer. Keys are stored per instance, so a production key and a sandbox key can coexist.

Before enabling the commit button, the application checks that the authenticated user is an owner of the dandiset. If you are not an owner, the button stays disabled and explains why. This is the same permission the DANDI API enforces, checked up front so that you find out before writing a long set of edits.

## The AI Assistant

The chat panel on the left is the primary way to edit metadata. The assistant receives the current dandiset metadata, the DANDI dandiset JSON schema, and the DANDI metadata documentation as context, and it has three tools:

- `propose_metadata_change` applies one or more edits to the working copy of the metadata. Each change is an operation (set, delete, insert, or append) at a dot-notation path such as `contributor.0.name` or `keywords`. Changes go into the pending list rather than to the archive, and fields that the schema marks read-only are rejected.
- `fetch_url` retrieves the contents of a URL from an allowlist of publisher, ontology, and academic API domains, including doi.org, PubMed, bioRxiv, OpenAlex, ROR, and ORCID. The system prompt instructs the assistant to use this tool rather than recalling external information, and to say so when a fetch fails.
- `lookup_ontology_term` searches UBERON, DOID, NCIT, HP, GO, and CL through the EBI Ontology Lookup Service, and the Cognitive Atlas API, and returns identifiers suitable for the `about` field. The assistant is instructed never to write an ontology identifier it has not looked up.

The assistant also proposes short follow-up prompts, which appear as clickable chips below the conversation.

### Models and Keys

Requests go to a shared completion worker at `qp-worker.neurosift.app`, which talks to OpenRouter. A subset of the model list is marked free, currently the smaller OpenAI, Google, Moonshot, and DeepSeek models, and those run on a key held by the worker at no cost to you. The default is `deepseek/deepseek-v4-flash-0731`.

The remaining models, such as `openai/gpt-4o` and the Claude Sonnet models, require your own OpenRouter key. Enter it in the chat settings dialog, where it is stored in browser local storage and sent with each request. The settings dialog shows the per-million-token prices for each paid model, and the chat panel tracks estimated cost for the conversation. You can also type any OpenRouter model ID that is not on the list.

### Conversation Compression

Long conversations get expensive, since the full metadata and the accumulated history are resent on every turn. Once the conversation passes a length threshold the panel suggests compressing it, and there is a compress button in the chat toolbar at any time. Compression asks the model to summarize the conversation, preserving proposed changes, tool results, and decisions, and then replaces the message history with that summary. Accumulated token usage is carried over, so the cost figure continues to reflect the whole session.

## Reviewing and Committing Changes

Every edit, whether it comes from the assistant or from the editable fields in the metadata panel, is held as a pending change against the metadata as it was loaded. A summary at the top of the metadata panel counts additions, removals, and modifications, and renders the difference inline with the removed text struck through and the added text highlighted. You can discard all pending changes at once.

The edit icon in the metadata panel header opens a JSON editor for the whole document. Read-only fields are filtered out of the editable text and shown separately, and the result is validated against the dandiset schema before it is accepted, so a malformed document cannot be applied.

Committing sends the modified metadata to the DANDI API as a PUT on the draft version, then reloads the version to show the archive's view of the result.

## Proposal Links and Review Mode

If you do not have write access, or you want someone else to look at your edits first, the link button next to the commit button copies a proposal link to the clipboard. The link carries the dandiset identifier, an MD5 hash of the metadata the changes were computed against, and a compact delta of the changes, all encoded into the URL. Nothing is stored on a server.

Opening a proposal link loads the dandiset, verifies that the metadata still hashes to the recorded value, and applies the delta. If the dandiset has been modified since the proposal was created the hash will not match and the application reports that the changes can no longer be applied safely, rather than applying them to a document they were not written for.

Proposal links include `?review=1`, which opens the metadata panel full width without the chat panel, showing the incoming changes as diffs. An Edit button leaves review mode and restores the normal split view, at which point the recipient can adjust the changes or commit them.

## Development

```bash
npm install
npm run dev     # Vite dev server on http://localhost:5173
npm run build   # type-check and build into dist/
npm run lint    # ESLint
```

No environment variables or API keys are needed to build or run the application locally. The DANDI and OpenRouter keys are entered by the user at runtime and stay in the browser.

## Tech Stack

React, TypeScript, Vite, and Material UI, with Ajv for schema validation and jsondiffpatch for the diffs and proposal deltas.

## Authors

- Jeremy Magland, Center for Computational Mathematics, Flatiron Institute
- Ben Dichter, CatalystNeuro

## License

Apache 2.0
