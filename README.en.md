# YiiOffice

**A local-first, open-source Office suite — reads and writes real Word, Excel, PowerPoint and PDF files. No sign-in, no uploads, no ads.**

![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Local First](https://img.shields.io/badge/local--first-%E2%9C%93-brightgreen)

<p align="center"><a href="README.md">简体中文</a> · <b>English</b> · <a href="https://ethanbourne789.github.io/YiiOffice/en/">Website</a></p>

---

## Vision

> **A local-first Office with no ads and no sign-in — native support for Word, Excel, PowerPoint and PDF.**

Office software today either locks your files in the cloud, forces an account, fills the sidebar with upsells, or drags a whole collaboration stack behind a single "open a document". YiiOffice goes the other way: **double-click a file and it opens, every feature works offline, and nothing is registered, uploaded or advertised.**

Four principles follow from that:

| Principle | How it is done |
|-----------|----------------|
| **Local-first** | Open, edit, save and convert on your machine. No account system, no forced cloud sync, no background update check. |
| **Actually usable** | Not a viewer. All five editors open, edit and save native Office formats, and **MS Office / WPS can still open what they save**. |
| **Clean** | No login wall, no ads, no telemetry, no paid entry points hidden in the UI. |
| **Format first** | Reads and writes standard `.docx` / `.xlsx` / `.pptx` / `.pdf` directly. No private formats, no "import, then edit". |

**About the runtime:** this repository is the **Electron edition** of YiiOffice (Electron 45 + React 19). Electron ships Chromium and Node inside the app, so installers and memory use are larger — in exchange, rendering is fully deterministic, no system WebView version is involved, and the debugging and packaging toolchain is mature.

<br />

---

## Features

### The shell

One window hosting every editor as a tab — the first thing you see when the app opens:

- **Home**: recent files, starred files (with custom groups), folder tree (multiple roots, expandable subfolders, drag to move, create/rename/delete), filter by file type
- **Create and open**: one click for Docs / Sheets / Slides / PDF / Markdown; the system open dialog; double-click through file associations; drop a file onto the window
- **Full-text search**: a local `node:sqlite` FTS5 index over names, paths and extracted text; CJK goes through bigram + unigram streams, so two-character Chinese words match inside longer runs
- **Tabs**: a permanent Home tab; create, switch, drag to reorder, close (with an unsaved-changes guard); drag a tab out into its own window and dock it back; MRU fallback after closing
- **State preservation**: every tab is its own `WebContentsView`, shown and hidden rather than destroyed — scroll position, caret, undo stack and unsaved content survive a tab switch
- **Settings that stick**: UI language (English / Chinese), UI and document theme, default save behaviour; recent files, stars and window size are persisted locally

### Five editors

| Editor | Formats | Engine | Highlights |
|--------|---------|--------|------------|
| **Docs** | `.docx` | Tiptap 3 + `docx-engine` | Paginated and multi-page views, headers and footers, page numbers and sections, style gallery, rulers and page setup, footnotes and endnotes, comments, document compare, equations and fields, ink, find and replace, word count, document protection, encrypted files, print and PDF export |
| **Sheets** | `.xlsx` `.xlsm` `.xls` `.csv` `.tsv` | Univer 1.2 + `xlsx-gateway` + Rust `xlsx-sidecar` | Formulas and a function library (insert function, argument hints), format cells, conditional formatting, data validation, sort/filter/advanced filter, grouping, pivot tables, charts, merge and freeze, go-to, goal seek, consolidate, fill series, paste special, name manager, sheet protection, paged printing, CSV |
| **Slides** | `.pptx` | Konva 10 + `pptx-engine` / `pptx-render` | Masters and layouts, text/shape/picture/chart editing, animations and transitions (Morph included), slideshow with presenter view, notes and comments, custom shows, non-destructive cropping, ink, SVG and image export |
| **PDF** | `.pdf` | pdf.js 6 + PDFium WASM + pdf-lib | In-place text and image editing, comments and markup, form design and filling, redaction, signatures and stamps, outline navigation, page operations, password protection, on-device PDF → Word/PPT/Excel |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | WYSIWYG and source views, tables/code blocks/images, Mermaid diagrams, KaTeX math, export to DOCX / PDF / image, print |

### Shared capabilities

- **Byte-preserving saves**: only the XML you touched is rewritten; everything else (styles, comments, embedded objects, macros) keeps its original bytes, so a file never loses formatting just by being opened
- **Atomic writes**: every save goes through a temporary file plus `rename`, so a crash or power cut cannot leave half a document behind
- **Local index**: indexing and search run entirely in `node:sqlite`; nothing is uploaded and no external service is involved
- **Headless export**: `--headless-export <file> --to pdf --out <path>` exports without showing a window, and `--json` emits one machine-readable line for scripts (see [`docs/headless-pdf-export.md`](docs/headless-pdf-export.md))
- **Two languages**: the UI ships in English and Chinese, strings live in `@yiioffice/i18n`

---

## Stack

| Layer | Choice |
|-------|--------|
| Desktop runtime | **Electron 45** + electron-vite 6, packaged with electron-builder 26 |
| Main process | Node (TypeScript), `WebContentsView` tab host, `node:sqlite` FTS5 index |
| Frontend | React 19 + TypeScript 7.0, one Vite 8 build per app |
| Documents | Tiptap 3 (Docs / Markdown) |
| Spreadsheets | Univer 1.2; `.xlsx` parsing and formula evaluation in a Rust sidecar (calamine + IronCalc) |
| Slides | Konva 10 / react-konva 19 |
| PDF | pdf.js 6, PDFium WASM (`@embedpdf/pdfium`), pdf-lib |
| Code editing | CodeMirror 6 (HTML / Markdown source views) |
| Rendering support | harfbuzzjs 1.6 (complex text shaping, font subsetting), Mermaid, KaTeX |
| Tooling | npm workspaces (monorepo), ESLint, Vitest 5, Playwright, Cargo |

---

## Quick start

### Requirements

| Dependency | Version / notes |
|------------|-----------------|
| Node.js | ≥ 22.12 (see `engines` in the root `package.json`) |
| npm | ≥ 10 |
| Rust | stable — only for the Sheets `xlsx-sidecar`; `cargo` must be on PATH |
| OS | Windows 10/11 (x64 or arm64) |

### Install and run

```bash
# 1. Install dependencies (monorepo, one shot; postinstall downloads Electron)
npm install

# 2. Generate the .docx test fixtures
npm run fixtures

# 3. Development: five editor dev servers (:5173–:5177) plus the Electron main process
npm run dev

#    Debug a single editor on its own
npm run dev:docs
```

> `npm run dev` first rebuilds stale preloads (`tools/build-stale-preloads.mjs`), then starts the five renderers and the shell in parallel — an editor tab loads its own dev server, so all five have to be alive.

### Build and package

```bash
# Build every frontend and launch the main process (the script already runs build:all)
npm run shell

# Full packages
npm run dist:win              # portable zip
npm run dist:win:installer    # NSIS installer (defaults to D:\YiiOffice, changeable)
```

Packaging regenerates the bundled third-party licence list (`npm run notices`) first. The Sheets sidecar is compiled by `npm run build -w @yiioffice/sheets`, which runs `cargo build --release`.

---

## Repository layout

```
YiiOffice-Electron/
├── apps/
│   ├── shell/                  # Electron host: main process, home screen, tab bar, settings
│   │   ├── src/main/           # Main process (tabs, windows, file index, headless export…)
│   │   ├── src/preload/        # Preload scripts (contextBridge)
│   │   └── src/renderer/       # Home / tab bar / settings
│   ├── docs/                   # Document editor (Tiptap + docx-engine)
│   ├── sheets/                 # Spreadsheet editor (Univer + xlsx-gateway)
│   │   └── native/xlsx-engine/ # Rust xlsx sidecar (calamine + IronCalc)
│   ├── slides/                 # Presentation editor (Konva + pptx-engine)
│   ├── pdf/                    # PDF editor (pdf.js + PDFium WASM)
│   └── markdown/               # Markdown editor
├── packages/                   # 13 shared packages
│   ├── docx-engine/            # DOCX parsing, generation, byte-level patching
│   ├── pptx-engine/ pptx-ops/ pptx-render/
│   ├── xlsx-gateway/ zip-gate/
│   ├── pdf2docx/ html2docx/ file-parse/
│   ├── font-metrics/ i18n/ ui/ electron-utils/
├── e2e/                        # Playwright end-to-end tests
├── docs/                       # Architecture notes and image assets
└── tools/                      # Licence, theme, font and fixture build scripts
```

---

## Architecture notes

**1. One main process, one `WebContentsView` per tab.**
The main window is the shell (home screen plus tab strip). Opening a document attaches a `WebContentsView` to that window; switching tabs shows and hides rather than destroying, so nothing reloads. A tab can be reparented into its own window and docked back later.

**2. Two modes per editor.**
Every editor runs standalone for focused debugging, and embedded as a shell tab. Each app exposes a thin bridge to the main process over IPC.

**3. A Rust sidecar with a clear boundary.**
`.xlsx` parsing and formula evaluation live in the `xlsx-sidecar` process, talking JSON to the main process. It starts only when Sheets needs it, and its tests run with plain `cargo test`.

**4. Byte-preserving saves and atomic writes.**
DOCX / PPTX saves are paragraph- and element-level patches: parse the original, rewrite only the edited nodes, splice them back. Everything hits disk through `atomic-write` (temporary file plus `rename`).

**5. Process isolation and least privilege.**
Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`; renderers reach files only through the allow-listed preload API. A custom `renderer-scheme` protocol and `navigation-guard` lock down navigation and external links. The IPC trust model (path grants plus `senderFrame` checks) and file permissions remain known gaps to be closed.

**6. Local index.**
`apps/shell/src/main/file-index` scans the working folders, extracts text (Office / PDF / Markdown / HTML) and writes it into a `node:sqlite` FTS5 virtual table. The tokenizer emits a bigram stream and a unigram stream for CJK, which covers both two-character words and single-character queries.

**Further reading:** [`docs/headless-pdf-export.md`](docs/headless-pdf-export.md) (entry point, exit codes and readiness checks for headless export) and [`docs/slides-op-journal.md`](docs/slides-op-journal.md) (the Slides operation journal and undo/redo design).

---

## Tests and gates

```bash
npm test                        # Vitest across the 19 workspace test projects in one run
npm run typecheck               # tsc for every workspace
npm run lint                    # ESLint (per-package, parallel; add --no-cache in CI)
npm run check:theme-colors      # colours must go through theme CSS variables
npm run check:english-comments  # code comments and log messages must be English
npm run test:e2e                # Playwright end to end, after a build:all
```

A single app can be checked on its own: `npm test -w @yiioffice/docs`, `npm run typecheck -w @yiioffice/pdf`.

The repository currently has **no CI configuration**, so every gate above is local-only. Tests and typechecks still carry pre-existing failures (mostly drifted assertions or imports of modules that were deleted) — run the affected workspace first to see the baseline before you touch it.

---

## FAQ

**Do I need an account or a network connection?**
No. There is no account system and no upload; editing, saving, search and conversion all happen locally. The app never checks for updates and collects no usage data. By default the only network activity is fetching images a document points at. Slides can also download missing fonts (only when a font CDN address is injected at build time; without it that entry point stays off).

**Can MS Office / WPS open the files after saving?**
Yes. Saves are OOXML patches: only edited nodes change, the remaining bytes stay as they were, so structures and extended properties Office relies on are preserved.

**What do the Windows builds produce?**
`npm run dist:win` builds the portable zip. `npm run dist:win:installer` builds the NSIS installer: the wizard defaults to `D:\YiiOffice` (it keeps an existing installation's path, and falls back to `%LOCALAPPDATA%\Programs\YiiOffice` when D: is not a fixed local volume), installs per user without a UAC prompt, and keeps the machine-wide choice available when an earlier release was installed that way. There is no auto-update chain.

**Does Chinese text search work?**
Yes. The index emits bigram and unigram streams for CJK, working around the fact that FTS5 `unicode61` does not segment continuous CJK text.

**`npm run dev` started, but editor tabs are blank?**
Check that all five renderer dev servers are alive (:5173–:5177) — each editor tab loads its own dev server, so a busy port or a crashed renderer leaves that tab blank. To debug one editor alone, use a standalone mode such as `npm run dev:docs`, which opens its own window without the shell.

---

## Acknowledgements

YiiOffice builds on [Electron](https://www.electronjs.org/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [PDFium](https://pdfium.googlesource.com/pdfium/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [CodeMirror](https://codemirror.net/) · [calamine](https://github.com/tafia/calamine) · [IronCalc](https://github.com/ironcalc/IronCalc) · [HarfBuzz](https://github.com/harfbuzz/harfbuzz) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [JSZip](https://stuk.github.io/jszip/) · [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) · [GenOffice](https://genoffice.ai)

`npm run notices` regenerates the third-party licence list shipped with the app (`tools/gen-third-party-notices.mjs`).

---

## License

[Apache License 2.0](LICENSE). The YiiOffice name and logo are trademarks of their owner; Apache-2.0 does not grant trademark rights (section 6). Forks should use their own branding.

<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>
