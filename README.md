# Dandiset Metadata Assistant

A web application for viewing and editing DANDI Archive dandiset metadata with AI assistance.

https://magland.github.io/dandiset-metadata-assistant/

## Features

- **Load dandiset metadata** from the DANDI Archive API by ID and version
- **View metadata** in a structured, expandable format
- **AI chat interface** (placeholder) for AI-assisted metadata editing
- **Track pending changes** with inline color-coded diffs
- **API key management** stored in browser localStorage
- **Resizable split-panel layout** for chat and metadata views

## Getting Started

```bash
npm install
npm run dev
```

## Usage

1. Enter a Dandiset ID (e.g., `000003`) and select a version
2. Click "Load" to fetch the metadata
3. (Optional) Configure your DANDI API key to access embargoed dandisets and enable committing changes
4. Use the AI assistant to propose metadata changes
5. Review pending changes (highlighted inline) and commit when ready

## Tech Stack

- React + TypeScript
- Vite
- Material UI

## License

Apache 2.0

## Authors

- Jeremy Magland, Center for Computational Mathematics, Flatiron Institute
- Ben Dichter, CatalystNeuro
