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
- **Drag and drop**: drop a supported file onto the main window and it opens a tab in the matching editor; multiple files open one after another in drop order, while folders and unknown types are ignored. Legacy binary formats (`.doc` / `.xls` / `.ppt`) are out of scope — save them in the new format first
- **Recent files**: loaded newest-first in pages, with older entries fetched as you scroll down; a file you open moves back to the top. At most the newest 2,000 records are kept locally; starred files are exempt from that cap (older starred entries stay), so the list can exceed 2,000 entries
- **Settings that stick**: UI language (English / Chinese), UI and document theme, default save folder, default app per file type; recents and stars are persisted locally

### Five editors

| Editor | Formats | Engine | Highlights |
|--------|---------|--------|------------|
| **Docs** | `.docx` | Tiptap 3 + `docx-engine` | Word-style ribbon (Home / Insert / Draw / Design / Layout / References / Review / View), format painter and paste special, separate East-Asian / Latin fonts, image crop and background removal, find and replace, word count, zoom and reading mode, paragraph-patch saves |
| **Sheets** | `.xlsx` `.xlsm` `.csv` `.tsv` | Univer 1.3 + `xlsx-gateway` + Go `workbook` (excelize) | Formulas and a function library, conditional formatting, data validation, sort and filter, tables, notes, drawings, find and replace; reading and saving run through the Go-side OOXML patch gateway |
| **Slides** | `.pptx` | Konva 10 + `pptx-engine` / `pptx-ops` / `pptx-render` | Ribbon-style editing (Insert / Draw / Design / Transitions / Animations / Slide Show / Review), text/shape/picture/table editing, transitions and animations, EMU→px high-fidelity rendering, element-patch saves |
| **PDF** | `.pdf` | pdf.js 6 + pdfcpu (Go) | Viewing and navigation (thumbnails, page jump, zoom, fit modes); page operations: merge, split, extract pages, insert PDF, replace pages, N-up, grid cut, crop, page size, page-image export, blank pages |
| **Markdown** | `.md` `.markdown` `.txt` `.json` | Tiptap + CodeMirror 6 | WYSIWYG and source views, tables / code blocks / images, Mermaid diagrams, KaTeX math |

Editors also accept drops: images dropped into Docs or Sheets are inserted into the open file, and images, videos or audio dropped onto a slide are inserted on the current page.

### Encrypted workbooks, saves and printing

- **Opening**: a password-protected OOXML workbook (`.xlsx` / `.xlsm`) prompts for its password; a wrong password can be retried in the same dialog, and cancelling leaves the file closed. Both ECMA-376 Standard and Agile encryption can be decrypted.
- **Saving**: if the file already has a password, save and save-as keep it, but re-encrypt with ECMA-376 **Standard**. A file that used Agile encryption becomes Standard after one save here — the password itself does not change, and MS Office / WPS can still open it. Files that were unencrypted stay unencrypted.
- **What does not work**: `.xls` (the Excel 97-2003 binary format) cannot be opened; save it as `.xlsx` in Excel or WPS first. Any other encryption container we cannot recognise is reported as "encryption method not supported" rather than passed off as a damaged file.
- **Printing**: Sheets has no physical printing; only "Export as PDF" remains. `Ctrl+P` exports a PDF directly and never opens a system print dialog.

### System notifications

Export and save results are surfaced in the Windows notification center:

- **Export finished**: if the window has focus, only the in-app message appears; the system toast is raised once you switch to another program.
- **Export failed**: a toast is raised whether or not the window is focused.
- **Save failed**: a toast is raised whenever the window is not focused; while it is focused, Docs / Sheets / Markdown still raise one, and Slides only shows its in-app message.
- The same failure text toasts at most once every 60 seconds; background autosave failures only toast while the window is not focused and are not deduplicated, so a disk that stays unwritable can repeat on the save cadence.
- Notifications cover exports and saves in Docs / Sheets / Slides / Markdown; PDF viewing, page operations and export do not raise system notifications.
- The icon, layout and dwell time are decided by your Windows version and notification settings; the app only supplies a title and a body.

### Manual update check (read-only)

Settings → About has a "Check for updates" button:

- It only reads the latest release and shows the result: up to date, a new version, incomparable, or check failed. It does not download an installer, read the checksum sidecar, or launch the installer.
- If the release tag is not a semantic version (such as `v1.2.3`, where the leading `v` is optional), the UI shows "New release: <tag>" with a note that the versions cannot be ordered, plus the publish date, release notes and a link to the release page. Once the tag becomes semver, the comparison resumes on its own.
- Automatic download and installation are not enabled; see the note under "Quick start" below for the current state.

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

## Installer Size Comparison (Windows 64-bit)

> Data checked on 2026-11-04. All sizes refer to **full offline installers**; 1 MB = 1,048,576 bytes (the same convention Windows uses for file sizes), and 1 GB = 1,024 MB. The Office row is the set of cab/dat files fetched by ODT; the others are single installers.

| Product | Version | Installer type | Size | Relative to this project | Notes |
| --- | --- | --- | --- | --- | --- |
| Microsoft Office | Office LTSC 2024 (ProPlus2024Volume, x64) | Full offline ODT package (cab/dat set, en-us) | 3,115.0 MB (3,266,286,064 bytes) | about 123× | Full suite; fetched anonymously via ODT `/download`, with byte counts summed from the official CDN file set; an LTSC license is still required to install and activate. LTSC 2021 measured the same way at 1,858.4 MB. |
| WPS Office | Windows 64-bit build 29158 (2026-10-12) | Full offline installer | 356.8 MB | about 14× | The website's default download is an online installer of about 5 MB; this row uses the full package. |
| LibreOffice | 26.8.2 | Full offline installer (MSI) | 358.5 MB | about 14× | Only a full MSI is offered; there is no online installer. |
| ONLYOFFICE Desktop Editors | 10.0.0 | Full offline installer (EXE) | 286.0 MB | about 11× | An online installer of about 1 MB is also offered; this row uses the full Windows x64 package. |
| **YiiOffice** | 0.13.0 | Full offline installer (NSIS) | **25.4 MB** | 1× (baseline) | `dist/YiiOffice_0.13.0_setup.exe`, 26,625,923 bytes. |

These numbers compare installer size only; they are not a full comparison of capability or quality. Office LTSC, WPS and LibreOffice are broader office suites whose installers bundle many local components, fonts, templates and offline resources; ONLYOFFICE likewise ships a complete desktop editor. YiiOffice is a lightweight, self-built suite that relies on the system WebView2 (usually preinstalled on Windows 10/11) for rendering, which keeps its installer small. The size difference comes from product trade-offs, not from a difference in quality.

**Sources and conversion**

- Microsoft: the ODT is publicly downloadable; with `ProPlus2024Volume`, x64 and en-us, `setup /download` fetched files without a VLSC login. Byte counts come from the official PerpetualVL2024 CDN (<https://officecdn.microsoft.com/pr/7983bac0-e531-40cf-be00-fd24fe66619c/Office/Data/16.0.17932.21056/>), totaling 3,266,286,064 bytes; a valid LTSC license is still required to install and activate. Office LTSC 2021 (16.0.14334.20974) totals 1,948,647,170 bytes (1,858.4 MB) by the same method.
- WPS: official CDN full package `WPS_Setup_x64_29158.exe`, 374,103,552 bytes on download; release information in the WPS official community (<https://bbs.wps.cn/topic/99188>).
- LibreOffice: official download `LibreOffice_26.8.2_Win_x86-64.msi`, 375,934,976 bytes (<https://download.documentfoundation.org/libreoffice/stable/26.8.2/win/x86_64/LibreOffice_26.8.2_Win_x86-64.msi>).
- ONLYOFFICE: the official download page lists the Windows x64 full package at 286 MB (<https://www.onlyoffice.com/en/download-desktop>); the corresponding GitHub release asset `DesktopEditors_x64.exe` is 299,860,896 bytes.
- YiiOffice: measured from the current build artifact in this repository.

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

In-app updates are currently paused; before resuming, follow the [release checklist](docs/releasing.md) to prepare the tag and assets.

### Headless export

The shipped `YiiOffice.exe` converts files without opening a window:

```bash
YiiOffice.exe --headless-export <input> --to <format> --out <output> [--json]
```

| Input | `--to` | Notes |
| --- | --- | --- |
| `.docx` | `pdf` / `html` | Paginated PDF or standalone HTML |
| `.xlsx` `.xlsm` `.csv` `.tsv` | `pdf` | Every worksheet |
| `.pptx` | `pdf` | One PDF page per slide |
| `.md` `.markdown` | `pdf` | Rendered document (not the source view) |

- The input list is limited to formats that really open and convert, shared by the CLI and the renderers: `.docx`, `.xlsx` / `.xlsm` / `.csv` / `.tsv`, `.pptx`, `.md` / `.markdown`.
- Legacy 97-2003 binaries (`.doc` / `.xls` / `.ppt`) and `.html` / `.htm` are rejected during argument validation (exit code `1`), and the error lists the supported extensions; save legacy files as `.docx` / `.xlsx` / `.pptx` first. `.html` / `.htm` are export targets only. A legacy `.xls` is rejected at the entry point instead of being routed to Sheets and failing there.
- Exit codes: `0` success, `1` bad arguments/format, `2` input problem, `3` conversion or timeout failure.
- With `--json`, stdout carries one structured line (including the output path on success).
- The CLI waits for the editor to finish rendering: up to 20 s for first load and 45–90 s (per type) for the export itself. A timeout exits with `3` and a diagnostic.
- DOCX output, source-view Markdown and PDF page operations are not available headless; those remain GUI-only.

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

**Can I just drag files into the window?**

Yes. Dropping a supported file onto the main window opens a tab in the matching editor, and dropping several opens them one after another; folders and unknown types are ignored. Drops inside an editor are handled there instead: images dropped into Docs or Sheets are inserted into the open file, and images, videos or audio dropped onto a slide are inserted on the current page.

**Can I open a password-protected Excel file, and does the password survive a save?**

Yes for `.xlsx` / `.xlsm`; you are asked for the password first. If the file already has one, save and save-as keep it, but re-encrypt with ECMA-376 Standard — a file that used Agile becomes Standard after one save here. `.xls` and encryption methods we cannot recognise cannot be opened.

**Why does Ctrl+P in Sheets not open a print dialog?**

There is no reliable physical printing pipeline, so Sheets keeps only "Export as PDF"; `Ctrl+P` exports a PDF directly instead of opening a system print dialog.

**Windows says the publisher is unknown or SmartScreen blocks the installer. Is that expected?**

Yes. The project does not buy a code-signing certificate, so the first download may trigger that prompt. The release page publishes the installer's SHA-256 (the line in the `.sha256` asset); run `Get-FileHash -Algorithm SHA256 <installer>` and compare before choosing "Run anyway".

---

## Acknowledgements

YiiOffice builds on [Wails](https://wails.io/) · [Univer](https://github.com/dream-num/univer) · [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) · [Konva](https://konvajs.org/) · [pdf.js](https://github.com/mozilla/pdf.js) · [pdfcpu](https://github.com/pdfcpu/pdfcpu) · [excelize](https://github.com/xuri/excelize) · [CodeMirror](https://codemirror.net/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [marked](https://marked.js.org/) · [SQLite (modernc)](https://modernc.org/sqlite) · [fsnotify](https://github.com/fsnotify/fsnotify) · [GenOffice](https://genoffice.ai/)

---

## License

[Apache License 2.0](LICENSE). The YiiOffice name and logo are trademarks of their owner; Apache-2.0 does not grant trademark rights (section 6). Forks should use their own branding.

**English** · [简体中文](README.md)
