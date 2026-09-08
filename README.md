# Local Markdown Reader

[简体中文](README-zh.md)

A local-first documentation browser for Markdown projects.

Turn any Markdown repository into a browsable documentation workspace — without deployment, online services, or additional configuration.

## Why

Markdown has become a common source format for:

* Research notes
* Technical documentation
* Open-source projects
* Project specifications
* Experiment logs
* Personal knowledge bases

Git provides excellent version control for these documents, but reading a Markdown project locally is often inconvenient:

* GitHub is designed for code hosting rather than focused reading
* VS Code is optimized for editing instead of documentation browsing
* Documentation websites require additional build and deployment steps

Local Markdown Reader provides a lightweight reading experience while keeping Markdown files as the source of truth.

```
Markdown files + Git
        |
        v
Local Markdown Reader
        |
        v
A browsable local documentation workspace
```

## Features

### Project-based Reading

* Browse an entire Markdown project from its directory structure
* Navigate documents through a project file tree
* Automatically open `README.md`, `index.md`, or the first available Markdown file
* Keep relative links and local assets working naturally

### Rich Markdown Rendering

Supports:

* GitHub-style Markdown
* Code syntax highlighting
* Tables, task lists, and footnotes
* Mermaid diagrams
* MathJax expressions using `$...$`, `$$...$$`, `\(...\)`, or `\[...\]`
* Explicit bold, italic, strikethrough, and inline-code styling
* Local images and SVG assets

### Comfortable Reading Experience

Provides:

* Three-column documentation layout
* File search and navigation
* Breadcrumbs and table of contents
* Internal link preview and navigation
* Reading progress tracking
* Estimated reading time
* Collapsible sections
* Print-friendly styles

### Rich Markdown Editing

Read and write in the same focused workspace while Markdown remains the only
canonical document format:

* Edit rendered-looking paragraphs, headings, lists, links, code, tables, and math directly
* Use slash commands and a compact selection toolbar
* Reorder individual blocks or drag a heading together with its complete section
* Drop or paste images and attach video, audio, PDFs, and other local files
* Store media beside the document with portable relative Markdown paths
* Switch between Rich and Source editing without saving or losing the current session
* Optionally autosave after edits (off by default) while preserving explicit `Ctrl`/`Cmd` + `S`
* Detect external file modifications and stop before overwriting them

## Use Cases

### Research Projects

Markdown is often used as the working format for research projects:

```
project/
├── README.md
├── proposal.md
├── experiments/
│   ├── exp1.md
│   └── exp2.md
└── notes/
    └── ideas.md
```

Open the repository as a structured research document.

### Open-source Projects

For repositories containing:

```
repository/
├── README.md
├── docs/
├── tutorials/
└── examples/
```

Local Markdown Reader provides a documentation-style browsing experience without building a documentation website.

### Personal Knowledge Bases

Keep notes as Markdown files managed by Git while enjoying a cleaner reading interface.

## Setup

Choose the setup that matches how you will use the project.

### Use-only setup

Use this path if you only want to run Local Markdown Reader. It requires
Python 3.10 or newer:

```bash
python -m pip install .
```

The Python package includes the compiled browser application. Node.js, npm,
Playwright, and a Playwright-managed browser are not required to install or
run `mdspace`.

After installation, open a Markdown workspace with:

```bash
mdspace <directory>
```

### Full development setup

Use this path to change the Python server or browser application and run the
complete test and build workflow. It requires Python 3.10 or newer, Node.js,
and npm.

Install the project in editable mode with the Python test and packaging tools:

```bash
python -m pip install -e ".[dev]"
```

Install the exact frontend dependency versions recorded in
`frontend/package-lock.json`, followed by Playwright's Chromium build:

```bash
cd frontend
npm ci
npx playwright install chromium
cd ..
```

Playwright and its Chromium build are development-only dependencies used by
the browser end-to-end tests. They are not part of the use-only setup.

## Usage

Open a workspace:

```bash
mdspace <directory>
```

Or select a workspace from the browser:

```bash
mdspace
```

Open a specific initial document:

```bash
mdspace <directory> --initial <markdown-file>
```

Additional options:

```bash
mdspace <directory> --port 9000 --no-browser
```

### Browser startup

By default, `mdspace` asks the operating system to open the reader URL in the
default browser. The local server does not depend on this automatic launch. If
no graphical browser is installed—for example in a minimal Linux, container,
SSH, or remote development environment—copy the URL printed by `mdspace` into a
browser on the machine that can reach the server.

Browser detection failures are handled quietly. To skip the automatic launch
entirely, use:

```bash
mdspace <directory> --no-browser
```

## Design Philosophy

### Local-first

Your documents stay on your machine.

### Source-first

Markdown files remain the canonical source. The reader only provides a better presentation layer.

### Project-first

A Markdown project is more than a single file. The reader treats the whole directory as a connected documentation space.

## Privacy

* Runs locally by default
* Binds to `127.0.0.1`
* Only accesses the selected workspace
* Does not upload document contents

## Development workflow

The following commands assume the full development setup above has been
completed.

Run the Python test suite:

```bash
python -m pytest
```

Type-check, test, and build the TypeScript browser application:

```bash
cd frontend
npm run typecheck
npm test
npm run build
cd ..
```

`npm run dev` watches the frontend and continuously rebuilds the packaged
assets. Run `mdspace . --no-browser` in another terminal while developing.

Run the Playwright browser end-to-end tests:

```bash
cd frontend
npm run test:e2e
cd ..
```

Build distributable Python artifacts after the frontend build:

```bash
python -m build
```

See `CONTRIBUTING.md` for the full workflow and architecture notes.
