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

**English** · [简体中文](README.md)

[Gitee mirror](https://gitee.com/ethanbourne789/yiioffice)

---

## Vision

> **A local-first Office with no ads and no sign-in — native support for Word, Excel, PowerPoint and PDF.**

Office software today either locks your files in the cloud, requires an account, fills the sidebar with upsells, or drags a whole collaboration stack behind a single "open a document". YiiOffice goes the other way: **double-click a file and it opens, works offline, and nothing is registered, uploaded or advertised.**

Four principles follow from that:

| Principle | How it is done |
|-----------|----------------|
| **Local-first** | Open, edit, save, convert and index on your machine. No account system, no forced cloud sync. |
| **Actually usable** | Not a viewer. Docs / Sheets / Slides / Markdown all open, edit and save native formats, and **MS Office / WPS can still open what they save**; PDF offers viewing, navigation and page-level operations. |
| **Clean** | No login wall, no ads, no telemetry, no paid entry points hidden in the UI. |
| **Format first** | Reads and writes standard `.docx` / `.xlsx` / `.pptx` / `.pdf` directly. |

---

## Features

### The workbench

One window hosting every editor as a tab — the first thing you see when the app opens:

- **Home**: recent files, starred files, folder tree (multiple roots, expandable subfolders), filter by file type
- **Create and open**: one click for Docs / Sheets / Slides / Markdown; double-click through file associations
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

---

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

---

## Quick start

### Requirements

| Dependency | Version / notes |
|------------|-----------------|
| Go | ≥ 1.27 (see `go.mod`) |
| Node.js | ≥ 22 |
| wails3 CLI | v3.1.0: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` |
| WebView2 | usually preinstalled on Windows 10/11; otherwise install the Evergreen runtime |
| NSIS | only for the installer build (`makensis` must be on PATH) |

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

---

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

---

## Tests and gates

```bash
go vet ./... && go test ./internal/...  # backend vet + unit tests
npm --prefix frontend run typecheck     # tsc for every workspace
npm --prefix frontend test              # Vitest unit tests
npm --prefix frontend run build         # full renderer build
task e2e                                # Playwright E2E against the real Go backend
```

CI (GitHub Actions) runs the Go, frontend and E2E stages in order on every push / PR.

---

## FAQ

**Do I need an account or a network connection?**

No. There is no account system and no upload; editing, saving, search and conversion all happen locally. Update checks never run on their own — they start only when triggered from the settings UI.

**Can MS Office / WPS open the files after saving?**

Yes. Saves are OOXML patches: only edited nodes change, the remaining bytes stay as they were, so structures and extended properties Office relies on are preserved.

**Can I annotate or edit text in a PDF?**

No. The PDF engine here is pdfcpu, which manipulates page structure (merge, split, crop, page replacement and so on). Content-stream editing is beyond its capability boundary, so those entry points are hidden. Viewing, navigation and page operations all work.

---

## Acknowledgements

YiiOffice builds on [Wails](https://wails.io/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdfcpu](https://github.com/pdfcpu/pdfcpu) · [excelize](https://github.com/xuri/excelize) · [CodeMirror](https://codemirror.net/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [marked](https://marked.js.org/) · [SQLite (modernc)](https://modernc.org/sqlite) · [fsnotify](https://github.com/fsnotify/fsnotify) · [GenOffice](https://genoffice.ai/)

---

## License

[Apache License 2.0](LICENSE). The YiiOffice name and logo are trademarks of their owner; Apache-2.0 does not grant trademark rights (section 6). Forks should use their own branding.

**English** · [简体中文](README.md)
