/**
 * Electron-to-Wails bridge: provides a `window.desktopApi` object compatible
 * with the DesktopApi interface by routing all calls through generated Wails V3
 * bindings + events.
 *
 * Channel names match the Go bridge constants in internal/bridge/sheets.go.
 * Stub channels return no-op values so the renderer boots cleanly.
 */
import { on } from '@yiioffice/wails-bridge'
import * as wb from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/workbookservice'
import {
  GetLanguage as HomeLanguage,
  GetTheme as HomeTheme,
  GetDocumentTheme as HomeDocumentTheme,
  GetAutoSaveDefault as HomeAutoSaveDefault,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'
import { OpenExternal, ReadLocalImage } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/shellservice'
import type { DesktopApi } from '../shared/desktop-api'

/** No-op for stub channels */
async function noop(): Promise<void> {}

/**
 * Build the DesktopApi proxy. Call once from main.tsx after installBridge().
 * Every method routes through generated bindings or events.
 */
export function createDesktopApi(): DesktopApi {
  return {
    // --- App settings ---
    getLanguage() {
      return HomeLanguage().then((v) => (v === 'zh' || v === 'en' || v === 'ja' || v === 'ko' || v === 'fr' || v === 'de' || v === 'es' || v === 'th' || v === 'id' || v === 'ru' || v === 'ar' ? v : 'zh'))
    },
    onLanguageChanged(handler) {
      return on('app:language-changed', (data) => {
        if (typeof data === 'string') handler(data)
      })
    },
    getTheme() {
      return HomeTheme().then((v) => (v === 'light' || v === 'dark' || v === 'system' ? v : 'system'))
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (typeof data === 'string') handler(data)
      })
    },
    getDocumentTheme() {
      return HomeDocumentTheme().then((t) => (t || 'follow')).catch(() => 'follow')
    },
    onDocumentThemeChanged(handler) {
      return on('app:document-theme-changed', (data) => {
        if (typeof data === 'string') handler(data)
      })
    },
    getAutoSaveDefault() {
      return HomeAutoSaveDefault().then((v) => ({
        on: v === 'always',
        updatedAt: v === 'always' ? Date.now() : 0,
      })).catch(() => ({ on: true, updatedAt: 0 }))
    },
    onAutoSaveDefaultChanged(handler) {
      return on('app:auto-save-default-changed', (data) => {
        handler({ on: data === 'always', updatedAt: Date.now() })
      })
    },
    onChromePressed(handler) {
      return on('app:chrome-pressed', () => handler())
    },

    // --- Workbook open ---
    selectWorkbook() {
      return wb.SelectWorkbook()
    },
    selectWorkbooksForMerge() {
      return Promise.resolve(null) // merge workbooks are not supported by the Go engine
    },
    openWorkbooksForMerge() {
      return Promise.resolve(null) // merge workbooks are not supported by the Go engine
    },
    reopenWorkbook(path) {
      return wb.ReopenWorkbook(path)
    },
    onSidecarCrashed(callback) {
      return on('workbook:sidecar-crashed', () => callback())
    },

    // --- Data reads ---
    readWorkbookRange(request) {
      return wb.ReadRange(request)
    },
    readWorkbookFormulas(request) {
      return wb.ReadFormulas(request)
    },
    findWorkbookCells(request) {
      return wb.FindCells(request)
    },
    readWorkbookRowOutline(request) {
      return wb.ReadRowOutline(request)
    },
    recalcWorkbook(request) {
      return wb.Recalc(request)
    },
    readWorkbookMedia(request) {
      return wb.ReadMedia(request)
    },
    readPivotDefinition(request) {
      return wb.ReadPivotDefinition(request)
    },
    readLocalImage(request) {
      return ReadLocalImage(request)
    },

    // --- Screenshots ---
    captureScreenSources() {
      return Promise.resolve({ sources: [] }) // stub: Windows-specific
    },
    captureScreenSource(request) {
      return Promise.resolve(null) // stub: Windows-specific
    },

    // --- Save ---
    saveWorkbookEdits(request) {
      return wb.SaveWorkbook(request)
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
      return wb.ExportPdf(request.fileName, request.html)
    },
    printWorkbook() {
      // No host printing pipeline: surface it so the Print dialog shows the reason.
      return Promise.reject(new Error('Native printing is not supported; use Export PDF instead.'))
    },
    listPrinters() {
      return wb.ListPrinters()
    },
    exportCsv(request) {
      return wb.ExportCsv(request.path, request.content)
    },
    confirmCsvSave() {
      return Promise.resolve('cancel') // stub: needs dialog
    },

    // --- AI create_document ---
    createDocument(request) {
      return wb.CreateDocument(request)
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
        if (typeof data === 'string') callback(data)
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
        if (data && typeof data === 'object') callback(data)
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
      return false // stub
    },

    // --- Headless export ---
    async consumeHeadlessExport() {
      return null // stub
    },
    headlessExportDone() {
      return noop() // stub
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