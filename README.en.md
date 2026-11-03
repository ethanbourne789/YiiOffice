# YiiOffice
**A local-first, open-source Office suite — reads and writes real Word, Excel, PowerPoint and PDF files. No sign-in, no uploads, no ads.**
![Wails](https://img.shields.io/badge/Wails-v3.1.0-4493F1?logo=go&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Local First](https://img.shields.io/badge/local--first-%E2%9C%93-brightgreen)
<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>
***
## Vision
> **A local-first Office with no ads and no sign-in — native support for Word, Excel, PowerPoint and PDF.**

Office software today either locks your files in the cloud, forces an account, fills the sidebar with upsells, or drags a whole collaboration stack behind a single "open a document". YiiOffice goes the other way: **double-click a file and it opens, every feature works offline, and nothing is registered, uploaded or advertised.**

Four principles follow from that:

| Principle | How it is done |
|-----------|----------------|
| **Local-first** | Open, edit, save, convert and index on your machine. No account system, no forced cloud sync; update checks only run when the user triggers them. |
| **Actually usable** | Not a viewer. Docs / Sheets / Slides / Markdown all open, edit and save native formats, and **MS Office / WPS can still open what they save**; PDF offers viewing, navigation and page-level operations. |
| **Clean** | No login wall, no ads, no telemetry, no paid entry points hidden in the UI; features the build cannot provide have their entry points removed rather than left to fail on click. |
| **Format first** | Reads and writes standard `.docx` / `.xlsx` / `.pptx` / `.pdf` directly. No private formats, no "import, then edit". |

**About the runtime:** this repository is the **Wails v3 edition** of YiiOffice — a Go backend plus the system WebView2. The build is a single native exe, so installers and memory use stay far smaller than a bundled-Chromium approach; the trade-off is that rendering depends on the WebView2 version on the user's machine, which is why the project targets Windows.

***
## Features
### The shell
One window hosting every editor as a tab — the first thing you see when the app opens:
- **Home**: recent files, starred files, folder tree (multiple roots, expandable subfolders), filter by file type
- **Create and open**: one click for Docs / Sheets / Slides / PDF / Markdown; the system open dialog; double-click through file associations
- **Full-text search**: a local SQLite FTS5 index over names, paths and extracted text; CJK goes through bigram + unigram streams, so two-character Chinese words match inside longer runs
- **Tabs**: managed centrally by a Go-side tab host; open, switch, close (with an unsaved-changes guard); detach a tab into its own window
- **Settings that stick**: UI language (English / Chinese), UI and document theme, default save folder, default app per file type; recents and stars are persisted locally
### Five editors
| Editor | Formats | Engine | Highlights |
|--------|---------|--------|------------|
| **Docs** | `.docx` | Tiptap 3 + `docx-engine` | Word-style ribbon (Home / Insert / Draw / Design / Layout / References / Review / View), format painter and paste special, separate East-Asian / Latin fonts, image crop and background removal, find and replace, word count, zoom and reading mode, paragraph-patch saves |
| **Sheets** | `.xlsx` `.xlsm` `.csv` `.tsv` | Univer 1.3 + `xlsx-gateway` + Go `workbook` (excelize) | Formulas and a function library, conditional formatting, data validation, sort and filter, tables, notes, drawings, find and replace; reading and saving run through the Go-side OOXML patch gateway |
| **Slides** | `.pptx` | Konva 10 + `pptx-engine` / `pptx-ops` / `pptx-render` | Ribbon-style editing (Insert / Draw / Design / Transitions / Animations / Slide Show / Review), text/shape/picture/table editing, transitions and animations, EMU→px high-fidelity rendering, element-patch saves |
| **PDF** | `.pdf` | pdf.js 6 + pdfcpu (Go) | Viewing and navigation (thumbnails, page jump, zoom, fit modes); page operations: merge, split, extract pages, insert PDF, replace pages, N-up, grid cut, crop, page size, page-image export, blank pages |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | WYSIWYG and source views, tables / code blocks / images, Mermaid diagrams, KaTeX math |
### Shared capabilities
- **Patch-preserving saves**: DOCX paragraph-level and PPTX element-level patches rewrite only the XML you touched; everything else keeps its original bytes, so a file never loses formatting just by being opened
- **Atomic writes**: every save goes through a temporary file plus `rename`, so a crash or power cut cannot leave half a document behind
- **Zip-bomb defence**: `zip-gate` rejects archives whose parts inflate past what they declare, before any caller materialises them; shared by the DOCX and PPTX engines
- **Local index**: indexing and search run entirely in SQLite (FTS5); nothing is uploaded and no external service is involved. fsnotify watches folders with a 400 ms debounce for incremental updates, and large roots are scanned in parallel, sliced by first-level subfolders
- **Headless export**: `--headless-export <file> --to <format> --out <path>` exports without showing a window, and `--json` emits one machine-readable line for scripts; Docs/Sheets/Slides/Markdown export to PDF, Docs also to HTML / DOCX
- **Server mode and Docker**: `-tags server` builds a pure HTTP server (no GUI, port 8080 by default) and packages it as a distroless Docker image
- **Update channel**: new releases are checked on Gitee (with a built-in Gitee API compatibility layer); installers ship a SHA-256 sidecar
- **Two languages**: the UI ships in English and Chinese, strings live in `@yiioffice/i18n`
***
## Stack
| Layer | Choice |
|-------|--------|
| Desktop runtime | **Wails v3.1.0** (Go backend + system WebView2), Task for build orchestration, NSIS packaging |
| Backend | Go 1.27 services: `workbook` (excelize), `pdfengine` (pdfcpu), `index` (SQLite FTS5 + fsnotify), `export`, `update`, `servmode` |
| Frontend | React 19 + TypeScript 7.0, one Vite 8 build per app, typed bindings straight onto the Go services |
| Documents | Tiptap 3 (Docs / Markdown) + `docx-engine` |
| Spreadsheets | Univer 1.3; `.xlsx` I/O through the Go `workbook` + `xlsx-gateway` |
| Slides | Konva 10 / react-konva + `pptx-engine` / `pptx-ops` / `pptx-render` |
| PDF | pdf.js 6.5 (viewing), pdfcpu 0.16 (page operations, Go side) |
| Code editing | CodeMirror 6 (Markdown / JSON source views) |
| Rendering support | Mermaid, KaTeX, marked, opentype.js font metrics |
| Tooling | npm workspaces (monorepo), Vitest 5, Playwright, GitHub Actions CI |
***
## Quick start
### Requirements
| Dependency | Version / notes |
|------------|-----------------|
| Go | ≥ 1.27 (see `go.mod`) |
| Node.js | ≥ 22 |
| wails3 CLI | v3.1.0: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` |
| WebView2 | usually preinstalled on Windows 10/11; otherwise install the Evergreen runtime |
| NSIS | only for the installer build (`makensis` must be on PATH) |
| Docker | optional, only for the server image |
### Install and run
```bash
# 1. Install frontend dependencies
cd frontend && npm install && cd ..
# 2. Development: generate bindings, start the Vite dev server (:5178), rebuild and run
wails3 dev
```
### Build and package
```bash
task build                    # production build (build/bin/YiiOffice.exe, -tags production)
task package:windows          # NSIS installer + SHA-256 sidecar (dist/)
task build:server             # server-mode binary (pure HTTP, no GUI)
task build:docker             # distroless Docker image
task run:docker               # run the image, exposing port 8080
```
***
## Repository layout
```
YiiOffice-WailsV3/
├── main.go                       # Wails app entry (desktop / server shapes)
├── internal/                     # Go backend services
│   ├── bridge/                   # bound services for the frontend (Home/Doc/Sheet/PDF/Slide…)
│   ├── host/                     # window & tab host, file associations, settings, menus
│   ├── workbook/                 # xlsx engine (excelize + session management)
│   ├── pdfengine/                # pdfcpu page operations
│   ├── index/                    # SQLite FTS5 index + fsnotify watcher
│   ├── export/                   # headless-export CLI
│   ├── update/                   # Gitee update channel and compatibility layer
│   ├── servmode/                 # HTTP mode under the server build tag
│   └── fsutil/ platform/ …       # atomic writes, platform paths and other plumbing
├── frontend/
│   ├── apps/                     # shell / docs / sheets / slides / pdf / markdown
│   ├── packages/                 # 11 shared packages (docx-engine, pptx-*, xlsx-gateway,
│   │                             #   zip-gate, font-metrics, i18n, ui, wails-bridge…)
│   └── bindings/                 # wails3 generate bindings output
├── e2e/                          # Playwright end-to-end tests (real Go backend)
├── docker/                       # Dockerfile for server mode
├── build/                        # NSIS scripts, icons and other build assets
└── .github/workflows/ci.yml      # CI: Go + frontend + E2E pipeline
```
***
## Architecture notes
**1. Go service layer + typed bindings.**
The frontend calls Go services through typed interfaces emitted by `wails3 generate bindings -ts`, with `wails-bridge` as a thin wrapper; the same services behave identically in the desktop and server shapes.

**2. One window, one Go-side tab host.**
Tabs are managed centrally by the Go `TabService`; editors open as tabs, can be detached into their own windows, and closing is guarded against unsaved changes.

**3. One codebase, two shapes.**
`-tags server` switches to a pure HTTP server (no WebView2, no native windows) reusing the exact renderer bundles and Go services — which is precisely what the E2E suite drives.

**4. Patch-preserving saves and atomic writes.**
DOCX / PPTX saves are paragraph- and element-level patches: parse the original, rewrite only the edited nodes, splice them back. Everything hits disk through atomic writes (temporary file plus `rename`).

**5. The PDF capability boundary.**
The PDF engine is pdfcpu, which works on page structure rather than content streams. Annotations, text/image editing, form design, signatures, OCR and Office conversion are therefore **not offered** — their entry points are removed from the UI and rejected by the API, instead of leaving buttons that fail on click.

**6. Local index with incremental watching.**
`internal/index` scans the roots, extracts text (Office / PDF / plain text / code) and writes it into a SQLite FTS5 virtual table; CJK produces bigram and unigram token streams. fsnotify applies 400 ms-debounced single-file updates, and folder changes in the sidebar sync to the watcher live without a restart.

**7. Security boundaries.**
File access goes through IPC path grants (`pathgrants`); archives pass the `zip-gate` size check before inflation; server builds warn when bound to a non-loopback address.
***
## Tests and gates
```bash
go vet ./... && go test ./internal/...  # backend vet + unit tests
npm --prefix frontend run typecheck     # tsc for every workspace
npm --prefix frontend test              # Vitest unit tests
npm --prefix frontend run build         # full renderer build
task e2e                                # Playwright E2E against the real Go backend
```
CI (GitHub Actions) runs the Go, frontend and E2E stages in order on every push / PR.
***
## FAQ
**Do I need an account or a network connection?**
No. There is no account system and no upload; editing, saving, search and conversion all happen locally. Update checks never run on their own — they start only when triggered from the settings UI.
**Can MS Office / WPS open the files after saving?**
Yes. Saves are OOXML patches: only edited nodes change, the remaining bytes stay as they were, so structures and extended properties Office relies on are preserved.
**Can I annotate or edit text in a PDF?**
No. The PDF engine here is pdfcpu, which manipulates page structure (merge, split, crop, page replacement and so on). Content-stream editing is beyond its capability boundary, so those entry points are hidden. Viewing, navigation and page operations all work.
**Does Chinese text search work?**
Yes. The index emits bigram and unigram streams for CJK, working around the fact that FTS5 `unicode61` does not segment continuous CJK text.
**Can it be deployed on a server?**
Yes. `task build:server` or `task build:docker` produces the HTTP shape, listening on port 8080 by default; binding to a non-loopback address prints a startup warning, so keep it behind a trusted network or a reverse proxy.
**What do the Windows builds produce?**
`task package:windows` builds the NSIS installer (`dist/YiiOffice_<version>_setup.exe`) together with a `.sha256` sidecar for release integrity checks.
***
## Acknowledgements
YiiOffice builds on [Wails](https://wails.io/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdfcpu](https://github.com/pdfcpu/pdfcpu) · [excelize](https://github.com/xuri/excelize) · [CodeMirror](https://codemirror.net/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [marked](https://marked.js.org/) · [SQLite (modernc)](https://modernc.org/sqlite) · [fsnotify](https://github.com/fsnotify/fsnotify) · [GenOffice](https://genoffice.ai/)
***
## License
[Apache License 2.0](LICENSE). The YiiOffice name and logo are trademarks of their owner; Apache-2.0 does not grant trademark rights (section 6). Forks should use their own branding.
<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>
