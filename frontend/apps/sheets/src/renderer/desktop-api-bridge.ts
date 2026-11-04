/**
 * Electron-to-Wails bridge: provides a `window.desktopApi` object compatible
 * with the DesktopApi interface by routing all calls through generated Wails V3
 * bindings + events.
 *
 * Channel names match the Go bridge constants in internal/bridge/sheets.go.
 * Stub channels return no-op values so the renderer boots cleanly.
 */
import { on, currentTabPath, headlessExportChannel } from '@yiioffice/wails-bridge'
import * as wb from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/workbookservice'
import * as exp from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/exportservice'
import {
  GetLanguage as HomeLanguage,
  GetTheme as HomeTheme,
  GetDocumentTheme as HomeDocumentTheme,
  GetAutoSaveDefault as HomeAutoSaveDefault,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'
import { OpenExternal, ReadLocalImage } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/shellservice'
import { showCsvKeepFormatConfirm } from './csv-confirm'
import type {
  DesktopApi,
  DocTheme,
  LocalImageResult,
  MenuAction,
  RecoveryPromptPayload,
  WorkbookFile,
  WorkbookFindCellsResult,
  WorkbookFormulaCellsResult,
  WorkbookMediaResult,
  WorkbookRangeResult,
  WorkbookRecalcResult,
  WorkbookRowOutlineResult,
  WorkbookSaveResult,
} from '../shared/desktop-api'

/** No-op for stub channels */
async function noop(): Promise<void> {}

/**
 * Go services return `(T, error)`, so a binding can resolve to `null` where the
 * shared `DesktopApi` type promises a value (the Electron main process threw
 * instead). Call sites already treat failures as rejections, so surfacing the
 * empty result as an error keeps both sides honest - and the result is cast to
 * the renderer shape, see {@link fromWire}.
 */
function bridged<T>(pending: PromiseLike<unknown>, what: string): Promise<T> {
  return Promise.resolve(pending).then((value) => {
    if (value === null || value === undefined) {
      throw new Error(`${what}: the workbook service returned no result`)
    }
    return value as T
  })
}

/**
 * Generated models describe the wire shape as Go encodes it, while the shared
 * types describe the shape the renderer consumes: identical apart from nil
 * pointers, which Go encodes as `null` and the renderer types mark optional.
 * This file is the only seam between the two, so the reconciliation lives here
 * instead of leaking `null` handling (or `any`) through the renderer.
 */
function fromWire<T>(wire: unknown): T {
  return wire as T
}

/**
 * Drop keys whose value is `undefined`: generated models declare `key?: T`, and
 * `exactOptionalPropertyTypes` rejects an explicitly `undefined` property there.
 * The return type is inferred from the binding parameter the result is passed to.
 */
function compact<T>(value: object): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** Languages the sheet UI ships; the generated binding widens them to `string`. */
const LANGS = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'th', 'id', 'ru', 'ar'] as const

function isLanguage(value: unknown): value is (typeof LANGS)[number] {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

function isDocTheme(value: unknown): value is DocTheme {
  return value === 'follow' || value === 'light' || value === 'dark'
}

const MENU_ACTIONS: readonly string[] = [
  'open',
  'save',
  'save-as',
  'export-pdf',
  'export-csv',
  'undo',
  'redo',
]

function isMenuAction(value: unknown): value is MenuAction {
  return typeof value === 'string' && MENU_ACTIONS.includes(value)
}

function isRecoveryPrompt(value: unknown): value is RecoveryPromptPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'title' in value &&
    'body' in value &&
    'restoreLabel' in value &&
    'discardLabel' in value &&
    'fileName' in value &&
    'savedAtMs' in value
  )
}

/** The Go shell hands back raw base64, so the media type comes from the extension. */
function imageMediaTypeOf(path: string): LocalImageResult['mediaType'] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

/**
 * Build the DesktopApi proxy. Call once from main.tsx after installBridge().
 * Every method routes through generated bindings or events.
 */
export function createDesktopApi(): DesktopApi {
  // Created eagerly so the headless-ready handshake is emitted as soon as the
  // renderer runtime starts, before React mounts and the workbook is opened.
  const headless = headlessExportChannel('sheets')
  return {
    // --- App settings ---
    getLanguage() {
      return HomeLanguage().then((v) => (isLanguage(v) ? v : 'zh'))
    },
    onLanguageChanged(handler) {
      return on('app:language-changed', (data) => {
        if (isLanguage(data)) handler(data)
      })
    },
    getTheme() {
      return HomeTheme().then((v) => (v === 'light' || v === 'dark' || v === 'system' ? v : 'system'))
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (data === 'light' || data === 'dark' || data === 'system') handler(data)
      })
    },
    getDocumentTheme() {
      return HomeDocumentTheme().then((t) => (isDocTheme(t) ? t : 'follow')).catch(() => 'follow')
    },
    onDocumentThemeChanged(handler) {
      return on('app:document-theme-changed', (data) => {
        if (isDocTheme(data)) handler(data)
      })
    },
    getAutoSaveDefault() {
      return HomeAutoSaveDefault().then((v) => {
        // Go now returns {on, updatedAt} struct; handle legacy string/bool fallback
        if (typeof v === 'object' && v !== null && 'on' in v) {
          return { on: Boolean((v as any).on), updatedAt: Number((v as any).updatedAt || 0) }
        }
        return { on: v === 'always' || v === true, updatedAt: 0 }
      }).catch(() => ({ on: true, updatedAt: 0 }))
    },
    onAutoSaveDefaultChanged(handler) {
      return on('app:auto-save-default-changed', (data) => {
        // Go now emits {on, updatedAt} struct
        if (typeof data === 'object' && data !== null && 'on' in data) {
          handler({ on: Boolean((data as any).on), updatedAt: Number((data as any).updatedAt || 0) })
        } else {
          handler({ on: data === 'always' || data === true, updatedAt: Date.now() })
        }
      })
    },
    onChromePressed(handler) {
      return on('app:chrome-pressed', () => handler())
    },

    // --- Workbook open ---
    selectWorkbook() {
      // Absent numeric cells arrive as `null` from Go; the shared type marks them optional.
      return wb.SelectWorkbook().then((file) => (file === null ? null : fromWire<WorkbookFile>(file)))
    },
    openWorkbookWithPassword(path, password) {
      return wb.OpenFileWithPassword(path, password).then((file) =>
        file === null ? null : fromWire<WorkbookFile>(file),
      )
    },
    selectWorkbooksForMerge() {
      return Promise.resolve(null) // merge workbooks are not supported by the Go engine
    },
    openWorkbooksForMerge() {
      return Promise.resolve(null) // merge workbooks are not supported by the Go engine
    },
    reopenWorkbook(path) {
      return wb.ReopenWorkbook(path).then((file) => (file === null ? null : fromWire<WorkbookFile>(file)))
    },
    onSidecarCrashed(callback) {
      return on('workbook:sidecar-crashed', () => callback())
    },

    // --- Data reads ---
    readWorkbookRange(request) {
      return bridged<WorkbookRangeResult>(wb.ReadRange(request), 'readWorkbookRange')
    },
    readWorkbookFormulas(request) {
      return bridged<WorkbookFormulaCellsResult>(wb.ReadFormulas(request), 'readWorkbookFormulas')
    },
    findWorkbookCells(request) {
      return bridged<WorkbookFindCellsResult>(wb.FindCells(compact(request)), 'findWorkbookCells')
    },
    readWorkbookRowOutline(request) {
      return bridged<WorkbookRowOutlineResult>(wb.ReadRowOutline(request), 'readWorkbookRowOutline')
    },
    recalcWorkbook(request) {
      return bridged<WorkbookRecalcResult>(wb.Recalc(request), 'recalcWorkbook')
    },
    readWorkbookMedia(request) {
      return bridged<WorkbookMediaResult>(wb.ReadMedia(request), 'readWorkbookMedia')
    },
    readPivotDefinition(request) {
      return wb.ReadPivotDefinition(request)
    },
    readLocalImage(request) {
      // The Go shell returns raw base64 without a media type; derive it from the path.
      return ReadLocalImage(request.path).then((base64) => ({
        mediaType: imageMediaTypeOf(request.path),
        base64,
      }))
    },

    // --- Screenshots ---
    captureScreenSources() {
      // No capture pipeline on the Wails shell: report the permission state the
      // picker shows guidance for instead of an empty grid.
      return Promise.resolve({ status: 'denied' as const, sources: [] })
    },
    captureScreenSource(request) {
      return Promise.resolve(null) // stub: Windows-specific
    },

    // --- Save ---
    saveWorkbookEdits(request) {
      return bridged<WorkbookSaveResult>(wb.SaveWorkbook(compact(request)), 'saveWorkbookEdits')
    },
    beginSaveEditsTransfer() {
      return noop() // stub: Phase 5
    },
    sendSaveEditsChunk() {
      return noop() // stub: Phase 5
    },
    abortSaveEditsTransfer() {
      return noop() // stub: Phase 5
    },
    writeWorkbookRecovery() {
      return Promise.resolve({ ok: false }) // stub: Phase 5
    },
    autoRenameWorkbook() {
      return Promise.resolve({ renamed: false }) // stub: Phase 5
    },

    // --- Export ---
    exportPdf(request) {
      // Headless export: the CLI already owns the output path, so bypass the
      // save dialog (WorkbookService.ExportPdf always opens one).
      const outPath = request.outPath
      if (outPath) {
        return exp
          .ExportPdf(request.html, outPath, request.fileName, 0, 0)
          .then((result) => {
            if (!result.ok) throw new Error(result.error || 'export pdf failed')
            return { canceled: false as const, path: result.path || outPath }
          })
      }
      // The Go side lays the page out itself, so only the HTML and a file name cross.
      return wb.ExportPdf(request.fileName, request.html).then((result) =>
        result.canceled ? { canceled: true as const } : { canceled: false as const, path: result.path ?? '' },
      )
    },
    exportCsv(request) {
      // The Go exporter writes the bytes and returns the path it used; there is no
      // save-dialog branch, so an empty path is the cancelled case.
      const target = request.targetPath ?? request.fileName
      return wb.ExportCsv(target, request.content).then((path) =>
        path ? { canceled: false as const, path } : { canceled: true as const },
      )
    },
    confirmCsvSave() {
      return showCsvKeepFormatConfirm()
    },

    // --- AI create_document ---
    createDocument(request) {
      return wb.CreateDocument(compact(request))
    },

    // --- Session ---
    closeWorkbook(sessionId) {
      return wb.Close(sessionId).catch(() => {})
    },

    // --- Shell ---
    openExternal(url) {
      return OpenExternal(url).catch(() => {})
    },

    // --- Menu ---
    onMenuAction(callback) {
      return on('menu:action', (data) => {
        if (isMenuAction(data)) callback(data)
      })
    },
    onWorkbookRenamed(callback) {
      return on('workbook:renamed', (data) => {
        if (typeof data === 'string') callback(data)
      })
    },
    notifyPendingEdits() {
      return // no-op in Wails
    },
    onCloseSaveRequest(callback) {
      return on('workbook:close-save-request', () => callback())
    },
    reportCloseSaveResult() {
      return noop() // stub: Phase 5
    },

    // --- Recovery ---
    onRecoveryPrompt(callback) {
      return on('workbook:recovery-prompt', (data) => {
        if (isRecoveryPrompt(data)) callback(data)
      })
    },
    replyRecoveryPrompt() {
      return noop() // stub: Phase 5
    },

    // --- New blank / queued ---
    async consumeNewBlankWorkbook() {
      return false // stub
    },
    async hasQueuedWorkbook() {
      // The shell attaches the opened file to the tab (HomeService.OpenPath);
      // a tab that carries a path IS the queued workbook.
      return (await currentTabPath()) !== null
    },
    async openQueuedWorkbook() {
      // Open the tab's path directly, skipping the native picker that
      // selectWorkbook shows; docs/slides resolve their tab path the same way.
      const path = await currentTabPath()
      if (!path) return null
      return wb.OpenFile(path).then((file) => (file === null ? null : fromWire<WorkbookFile>(file)))
    },

    // --- Headless export ---
    async consumeHeadlessExport() {
      return (await headless.consume())?.outPath ?? null
    },
    headlessExportDone(result) {
      headless.done(result)
    },

    // --- User ---
    getUserDisplayName() {
      return wb.DisplayName()
    },

    // --- Electron-only: stub ---
    getPathForFile(_file: File): string {
      throw new Error('getPathForFile is not supported in this environment')
    },
  }
}