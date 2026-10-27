# YiiOffice

**A local-first, open-source Office suite — reads and writes real Word, Excel, PowerPoint and PDF files. No sign-in, no uploads, no ads.**

![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![No Login](https://img.shields.io/badge/no%20login-%E2%9C%93-brightgreen)
![No Ads](https://img.shields.io/badge/no%20ads-%E2%9C%93-brightgreen)
![Offline](https://img.shields.io/badge/offline-first-%E2%9C%93-brightgreen)

<p align="center"><a href="../../README.md">简体中文</a> · <b>English</b></p>

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

**About the runtime:** this repository is the **Electron edition** of YiiOffice (Electron 45 + React 19). The Tauri 3 edition lives in the `YiiOffice-Tauri3` repository and covers the same feature surface. Electron ships Chromium and Node inside the app, so installers and memory use are larger — in exchange, rendering is fully deterministic, no system WebView version is involved, and the debugging and packaging toolchain is mature.

**About AI:** this tree **does not** contain an AI / LLM / MCP subsystem; those entry points were removed, leaving only a few stubs still to be cleaned up.

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
| **Sheets** | `.xlsx` `.xlsm` `.xls` `.csv` `.tsv` | Univer 0.25 + `xlsx-gateway` + Rust `xlsx-sidecar` | Formulas and a function library (insert function, argument hints), format cells, conditional formatting, data validation, sort/filter/advanced filter, grouping, pivot tables, charts, merge and freeze, go-to, goal seek, consolidate, fill series, paste special, name manager, sheet protection, paged printing, CSV |
| **Slides** | `.pptx` | Konva 10 + `pptx-engine` / `pptx-render` | Masters and layouts, text/shape/picture/chart editing, animations and transitions (Morph included), slideshow with presenter view, notes and comments, custom shows, non-destructive cropping, ink, SVG and image export |
| **PDF** | `.pdf` | pdf.js 6 + PDFium WASM + pdf-lib | In-place text and image editing, comments and markup, form design and filling, redaction, signatures and stamps, outline navigation, page operations, password protection, on-device PDF → Word/PPT/Excel |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | WYSIWYG and source views, tables/code blocks/images, Mermaid diagrams, KaTeX math, export to DOCX / PDF / image, print |

### Shared capabilities

- **Byte-preserving saves**: only the XML you touched is rewritten; everything else (styles, comments, embedded objects, macros) keeps its original bytes, so a file never loses formatting just by being opened
- **Atomic writes**: every save goes through a temporary file plus `rename`, so a crash or power cut cannot leave half a document behind
- **Local index**: indexing and search run entirely in `node:sqlite`; nothing is uploaded and no external service is involved
- **Two languages**: the UI ships in English and Chinese, strings live in `@yiioffice/i18n`
- **Command line**: the packaged app installs a `yiioffice` CLI that drives the same engines headlessly (see below)

---

## Command line

Packaged builds install a `yiioffice` command (running on the app's own Node, so nothing else has to be installed), which exposes the engines to scripts:

```bash
yiioffice info report.docx                         # structure: headings, blocks, sheets, slides, pages
yiioffice convert report.docx --to pdf             # docx/xlsx/pptx/md ↔ pdf and back
yiioffice create --type xlsx --from data.csv --out data.xlsx
yiioffice sheet read book.xlsx --range A1:D20 --json
yiioffice slides read deck.pptx --json             # element ids and geometry for later apply calls
yiioffice render deck.pptx --out shots/            # one PNG per slide, to look at what you made
yiioffice open report.docx                         # hand the file to the editor
```

---

## Stack

| Layer | Choice |
|-------|--------|
| Desktop runtime | **Electron 45** + electron-vite 6, packaged with electron-builder 26 |
| Main process | Node (TypeScript), `WebContentsView` tab host, `node:sqlite` FTS5 index |
| Frontend | React 19 + TypeScript 7.0, one Vite 8 build per app |
| Documents | Tiptap 3 (Docs / Markdown) |
| Spreadsheets | Univer 0.25; `.xlsx` parsing and formula evaluation in a Rust sidecar (calamine + IronCalc) |
| Slides | Konva 10 / react-konva 19 |
| PDF | pdf.js 6, PDFium WASM (`@embedpdf/pdfium`), pdf-lib |
| Code editing | CodeMirror 6 (HTML / Markdown source views) |
| Rendering support | harfbuzzjs 1.6 (complex text shaping, font subsetting), Mermaid, KaTeX |
| Tooling | npm workspaces (monorepo), ESLint 10, Prettier, Vitest 5, Playwright, Cargo |

---

## Quick start

### Requirements

| Dependency | Version / notes |
|------------|-----------------|
| Node.js | ≥ 22.12 (see `engines`) |
| npm | ≥ 10 |
| Rust | stable — only for the Sheets `xlsx-sidecar`; `cargo` on PATH |
| Windows | Windows 10/11, x64 or arm64 |

### Install and develop

```bash
# 1. Install dependencies (monorepo, one shot; postinstall downloads Electron)
npm install

# 2. Generate the .docx test fixtures
npm run fixtures

# 3. Start development: five editor dev servers (:5173–:5177) plus the Electron main process
npm run dev

#    Debug a single editor on its own
npm run dev:docs
```

> `npm run dev` first rebuilds stale preloads (`tools/build-stale-preloads.mjs`), then starts the five renderers and the shell in parallel — the editor windows load their own dev server, so all of them are needed.

### Build and package

```bash
# Build the frontends and run the main process once (no installer)
npm run build:all
npm run shell

# Full packages
npm run dist:win      # zip (portable; no NSIS installer yet)
```

Packaging regenerates the bundled third-party licence list (`npm run notices`) first. The Sheets sidecar is compiled by `npm run build -w @yiioffice/sheets`, which runs `cargo build --release`.

---

## Repository layout

```
YiiOffice-Electron/
├── apps/
│   ├── shell/                  # Electron host: main process, home screen, tab bar, settings
│   │   ├── src/main/           # Main process (tabs, windows, file index, control channel…)
│   │   ├── src/preload/        # Preload scripts (contextBridge)
│   │   └── src/renderer/       # Home / tab bar / settings
│   ├── docs/                   # Document editor (Tiptap + docx-engine)
│   ├── sheets/                 # Spreadsheet editor (Univer + xlsx-gateway)
│   │   └── native/xlsx-engine/ # Rust xlsx sidecar (calamine + IronCalc)
│   ├── slides/                 # Presentation editor (Konva + pptx-engine)
│   ├── pdf/                    # PDF editor (pdf.js + PDFium WASM)
│   └── markdown/               # Markdown editor
├── packages/                   # 14 shared packages
│   ├── docx-engine/            # DOCX parsing, generation, byte-level patching
│   ├── pptx-engine/ pptx-ops/ pptx-render/
│   ├── xlsx-gateway/ zip-gate/
│   ├── pdf2docx/ html2docx/ file-parse/
│   ├── font-metrics/ i18n/ ui/ electron-utils/
├── e2e/                        # Playwright end-to-end tests
├── docs/                       # Architecture notes, i18n, image assets
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

**7. Local control channel.**
The app listens on a socket in `userData` (0600 on POSIX, a named pipe on Windows). A CLI call must carry the random token from `control.json`; the protocol only supports "jump to this page or slide" and "read the selection" — no file writes, no code execution.

---

## Tests and quality gates

```bash
npm test                    # Vitest across 21 workspaces (including cargo test for sheets)
npm run typecheck           # TypeScript for every workspace
npm run lint                # ESLint
npm run format:check        # Prettier, changed files only
npm run check:theme-colors  # colours must go through CSS variables
npm run check:english-comments # comments and log messages must be English
npm run test:e2e            # Playwright end to end (78 specs, requires build:all first)
```

A single app can be checked on its own: `npm test -w @yiioffice/docs`, `npm run typecheck -w @yiioffice/pdf`.

**Note:** the repository currently has **no CI configuration**, so every gate above is local-only (audit §B2). `typecheck` still reports pre-existing errors in some workspaces — run it for the workspace you are touching first.

---

## Status

The app is at `0.13.0` (`@yiioffice/shell`), and the root `package.json` carries the same number. The workspace packages stay at `0.1.0` on purpose: they are internal, never published, and pulled in through `"*"` ranges. A Windows portable zip can be built locally (`apps/shell/release-build/YiiOffice-0.13.0-win.zip`).

| State | Content |
|-------|---------|
| ✅ Done | Monorepo structure; shell main flow (home, tabs, file create/rename/move/delete, persisted settings, full-text search); renderer and main-process features of all five editors; Rust xlsx sidecar; CLI and control channel; packaging script (win) |
| 🚧 In progress | Cleaning up the AI stubs left after the subsystem was removed; unifying the IPC trust model (path grants plus `senderFrame` checks); preserving file permissions on atomic writes; `ErrorBoundary` in renderers and a main-process crash handler; promoting the test and typecheck gates |
| 🗺️ Planned | ODF import (`.odt/.ods/.odp`), PDF certificate signatures, Markdown backlinks, more UI languages |

Related documents:

- [`docs/headless-pdf-export.md`](../headless-pdf-export.md) — how headless PDF export works
- [`docs/slides-op-journal.md`](../slides-op-journal.md) — Slides operation journal and undo/redo design

---

## FAQ

**Do I need an account or a network connection?**
No. There is no account system and no upload; editing, saving, search and conversion all happen locally. The app never checks for updates; the only network activity is fetching images a document points at.

**Can MS Office / WPS open the files after saving?**
Yes. Saves are OOXML patches: only edited nodes change, the remaining bytes stay as they were, so structures and extended properties Office relies on are preserved.

**How does this relate to `YiiOffice-Tauri3`?**
Two runtimes over the same product. The Tauri edition uses a Rust main process and the system WebView, so packages and memory are smaller; the Electron edition uses Chromium and Node, giving fully deterministic rendering plus a mature ecosystem and debugging tools, at the cost of size.

**What do the Windows builds produce?**
`npm run dist:win` builds the portable zip. `npm run dist:win:installer` builds the NSIS installer: the wizard defaults to `D:\YiiOffice` (it keeps an existing installation's path, and falls back to `%LOCALAPPDATA%\Programs\YiiOffice` when D: is not a fixed local volume), installs per user without a UAC prompt, and leaves the machine-wide choice available when an earlier release was installed that way. There is no auto-update chain — see audit §S3.

**Does Chinese text search work?**
Yes. The index emits bigram and unigram streams for CJK, working around the fact that FTS5 `unicode61` does not segment continuous CJK text.

**`npm run dev` started, but editor tabs are blank?**
Check that all five renderer dev servers are alive (:5173–:5177) — each editor tab loads its own dev server, so a busy port or a crashed renderer leaves that tab blank. To debug one editor alone, use a standalone mode such as `npm run dev:docs`, which opens its own window without the shell.

---

## Contributing

1. Fork and branch: `git checkout -b feat/your-feature`
2. Before committing, in the affected workspaces: `npm run lint && npm run typecheck && npm test`
3. Rust changes need `cargo test` (in `apps/sheets/native/xlsx-engine`)
4. User-visible behaviour changes should update the relevant docs — `README.md` (Chinese, source of truth) and this English mirror
5. Open a PR describing the motivation and how you verified it

Conventions: TypeScript strict mode, comments and log messages in English, UI strings through `@yiioffice/i18n` (English and Chinese), colours only via theme CSS variables.

---

## Acknowledgements

YiiOffice builds on [Electron](https://www.electronjs.org/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [PDFium](https://pdfium.googlesource.com/pdfium/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [CodeMirror](https://codemirror.net/) · [calamine](https://github.com/tafia/calamine) · [IronCalc](https://github.com/ironcalc/IronCalc) · [HarfBuzz](https://github.com/harfbuzz/harfbuzz) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [JSZip](https://stuk.github.io/jszip/) · [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)

`npm run notices` regenerates the third-party licence list shipped with the app (`tools/gen-third-party-notices.mjs`).

---

## License

[Apache License 2.0](../../LICENSE). The YiiOffice name and logo are trademarks of their owner; Apache-2.0 does not grant trademark rights (section 6). Forks should use their own branding.
