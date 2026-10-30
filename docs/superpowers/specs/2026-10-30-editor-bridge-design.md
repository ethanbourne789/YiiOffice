# Editor Bridge Design: Docs + Slides Wails V3 Migration

**Date**: 2026-10-30
**Status**: Draft for review
**Related**: [wailsv3-upgrade-and-parity plan](./2026-10-30-wailsv3-upgrade-and-parity.md)

## Problem Statement

Docs and Slides renderers call `window.desktop.*` methods (37 and 126 respectively) that were served by an Electron preload bridge. In the Wails V3 migration, `createDesktopApi()` only implements ~11 methods for docs, and slides has no bridge at all. This causes `TypeError: xxx is not a function` on first method call, leaving both editors blank.

## Architecture Decision

### Slides Editing Stays in Frontend

Go has no open-source PPTX fine-grained editing library. The existing `@yiioffice/pptx-engine` + `@yiioffice/pptx-ops` already implements 50+ edit operations with undo/redo, plan-time validation, and byte-level fidelity. Go backend handles file I/O only; edit operations remain frontend.

### Docs Saving Moves to Go

`saveDocx*` / `openDocx*` operations move from Electron main process to Go. Go implements atomic file writes, external modification detection, password-protected documents, and crash recovery copies.

## Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (iframe)                                           │
│  window.desktop = { ...HomeBridge, ...DesktopApi }          │
│  window.slidesDesktop = { ...HomeBridge, ...SlidesDesktopApi }│
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  wails-bridge (TypeScript)                                  │
│  ├─ editor-api.ts      createDesktopApi(), createSlidesDesktopApi() │
│  ├─ docs-bridge.ts     Wraps @bindings/.../docsservice      │
│  ├─ slides-bridge.ts   Wraps @bindings/.../slideservice (NEW)│
│  └─ index.ts           installBridge() sets window.desktop, window.slidesDesktop │
└────────────────────────┬────────────────────────────────────┘
                         │ Wails V3 named bindings
┌────────────────────────▼───────────────────────────────────┐
│  Go Services                                                │
│  ├─ HomeService (already exists, reused)                   │
│  ├─ DocsService (extended with saveDocx*, openDocx*)       │
│  ├─ SlidesService (already has file I/O)                   │
│  └─ TabService (dirty tracking, reused)                    │
└─────────────────────────────────────────────────────────────┘
```

## Section 1: Method Classification

### Docs (37 methods)

| Category | Count | Methods |
|----------|-------|---------|
| **Reuse HomeService** | ~10 | `getLanguage`, `getTheme`, `getDocumentTheme`, `getRecentFiles`, `onThemeChanged`, `onDocumentThemeChanged`, `getSystemLocale` |
| **Extend DocsService** | ~14 | `saveDocx`, `saveDocxAs`, `saveDocxNew`, `saveDocxTo`, `openDocx`, `openDocxPath`, `openDocxDecrypt`, `consumePendingOpenDocx`, `consumeNewBlankDoc`, `confirmDocumentReplace`, `setDocPassword`, `docPasswordIntentRevision`, `discardDocPasswordIntents`, `writeRecoveryCopy` |
| **Frontend stub (events)** | ~12 | `onOpenDocx`, `onRenamedDocx`, `onCloseCheck`, `onCloseSaveRequest`, `reportCloseCheck`, `reportCloseSaveResult`, `onMenuCommand`, `onTeardown`, `onContextMenuRequest`, `onViewImage`, `armContextMenu`, `claimContextMenu` |
| **Noop / optional** | ~1 | `spellDiag`, `reportViewMenuState` |

### Slides (126 methods)

| Category | Count | Methods |
|----------|-------|---------|
| **Reuse HomeService** | ~4 | `getLanguage`, `getTheme`, `getRecentFiles`, `onThemeChanged` |
| **Extend SlidesService (file I/O)** | ~10 | `openPptx`, `save`, `saveAs`, `consumePendingOpen`, `newBlank`, `pickExportDir`, `pickExportPdfPath`, `exportImages`, `exportPdf`, `fontDownload` |
| **Frontend stub (events)** | ~13 | `onDeckChanged`, `onOpened`, `onRenamed`, `onHistoryChanged`, `onMenuCommand`, `onCloseSaveRequest`, `reportCloseSaveResult`, `onFontsChanged`, `headlessExportDone`, `setAutoSavePref` |
| **Frontend edit operations (keep in TS)** | ~100+ | `editText`, `editTransform`, `addElement`, `deleteElement`, `undo`, `redo`, etc. |

## Section 2: DocsService Extension

### New Go Methods

```go
// In internal/bridge/docsservice.go

type DocxOpenResult struct {
    Path    string `json:"path"`
    Base64  string `json:"base64"`
    Error   string `json:"error,omitempty"`
}

func (s *DocsService) OpenDocx() DocxOpenResult          // Opens dialog, returns base64
func (s *DocsService) OpenDocxPath(path string) DocxOpenResult  // Opens specific path
func (s *DocsService) OpenDocxDecrypt(path, password string) DocxOpenResult

type DocxSaveResult struct {
    Path  string `json:"path"`
    OK    bool   `json:"ok"`
    Error string `json:"error,omitempty"`
}

func (s *DocsService) SaveDocx(path string, base64 string, auto bool) DocxSaveResult
func (s *DocsService) SaveDocxAs(suggestedName string, base64 string, srcPath string) DocxSaveResult
func (s *DocsService) SaveDocxNew(suggestedName string, base64 string) DocxSaveResult
func (s *DocsService) SaveDocxTo(path string, base64 string, overwrite bool) DocxSaveResult

func (s *DocsService) WriteRecoveryCopy(path string, base64 string) error
func (s *DocsService) SetDocPassword(path string, password string) error
func (s *DocsService) DocPasswordIntentRevision() int
func (s *DocsService) DiscardDocPasswordIntents(rev int)

func (s *DocsService) ConsumePendingOpenDocx() (string, error)  // Returns path or empty
func (s *DocsService) ConsumeNewBlankDoc() bool                 // One-shot flag
func (s *DocsService) ConfirmDocumentReplace() bool
func (s *DocsService) GetSystemLocale() string
```

### Design Notes

- **Atomic write**: Existing `docsFileSave` pattern (temp file + rename) provides crash safety.
- **External modification detection**: Go checks file mtime before auto-save; returns conflict info to frontend.
- **Password protection**: Stub implementation — stores password in memory (not persisted), used by frontend `openDocxDecrypt`.
- **Pending open**: Uses `TabHost` pending mechanism — when a file opens via `OpenPath`, the path is stored in a one-shot queue consumed by `ConsumePendingOpenDocx`.
- **Recovery copy**: Writes to `<dataDir>/documents/recovery/` directory.

## Section 3: Slides Desktop API (Frontend Bridge Only)

### New TypeScript Module: `slides-bridge.ts`

```typescript
// frontend/packages/wails-bridge/src/slides-bridge.ts
import { OpenPath, Save, SaveAs, FilesRead, FilesReadImage, FilesAdd, PickFiles, Opened, Renamed } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slideservice'
import { ExportPdf, ExportImages, PickExportDir, PickExportPdfPath, FontDownload } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slideservice'

export interface SlidesDesktopApi {
  // File I/O (Go backend)
  openPptx(fitWidthPx: number): Promise<{ path: string; base64: string } | null>
  save(): Promise<void>
  saveAs(name: string): Promise<string | null>
  consumePendingOpen(): Promise<{ path: string; base64: string } | null>
  newBlank(fitWidthPx: number): Promise<{ base64: string }>

  // Export
  exportImages(op: { dir: string; slides: number[] }): Promise<void>
  exportPdf(op: { name: string }): Promise<{ ok: boolean; path?: string }>
  pickExportDir(): Promise<string | null>
  pickExportPdfPath(name: string): Promise<string | null>

  // Font
  fontDownload(family: string): Promise<boolean>

  // Events (frontend)
  onDeckChanged(handler: () => void): () => void
  onOpened(handler: (path: string) => void): () => void
  onRenamed(handler: (path: string) => void): () => void
  onMenuCommand(handler: (cmd: string) => void): () => void
  // ... other event handlers
}

export function createSlidesDesktopApi(): SlidesDesktopApi { ... }
```

### Edit Operations (Frontend Stub Layer)

The 100+ edit operations (`editText`, `addElement`, etc.) are implemented as **frontend stubs** in the bridge. They call into `@yiioffice/pptx-engine` running in the renderer:

```typescript
// In slides-bridge.ts — all are frontend operations
editText(op): Promise<void>  { return pptxEngine.editText(op) }
addElement(op): Promise<void> { return pptxEngine.addElement(op) }
undo(): Promise<void>        { return pptxEngine.undo() }
redo(): Promise<void>        { return pptxEngine.redo() }
// ... etc
```

The bridge provides the `window.desktop` surface; the actual logic delegates to the existing frontend `pptx-engine`.

## Section 4: Integration Points

### `window.desktop` Construction (Docs)

```typescript
// frontend/packages/wails-bridge/src/index.ts
window.desktop = {
  ...home,              // HomeBridge: getLanguage, getTheme, getRecentFiles, etc.
  ...createDesktopApi(), // DesktopApi: saveDocx, openDocx, pickImage, etc.
}
```

### `window.desktop` Construction (Slides)

Same `window.desktop` object, but extended with slides-specific methods:

```typescript
// Override in slides main.tsx after installBridge()
window.desktop = {
  ...window.desktop,           // Keeps HomeBridge + DesktopApi base
  ...createSlidesDesktopApi(), // Adds openPptx, save, edit operations, etc.
}
```

### Pending File Open Flow

1. User opens a file (file association, drop, or recent click)
2. `HomeService.OpenPath()` adds tab + emits `tabs:changed`
3. Renderer reads `?tabId=...` from URL, calls `consumePendingOpenDocx()` or `consumePendingOpen()`
4. Go returns the file path and base64 content
5. Renderer loads the document

## Section 5: Error Handling

- **Missing method**: All unimplemented methods return `Promise.resolve(undefined)` or `null` instead of throwing. The bridge wraps every method in try/catch.
- **File errors**: Go returns structured error objects `{ ok: false, error: "message" }` instead of throwing.
- **Dialog cancelled**: Returns `null` (file pickers) or `{ ok: false, canceled: true }` (save dialogs).
- **Edit operation fails**: Frontend pptx-engine handles its own validation; bridge layer passes errors through.

## Section 6: Testing Strategy

1. **Go unit tests**: `DocsService.SaveDocx`, `OpenDocxPath`, `WriteRecoveryCopy` with temp files
2. **Bridge typecheck**: `npm run typecheck` in wails-bridge
3. **Smoke test**: Launch app → click Docs card → type text → save → reopen → verify content
4. **Slides smoke**: Launch → open PPTX → verify slides render → make edit → save → verify mtime changed

## Section 7: Out of Scope

- PDF export for slides (uses separate `ExportService`, already exists)
- Presenter View / Show mode (requires IPC between windows)
- Cloud collaboration (shared sessions, real-time sync)
- AI-generated slides (cloud/local generation endpoints)
- Full PPTX format validation (pptx-engine handles parsing)
