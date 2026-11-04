import { on } from './transport'
import { headlessExportChannel } from './headless-export-bridge'
import type { AppTheme } from './types'
import {
  OpenPath,
  FilesRead,
  FilesReadImage,
  FilesAdd,
  PickFiles,
  Opened,
  Save,
  SaveAs,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice'
import { PickSaveFile } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/exportservice'
import { currentTabPath } from './tabs-bridge'
import { exportPdfFile, pickExportFolder, pickSavePath, writeBase64File } from './export-bridge'
import {
  buildSlidesExportHtml,
  slidePageSizeInches,
  type SlidesExportHtmlOp,
  type SlidesExportImagesOp,
} from './slides-export-html'

/**
 * Edit handlers published by the renderer at boot (apps/slides/src/renderer/edit-handlers.ts
 * calls registerEditHandlers). pptx-engine runs in the renderer too, so an edit is a local
 * function call - the bridge is only the name -> handler dispatcher that the UI reaches
 * through `window.desktop`.
 *
 * Handler shapes are intentionally loose here: they live with the renderer in
 * apps/slides/src/shared/ipc.ts (SlidesApi), which is the type the app is checked against.
 */
type EditHandler = (...args: any[]) => Promise<any>

const editHandlers: Record<string, EditHandler> = {}

export function registerEditHandlers(handlers: Record<string, EditHandler>): void {
  Object.assign(editHandlers, handlers)
}

function callEdit(name: string, ...args: any[]): Promise<any> {
  const handler = editHandlers[name]
  if (handler) return handler(...args)
  // Renderer not registered yet (boot order, headless): resolve so callers never hang.
  return Promise.resolve(undefined)
}

/**
 * The shell's auto-save default toggle, structurally identical to the renderer's
 * AutoSaveDefault (apps/slides/src/shared/ipc.ts). Declared here so the bridge
 * package does not have to import from an app.
 */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

export interface SlidesDesktopApi {
  // File I/O
  openPptx(fitWidthPx: number): Promise<{ path: string; base64: string } | null>
  openPptxPath(path: string): Promise<{ path: string; base64: string } | null>
  // The renderer (file-actions.ts) serializes the deck and passes { path, base64 }
  // here; the bridge writes through Go SlidesService.Save/SaveAs (atomic).
  // saveAs always resolves the target via the native save dialog.
  save(req?: { path?: string; base64?: string }): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
  saveAs(req?: { path?: string; base64?: string }): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
  savePicture(...args: any[]): Promise<any>
  filesRead(path: string): Promise<string>
  filesReadImage(path: string): Promise<string>
  filesAdd(path: string): Promise<any>
  pickFiles(kind: string): Promise<string[]>

  // Pending open
  consumePendingOpen(): Promise<{ path: string; base64: string } | null>
  newBlank(fitWidthPx: number): Promise<{ base64: string } | null>

  // Export
  exportImages(op: SlidesExportImagesOp): Promise<{ ok: boolean; paths?: string[]; error?: string }>
  exportPdf(op: SlidesExportHtmlOp & { filePath: string }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  pickExportDir(): Promise<string | null>
  pickExportPdfPath(name: string): Promise<string | null>

  // Font
  fontDownload(...args: any[]): Promise<any>
  privateFontData(...args: any[]): Promise<any>
  privateFontFaces(...args: any[]): Promise<any>

  // Notes / Comments
  getNotes(...args: any[]): Promise<any>
  setNotes(...args: any[]): Promise<any>
  getComments(...args: any[]): Promise<any>
  addComment(...args: any[]): Promise<any>
  deleteComment(...args: any[]): Promise<any>

  // Metadata
  isDirty(): Promise<boolean>
  applyTheme(...args: any[]): Promise<any>
  setSlideSize(...args: any[]): Promise<any>
  getLayouts(...args: any[]): Promise<any>
  getHeaderFooter(...args: any[]): Promise<any>
  applyHeaderFooter(...args: any[]): Promise<any>
  getSections(...args: any[]): Promise<any>
  setSections(...args: any[]): Promise<any>
  addSection(...args: any[]): Promise<any>
  removeSection(...args: any[]): Promise<any>
  renameSection(...args: any[]): Promise<any>
  moveSection(...args: any[]): Promise<any>

  // Edit operations (frontend stubs — delegate to pptx-engine which runs in the same iframe)
  editText(...args: any[]): Promise<any>
  editTransform(...args: any[]): Promise<any>
  editTransformMulti(...args: any[]): Promise<any>
  batchEditTransform(...args: any[]): Promise<any>
  editFill(...args: any[]): Promise<any>
  editStroke(...args: any[]): Promise<any>
  editImageFill(...args: any[]): Promise<any>
  editConnectorEndpoints(...args: any[]): Promise<any>
  deleteElement(...args: any[]): Promise<any>
  deleteElements(...args: any[]): Promise<any>
  addElement(...args: any[]): Promise<any>
  duplicateElements(...args: any[]): Promise<any>
  groupElements(...args: any[]): Promise<any>
  ungroupElement(...args: any[]): Promise<any>
  reorderElement(...args: any[]): Promise<any>
  flipElements(...args: any[]): Promise<any>
  copyElements(...args: any[]): Promise<any>
  pasteElements(...args: any[]): Promise<any>
  clipboardExternal(...args: any[]): Promise<any>
  clipboardProbe(...args: any[]): Promise<any>
  nativeClipboard(...args: any[]): Promise<any>
  insertImage(...args: any[]): Promise<any>
  insertMedia(...args: any[]): Promise<any>
  addImageBytes(...args: any[]): Promise<any>
  addMediaBytes(...args: any[]): Promise<any>
  getMediaData(...args: any[]): Promise<any>
  addTable(...args: any[]): Promise<any>
  editTableCell(...args: any[]): Promise<any>
  tableMerge(...args: any[]): Promise<any>
  tableStructure(...args: any[]): Promise<any>
  setTableColWidth(...args: any[]): Promise<any>
  setTableRowHeight(...args: any[]): Promise<any>
  setTableStyle(...args: any[]): Promise<any>
  addChart(...args: any[]): Promise<any>
  editChart(...args: any[]): Promise<any>
  getChartData(...args: any[]): Promise<any>
  getChartColorSchemes(...args: any[]): Promise<any>
  addSmartArt(...args: any[]): Promise<any>
  addInk(...args: any[]): Promise<any>
  insertModel(...args: any[]): Promise<any>
  replacePictureBytes(...args: any[]): Promise<any>
  pickPictureFile(): Promise<{ base64: string; ext: string } | null>
  setLink(...args: any[]): Promise<any>
  getLink(...args: any[]): Promise<any>
  getSlideLinks(...args: any[]): Promise<any>
  getRunLinks(...args: any[]): Promise<any>
  setPictureSrcRect(...args: any[]): Promise<any>
  editBackground(...args: any[]): Promise<any>
  setShapeGeometry(...args: any[]): Promise<any>
  setShapeAdjust(...args: any[]): Promise<any>
  changeShape(...args: any[]): Promise<any>
  setEffects(...args: any[]): Promise<any>
  setAdvanceTimes(...args: any[]): Promise<any>
  setAnimations(...args: any[]): Promise<any>
  getAnimations(...args: any[]): Promise<any>
  setTransition(...args: any[]): Promise<any>
  getTransition(...args: any[]): Promise<any>
  addBlankSlide(...args: any[]): Promise<any>
  addSlideWithLayout(...args: any[]): Promise<any>
  deleteSlides(...args: any[]): Promise<any>
  duplicateSlides(...args: any[]): Promise<any>
  moveSlide(...args: any[]): Promise<any>
  moveSlides(...args: any[]): Promise<any>
  copySlides(...args: any[]): Promise<any>
  pasteSlide(...args: any[]): Promise<any>
  repasteSlide(...args: any[]): Promise<any>
  hasSlideClipboard(...args: any[]): Promise<any>
  setSlideLayout(...args: any[]): Promise<any>
  setHidden(...args: any[]): Promise<any>
  undo(...args: any[]): Promise<any>
  redo(...args: any[]): Promise<any>
  beginHistoryBatch(...args: any[]): Promise<any>
  endHistoryBatch(...args: any[]): Promise<any>
  applyTxn(...args: any[]): Promise<any>

  // Master slide editing
  masterEnter(...args: any[]): Promise<any>
  masterOpen(...args: any[]): Promise<any>
  masterClose(...args: any[]): Promise<any>
  masterEditText(...args: any[]): Promise<any>
  masterEditTransform(...args: any[]): Promise<any>
  masterEditFill(...args: any[]): Promise<any>
  masterEditStroke(...args: any[]): Promise<any>
  masterDeleteElement(...args: any[]): Promise<any>

  // Events. The payload shapes belong to the renderer (ipc.ts: MenuCommand,
  // ShowSyncState, ShowInkEvent, deck state); the bridge only knows the channels, so
  // the signatures stay loose wherever the payload is renderer-owned.
  onThemeChanged(handler: (theme: AppTheme) => void): () => void
  onDeckChanged(...args: any[]): any
  onOpened(...args: any[]): any
  onRenamed(...args: any[]): any
  onHistoryChanged(...args: any[]): any
  onMenuCommand(...args: any[]): any
  onCloseSaveRequest(...args: any[]): any
  reportCloseSaveResult(ok: boolean): void
  onFontsChanged(...args: any[]): any
  headlessExportDone(result: { ok: boolean; error?: string }): void
  consumeHeadlessExport(): Promise<string | null>
  setAutoSavePref(on: boolean): void
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  onShowSync?(...args: any[]): any
  onShowInk?(...args: any[]): any

  // Reused from HomeBridge
  getLanguage(): Promise<'zh' | 'en'>
  getTheme(): Promise<'light' | 'dark' | 'system'>
  getRecentFiles(): Promise<any[]>
  getDocumentTheme?(): Promise<string>
  onDocumentThemeChanged?(handler: (theme: string) => void): () => void

  // Picture / text / table aliases (reached directly from the UI)
  editPictureSrcRect(...args: any[]): Promise<any>
  editPictureOpacity(...args: any[]): Promise<any>
  editTableStyle(...args: any[]): Promise<any>
  setTextAnchor(...args: any[]): Promise<any>
  setTextBodyProps(...args: any[]): Promise<any>
  removeSectionSlides(...args: any[]): Promise<any>
}

export function createSlidesDesktopApi(): SlidesDesktopApi {
  // Eager: emits `slides:headless-ready` at runtime start so the CLI knows the
  // consume listener is installed before it sends the export job.
  const headless = headlessExportChannel('slides')
  return {
    // File I/O - Go backend via the Wails bindings
    async openPptx(_fitWidthPx) {
      const path = await currentTabPath()
      if (!path) return null
      try {
        const base64 = await OpenPath(path)
        return { path, base64 }
      } catch {
        return null
      }
    },
    async openPptxPath(path) {
      if (!path) return null
      try {
        const base64 = await OpenPath(path)
        Opened(path).catch(() => undefined)
        return { path, base64 }
      } catch {
        return null
      }
    },
    // The renderer (file-actions.ts) serializes the deck and hands the bytes here;
    // the Go SlidesService writes them atomically (temp file + rename).
    async save(req?: { path?: string; base64?: string }) {
      if (!req?.path || typeof req.base64 !== 'string') {
        return { ok: false, error: 'save requires { path, base64 }' }
      }
      try {
        await Save(req.path, req.base64)
        return { ok: true, path: req.path }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    // Save As always asks the shell for a target via the native dialog; a bare
    // name from an untitled deck must never resolve against the process CWD.
    async saveAs(req?: { path?: string; base64?: string }) {
      if (typeof req?.base64 !== 'string') {
        return { ok: false, error: 'saveAs requires { base64 }' }
      }
      const name = (req.path?.split(/[\\/]/).pop()) || 'presentation.pptx'
      let target = ''
      try {
        target = (await PickSaveFile(name, 'pptx')) || ''
      } catch {
        return { ok: false, error: 'Save As dialog is unavailable' }
      }
      if (!target) return { ok: false, canceled: true }
      try {
        const savedPath = await SaveAs(target, req.base64)
        return { ok: true, path: savedPath || target }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    async savePicture() {
      return { ok: false, error: 'Save as picture is not wired to the Wails shell yet' }
    },
    async filesRead(path) {
      return FilesRead(path)
    },
    async filesReadImage(path) {
      return FilesReadImage(path)
    },
    async filesAdd(path) {
      return FilesAdd(path)
    },
    async pickFiles(kind) {
      const files = await PickFiles(kind)
      return Array.isArray(files) ? files : []
    },
    // Pickers: the Go side owns the dialog, the renderer owns decoding.
    async pickPictureFile() {
      const picked = await PickFiles('image')
      const path = picked?.[0]
      if (!path) return null
      const base64 = await FilesReadImage(path)
      return { base64, ext: path.slice(path.lastIndexOf('.') + 1).toLowerCase() }
    },

    // Pending open
    async consumePendingOpen() {
      const path = await currentTabPath()
      if (!path) return null
      try {
        const base64 = await OpenPath(path)
        return { path, base64 }
      } catch {
        return null
      }
    },
    async newBlank(_fitWidthPx) {
      return null // Renderer creates blank deck internally
    },

    // Export. The renderer renders the slides (PNG pages / vector SVG pages); this
    // bridge hands the bytes to Go ExportService: WriteBase64File for images, and
    // a print-HTML document fed to headless Edge --print-to-pdf for PDFs. A dialog
    // cancel resolves null; every other failure surfaces as { ok:false, error } (or
    // a rejection from the pickers, which the renderer's try/catch turns into a
    // visible status) — never a fake success.
    async exportImages(op) {
      try {
        const dir = String(op?.dir ?? '').replace(/[\\/]+$/, '')
        const baseName = String(op?.baseName ?? '').trim() || 'presentation'
        const pngs = Array.isArray(op?.pngsBase64) ? op.pngsBase64 : []
        if (!dir || pngs.length === 0) {
          return { ok: false, error: 'image export requires { dir, pngsBase64 }' }
        }
        const paths: string[] = []
        for (const [i, png] of pngs.entries()) {
          const path = `${dir}/${baseName}-${String(i + 1).padStart(2, '0')}.png`
          const r = await writeBase64File(path, png)
          if (!r.ok) return { ok: false, error: r.error ?? `write ${path} failed` }
          paths.push(r.path ?? path)
        }
        return { ok: true, paths }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    async exportPdf(op) {
      try {
        if (!op?.filePath) return { ok: false, error: 'PDF export requires a target path' }
        if (!op.pages?.length) return { ok: false, error: 'PDF export requires at least one page' }
        const html = buildSlidesExportHtml(op)
        const { widthIn, heightIn } = slidePageSizeInches(op.widthPx, op.heightPx)
        const name = op.filePath.split(/[\\/]/).pop() || 'presentation.pdf'
        const r = await exportPdfFile(html, op.filePath, name, widthIn, heightIn)
        return {
          ok: r.ok,
          ...(r.path !== undefined && { path: r.path }),
          ...(r.canceled !== undefined && { canceled: r.canceled }),
          ...(r.error !== undefined && { error: r.error }),
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    async pickExportDir() {
      // Cancel (empty dir) -> null; a dialog error rejects so the caller's
      // try/catch can show it instead of silently treating it as a cancel.
      const folder = await pickExportFolder('Export as Images')
      return folder?.dir ?? null
    },
    async pickExportPdfPath(name) {
      return pickSavePath(name, 'pdf')
    },

    // Session state. The deck lives in the renderer, so the dirty answer comes
    // from the handler it registers (edit-handlers.ts: pptx-engine element
    // flags). An unregistered renderer reports clean — never fabricate dirty
    // from the mere existence of a file path.
    async isDirty() {
      return !!(await callEdit('isDirty'))
    },
    reportCloseSaveResult: () => undefined,
    headlessExportDone: (result) => headless.done(result),
    async consumeHeadlessExport() {
      return (await headless.consume())?.outPath ?? null
    },
    setAutoSavePref: () => undefined,
    async getAutoSaveDefault() {
      try {
        const { GetAutoSaveDefault } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const v = await GetAutoSaveDefault()
        return { on: Boolean(v.on), updatedAt: Number(v.updatedAt || 0) }
      } catch {
        // Binding unavailable (browser preview): keep the shell's shipped default.
        return { on: true, updatedAt: 0 }
      }
    },

    // Edit handlers - dispatched to the renderer registry
    addBlankSlide: (...args) => callEdit('addBlankSlide', ...args),
    addChart: (...args) => callEdit('addChart', ...args),
    addComment: (...args) => callEdit('addComment', ...args),
    addElement: (...args) => callEdit('addElement', ...args),
    addImageBytes: (...args) => callEdit('addImageBytes', ...args),
    addInk: (...args) => callEdit('addInk', ...args),
    addMediaBytes: (...args) => callEdit('addMediaBytes', ...args),
    addSection: (...args) => callEdit('addSection', ...args),
    addSlideWithLayout: (...args) => callEdit('addSlideWithLayout', ...args),
    addSmartArt: (...args) => callEdit('addSmartArt', ...args),
    addTable: (...args) => callEdit('addTable', ...args),
    applyHeaderFooter: (...args) => callEdit('applyHeaderFooter', ...args),
    applyTheme: (...args) => callEdit('applyTheme', ...args),
    applyTxn: (...args) => callEdit('applyTxn', ...args),
    batchEditTransform: (...args) => callEdit('batchEditTransform', ...args),
    beginHistoryBatch: (...args) => callEdit('beginHistoryBatch', ...args),
    changeShape: (...args) => callEdit('changeShape', ...args),
    clipboardExternal: (...args) => callEdit('clipboardExternal', ...args),
    clipboardProbe: (...args) => callEdit('clipboardProbe', ...args),
    copyElements: (...args) => callEdit('copyElements', ...args),
    copySlides: (...args) => callEdit('copySlides', ...args),
    deleteComment: (...args) => callEdit('deleteComment', ...args),
    deleteElement: (...args) => callEdit('deleteElement', ...args),
    deleteElements: (...args) => callEdit('deleteElements', ...args),
    deleteSlides: (...args) => callEdit('deleteSlides', ...args),
    duplicateElements: (...args) => callEdit('duplicateElements', ...args),
    duplicateSlides: (...args) => callEdit('duplicateSlides', ...args),
    editBackground: (...args) => callEdit('editBackground', ...args),
    editChart: (...args) => callEdit('editChart', ...args),
    editConnectorEndpoints: (...args) => callEdit('editConnectorEndpoints', ...args),
    editFill: (...args) => callEdit('editFill', ...args),
    editImageFill: (...args) => callEdit('editImageFill', ...args),
    editPictureOpacity: (...args) => callEdit('editPictureOpacity', ...args),
    editPictureSrcRect: (...args) => callEdit('editPictureSrcRect', ...args),
    editStroke: (...args) => callEdit('editStroke', ...args),
    editTableCell: (...args) => callEdit('editTableCell', ...args),
    editTableStyle: (...args) => callEdit('editTableStyle', ...args),
    editText: (...args) => callEdit('editText', ...args),
    editTransform: (...args) => callEdit('editTransform', ...args),
    editTransformMulti: (...args) => callEdit('editTransformMulti', ...args),
    endHistoryBatch: (...args) => callEdit('endHistoryBatch', ...args),
    flipElements: (...args) => callEdit('flipElements', ...args),
    fontDownload: (...args) => callEdit('fontDownload', ...args),
    getAnimations: (...args) => callEdit('getAnimations', ...args),
    getChartColorSchemes: (...args) => callEdit('getChartColorSchemes', ...args),
    getChartData: (...args) => callEdit('getChartData', ...args),
    getComments: (...args) => callEdit('getComments', ...args),
    getHeaderFooter: (...args) => callEdit('getHeaderFooter', ...args),
    getLayouts: (...args) => callEdit('getLayouts', ...args),
    getLink: (...args) => callEdit('getLink', ...args),
    getMediaData: (...args) => callEdit('getMediaData', ...args),
    getNotes: (...args) => callEdit('getNotes', ...args),
    getRunLinks: (...args) => callEdit('getRunLinks', ...args),
    getSections: (...args) => callEdit('getSections', ...args),
    getSlideLinks: (...args) => callEdit('getSlideLinks', ...args),
    getTransition: (...args) => callEdit('getTransition', ...args),
    groupElements: (...args) => callEdit('groupElements', ...args),
    hasSlideClipboard: (...args) => callEdit('hasSlideClipboard', ...args),
    insertImage: (...args) => callEdit('insertImage', ...args),
    insertMedia: (...args) => callEdit('insertMedia', ...args),
    insertModel: (...args) => callEdit('insertModel', ...args),
    masterClose: (...args) => callEdit('masterClose', ...args),
    masterDeleteElement: (...args) => callEdit('masterDeleteElement', ...args),
    masterEditFill: (...args) => callEdit('masterEditFill', ...args),
    masterEditStroke: (...args) => callEdit('masterEditStroke', ...args),
    masterEditText: (...args) => callEdit('masterEditText', ...args),
    masterEditTransform: (...args) => callEdit('masterEditTransform', ...args),
    masterEnter: (...args) => callEdit('masterEnter', ...args),
    masterOpen: (...args) => callEdit('masterOpen', ...args),
    moveSection: (...args) => callEdit('moveSection', ...args),
    moveSlide: (...args) => callEdit('moveSlide', ...args),
    moveSlides: (...args) => callEdit('moveSlides', ...args),
    nativeClipboard: (...args) => callEdit('nativeClipboard', ...args),
    pasteElements: (...args) => callEdit('pasteElements', ...args),
    pasteSlide: (...args) => callEdit('pasteSlide', ...args),
    privateFontData: (...args) => callEdit('privateFontData', ...args),
    privateFontFaces: (...args) => callEdit('privateFontFaces', ...args),
    redo: (...args) => callEdit('redo', ...args),
    removeSection: (...args) => callEdit('removeSection', ...args),
    removeSectionSlides: (...args) => callEdit('removeSectionSlides', ...args),
    renameSection: (...args) => callEdit('renameSection', ...args),
    reorderElement: (...args) => callEdit('reorderElement', ...args),
    repasteSlide: (...args) => callEdit('repasteSlide', ...args),
    replacePictureBytes: (...args) => callEdit('replacePictureBytes', ...args),
    setAdvanceTimes: (...args) => callEdit('setAdvanceTimes', ...args),
    setAnimations: (...args) => callEdit('setAnimations', ...args),
    setEffects: (...args) => callEdit('setEffects', ...args),
    setHidden: (...args) => callEdit('setHidden', ...args),
    setLink: (...args) => callEdit('setLink', ...args),
    setNotes: (...args) => callEdit('setNotes', ...args),
    setPictureSrcRect: (...args) => callEdit('setPictureSrcRect', ...args),
    setSections: (...args) => callEdit('setSections', ...args),
    setShapeAdjust: (...args) => callEdit('setShapeAdjust', ...args),
    setShapeGeometry: (...args) => callEdit('setShapeGeometry', ...args),
    setSlideLayout: (...args) => callEdit('setSlideLayout', ...args),
    setSlideSize: (...args) => callEdit('setSlideSize', ...args),
    setTableColWidth: (...args) => callEdit('setTableColWidth', ...args),
    setTableRowHeight: (...args) => callEdit('setTableRowHeight', ...args),
    setTableStyle: (...args) => callEdit('setTableStyle', ...args),
    setTextAnchor: (...args) => callEdit('setTextAnchor', ...args),
    setTextBodyProps: (...args) => callEdit('setTextBodyProps', ...args),
    setTransition: (...args) => callEdit('setTransition', ...args),
    tableMerge: (...args) => callEdit('tableMerge', ...args),
    tableStructure: (...args) => callEdit('tableStructure', ...args),
    undo: (...args) => callEdit('undo', ...args),
    ungroupElement: (...args) => callEdit('ungroupElement', ...args),
    // Events
    onThemeChanged: (handler) =>
      on('app:theme-changed', (data) => {
        if (data === 'light' || data === 'dark' || data === 'system') handler(data)
      }),
    onDeckChanged: () => () => undefined,
    onOpened: () => () => undefined,
    onRenamed: () => () => undefined,
    onHistoryChanged: () => () => undefined,
    onMenuCommand: () => () => undefined,
    onCloseSaveRequest: () => () => undefined,
    onFontsChanged: () => () => undefined,
    onShowSync: () => () => undefined,
    onShowInk: () => () => undefined,

    // Reused from HomeBridge
    async getLanguage() {
      try {
        const { GetLanguage } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const v = await GetLanguage()
        return v === 'zh' || v === 'en' ? v : 'zh'
      } catch {
        return 'zh'
      }
    },
    async getTheme() {
      try {
        const { GetTheme } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const v = await GetTheme()
        return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
      } catch {
        return 'system'
      }
    },
    async getRecentFiles() {
      try {
        const { Recents } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const page = await Recents({ cursor: '', limit: 50 })
        return Array.isArray(page?.entries) ? page.entries : []
      } catch {
        return []
      }
    },
    async getDocumentTheme() {
      return 'follow'
    },
    onDocumentThemeChanged: () => () => undefined,
  }
}
