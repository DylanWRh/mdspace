# Contributing

Local Markdown Reader has two build layers but one runtime application:

* Flask owns workspaces, filesystem validation, rendering, optimistic document saves, and asset storage.
* Milkdown/Crepe owns the in-memory rich editor state and serializes it back to Markdown.
* Markdown and ordinary media files inside the selected workspace are the only persisted document data.
* Vite compiles the frontend into `markdown_reader/static/dist/`; those generated files ship in the wheel.

## Python setup

Use Python 3.10 or newer:

```bash
python -m pip install -e .
python -m pytest
```

## Frontend setup

```bash
cd frontend
npm install
npm run typecheck
npm test
npm run build
```

For an iterative browser workflow:

```bash
cd frontend
npm run dev
```

Then run Flask in a second terminal:

```bash
readmd . --no-browser
```

The frontend watcher writes only compiled assets into the Python package. Node
and `frontend/node_modules` are never runtime dependencies.

## Browser tests

Install Playwright's Chromium build once if it is not already present, then run:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

The test server creates a Markdown workspace in the operating system's
temporary directory; browser tests do not edit repository documents.

## Distribution verification

Always build the frontend before producing Python artifacts:

```bash
cd frontend
npm ci
npm run build
cd ..
python -m build
```

Verify that the wheel contains `markdown_reader/static/dist/manifest.json` and
all referenced assets, then install the wheel into an isolated Python 3.10
environment and run `python -m markdown_reader --help`.

## Safety invariants

Changes must preserve these invariants:

* Every browser mutation requires the local workspace token.
* User paths resolve through the workspace boundary checks.
* Document saves compare version hashes and use atomic replacement.
* Asset uploads are streamed, size-bounded, content-hashed, and stored below the current document directory.
* Persisted Markdown never contains `/api/raw`, Base64 image data, blob URLs, or editor-specific JSON.
* A 409 conflict pauses autosave and preserves the local in-memory document.
