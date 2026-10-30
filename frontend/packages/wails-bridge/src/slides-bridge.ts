import { on } from './transport'
import {
  OpenPath,
  Save,
  SaveAs,
  FilesRead,
  FilesReadImage,
  FilesAdd,
  PickFiles,
  Opened,
  Renamed,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice'
import { ExportPdf as SlidesExportPdf } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/exportservice'
import { currentTabPath } from './tabs-bridge'

export interface SlidesDesktopApi {
  // File I/O
  openPptx(fitWidthPx: number): Promise<{ path: string; base64: string } | null>
  openPptxPath(path: string): Promise<{ path: string; base64: string } | null>
  save(): Promise<void>
  saveAs(name: string): Promise<string | null>
  savePicture(data: { base64: string; ext: string }): Promise<string | null>
  filesRead(path: string): Promise<string>
  filesReadImage(path: string): Promise<string>
  filesAdd(path: string): Promise<any>
  pickFiles(kind: string): Promise<string[]>

  // Pending open
  consumePendingOpen(): Promise<{ path: string; base64: string } | null>
  newBlank(fitWidthPx: number): Promise<{ base64: string } | null>

  // Export
  exportImages(op: { dir: string; slides: number[] }): Promise<void>
  exportPdf(op: { name: string }): Promise<{ ok: boolean; path?: string }>
  pickExportDir(): Promise<string | null>
  pickExportPdfPath(name: string): Promise<string | null>

  // Font
  fontDownload(family: string): Promise<boolean>
  privateFontData(family: string): Promise<string | null>
  privateFontFaces(family: string): Promise<string[]>

  // Notes / Comments
  getNotes(idx: number): Promise<string>
  setNotes(op: { index: number; text: string }): Promise<void>
  getComments(idx: number): Promise<any[]>
  addComment(op: any): Promise<void>
  deleteComment(id: string): Promise<void>

  // Metadata
  isDirty(): Promise<boolean>
  applyTheme(op: any): Promise<void>
  setSlideSize(op: any): Promise<void>
  getLayouts(): Promise<any[]>
  getHeaderFooter(): Promise<any>
  applyHeaderFooter(op: any): Promise<void>
  getSections(): Promise<any[]>
  setSections(sections: any[]): Promise<void>
  addSection(op: any): Promise<void>
  removeSection(id: string): Promise<void>
  renameSection(id: string, name: string): Promise<void>
  moveSection(id: string, index: number): Promise<void>

  // Edit operations (frontend stubs — delegate to pptx-engine which runs in the same iframe)
  editText(op: any): Promise<void>
  editTransform(op: any): Promise<void>
  editTransformMulti(op: any[]): Promise<void>
  batchEditTransform(ops: any[]): Promise<void>
  editFill(op: any): Promise<void>
  editStroke(op: any): Promise<void>
  editImageFill(op: any): Promise<void>
  editConnectorEndpoints(op: any): Promise<void>
  deleteElement(id: string): Promise<void>
  deleteElements(ids: string[]): Promise<void>
  addElement(op: any): Promise<void>
  duplicateElements(ids: string[]): Promise<void>
  groupElements(ids: string[]): Promise<void>
  ungroupElement(id: string): Promise<void>
  reorderElement(id: string, index: number): Promise<void>
  flipElements(ids: string[], horizontal: boolean): Promise<void>
  copyElements(ids: string[]): Promise<void>
  pasteElements(data: any): Promise<void>
  clipboardExternal(data: any): Promise<void>
  clipboardProbe(): Promise<any>
  nativeClipboard(op: any): Promise<any>
  insertImage(op: any): Promise<void>
  insertMedia(op: any): Promise<void>
  addImageBytes(op: any): Promise<void>
  addMediaBytes(op: any): Promise<void>
  getMediaData(id: string): Promise<string>
  addTable(op: any): Promise<void>
  editTableCell(op: any): Promise<void>
  tableMerge(op: any): Promise<void>
  tableStructure(op: any): Promise<void>
  setTableColWidth(op: any): Promise<void>
  setTableRowHeight(op: any): Promise<void>
  setTableStyle(op: any): Promise<void>
  addChart(op: any): Promise<void>
  editChart(op: any): Promise<void>
  getChartData(id: string): Promise<any>
  getChartColorSchemes(): Promise<any[]>
  addSmartArt(op: any): Promise<void>
  addInk(op: any): Promise<void>
  insertModel(op: any): Promise<void>
  replacePictureBytes(op: any): Promise<void>
  pickPictureFile(): Promise<string | null>
  setLink(op: any): Promise<void>
  getLink(id: string): Promise<string>
  getSlideLinks(): Promise<any[]>
  getRunLinks(): Promise<any[]>
  setPictureSrcRect(op: any): Promise<void>
  editBackground(op: any): Promise<void>
  setShapeGeometry(op: any): Promise<void>
  setShapeAdjust(op: any): Promise<void>
  changeShape(op: any): Promise<void>
  setEffects(op: any): Promise<void>
  setAdvanceTimes(op: any): Promise<void>
  setAnimations(op: any): Promise<void>
  getAnimations(idx: number): Promise<any[]>
  setTransition(op: any): Promise<void>
  getTransition(idx: number): Promise<any>
  addBlankSlide(): Promise<void>
  addSlideWithLayout(op: any): Promise<void>
  deleteSlides(ids: string[]): Promise<void>
  duplicateSlides(ids: string[]): Promise<void>
  moveSlide(id: string, index: number): Promise<void>
  moveSlides(ids: string[], index: number): Promise<void>
  copySlides(ids: string[]): Promise<void>
  pasteSlide(): Promise<void>
  repasteSlide(): Promise<void>
  hasSlideClipboard(): Promise<boolean>
  setSlideLayout(op: any): Promise<void>
  setHidden(op: any): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  beginHistoryBatch(): Promise<void>
  endHistoryBatch(): Promise<void>
  applyTxn(op: any): Promise<void>

  // Master slide editing
  masterEnter(): Promise<void>
  masterOpen(): Promise<void>
  masterClose(): Promise<void>
  masterEditText(op: any): Promise<void>
  masterEditTransform(op: any): Promise<void>
  masterEditFill(op: any): Promise<void>
  masterEditStroke(op: any): Promise<void>
  masterDeleteElement(id: string): Promise<void>

  // Events (frontend stubs)
  onThemeChanged(handler: (theme: string) => void): () => void
  onDeckChanged(handler: () => void): () => void
  onOpened(handler: (path: string) => void): () => void
  onRenamed(handler: (path: string) => void): () => void
  onHistoryChanged(handler: () => void): () => void
  onMenuCommand(handler: (cmd: string) => void): () => void
  onCloseSaveRequest(handler: () => void): () => void
  reportCloseSaveResult(ok: boolean): void
  onFontsChanged(handler: () => void): () => void
  headlessExportDone(result: { ok: boolean; error?: string }): void
  consumeHeadlessExport(): Promise<string | null>
  setAutoSavePref(on: boolean): void
  getAutoSaveDefault(): Promise<boolean>
  onShowSync?(handler: () => void): () => void
  onShowInk?(handler: () => void): () => void

  // Reused from HomeBridge
  getLanguage(): Promise<'zh' | 'en'>
  getTheme(): Promise<'light' | 'dark' | 'system'>
  getRecentFiles(): Promise<any[]>
  getDocumentTheme?(): Promise<string>
  onDocumentThemeChanged?(handler: (theme: string) => void): () => void
}

function noopPromise<T = void>(): Promise<T> {
  return Promise.resolve(undefined as unknown as T)
}

export function createSlidesDesktopApi(): SlidesDesktopApi {
  return {
    // File I/O — calls Go backend via Wails bindings
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
    async save() {
      // The actual save is done by the renderer calling this with the deck content
    },
    async saveAs(_name) {
      return null
    },
    async savePicture(_data) {
      return null
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

    // Export
    async exportImages(_op) {},
    async exportPdf(op) {
      const result = await SlidesExportPdf('', '', op.name ?? 'presentation', 0, 0)
      return { ok: !!result, path: (result as any)?.path }
    },
    async pickExportDir() {
      return null
    },
    async pickExportPdfPath(_name) {
      return null
    },

    // Font
    async fontDownload(_family) { return false },
    async privateFontData(_family) { return null },
    async privateFontFaces(_family) { return [] },

    // Notes / Comments (frontend state)
    async getNotes(_idx) { return '' },
    async setNotes(_op) {},
    async getComments(_idx) { return [] },
    async addComment(_op) {},
    async deleteComment(_id) {},

    // Metadata (frontend state)
    async isDirty() {
      const tabs = await currentTabPath()
      return !!tabs
    },
    async applyTheme(_op) {},
    async setSlideSize(_op) {},
    async getLayouts() { return [] },
    async getHeaderFooter() { return {} },
    async applyHeaderFooter(_op) {},
    async getSections() { return [] },
    async setSections(_sections) {},
    async addSection(_op) {},
    async removeSection(_id) {},
    async renameSection(_id, _name) {},
    async moveSection(_id, _index) {},

    // Edit operations — ALL frontend stubs, no-op at bridge level
    editText: noopPromise, editTransform: noopPromise, editTransformMulti: noopPromise,
    batchEditTransform: noopPromise, editFill: noopPromise, editStroke: noopPromise,
    editImageFill: noopPromise, editConnectorEndpoints: noopPromise,
    deleteElement: noopPromise, deleteElements: noopPromise, addElement: noopPromise,
    duplicateElements: noopPromise, groupElements: noopPromise, ungroupElement: noopPromise,
    reorderElement: noopPromise, flipElements: noopPromise, copyElements: noopPromise,
    pasteElements: noopPromise, clipboardExternal: noopPromise, clipboardProbe: noopPromise,
    nativeClipboard: noopPromise, insertImage: noopPromise, insertMedia: noopPromise,
    addImageBytes: noopPromise, addMediaBytes: noopPromise, getMediaData: noopPromise,
    addTable: noopPromise, editTableCell: noopPromise, tableMerge: noopPromise,
    tableStructure: noopPromise, setTableColWidth: noopPromise, setTableRowHeight: noopPromise,
    setTableStyle: noopPromise, addChart: noopPromise, editChart: noopPromise,
    getChartData: noopPromise, getChartColorSchemes: noopPromise,
    addSmartArt: noopPromise, addInk: noopPromise, insertModel: noopPromise,
    replacePictureBytes: noopPromise, setLink: noopPromise, getLink: noopPromise,
    getSlideLinks: noopPromise, getRunLinks: noopPromise,
    setPictureSrcRect: noopPromise, editBackground: noopPromise,
    setShapeGeometry: noopPromise, setShapeAdjust: noopPromise,
    changeShape: noopPromise, setEffects: noopPromise,
    setAdvanceTimes: noopPromise, setAnimations: noopPromise,
    getAnimations: noopPromise, setTransition: noopPromise, getTransition: noopPromise,
    addBlankSlide: noopPromise, addSlideWithLayout: noopPromise,
    deleteSlides: noopPromise, duplicateSlides: noopPromise,
    moveSlide: noopPromise, moveSlides: noopPromise,
    copySlides: noopPromise, pasteSlide: noopPromise, repasteSlide: noopPromise,
    hasSlideClipboard: () => Promise.resolve(false),
    setSlideLayout: noopPromise, setHidden: noopPromise,
    undo: noopPromise, redo: noopPromise,
    beginHistoryBatch: noopPromise, endHistoryBatch: noopPromise,
    applyTxn: noopPromise,

    // Master slide
    masterEnter: noopPromise, masterOpen: noopPromise, masterClose: noopPromise,
    masterEditText: noopPromise, masterEditTransform: noopPromise,
    masterEditFill: noopPromise, masterEditStroke: noopPromise,
    masterDeleteElement: noopPromise,

    pickPictureFile: () => Promise.resolve(null),

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
    reportCloseSaveResult: () => undefined,
    onFontsChanged: () => () => undefined,
    headlessExportDone: () => undefined,
    async consumeHeadlessExport() { return null },
    setAutoSavePref: () => undefined,
    async getAutoSaveDefault() { return true },
    onShowSync: () => () => undefined,
    onShowInk: () => () => undefined,

    // Reused from HomeBridge
    async getLanguage() {
      try {
        const { GetLanguage } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const v = await GetLanguage()
        return v === 'zh' || v === 'en' ? v : 'zh'
      } catch { return 'zh' }
    },
    async getTheme() {
      try {
        const { GetTheme } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        const v = await GetTheme()
        return ['light', 'dark', 'system'].includes(v) ? v : 'system'
      } catch { return 'system' }
    },
    async getRecentFiles() {
      try {
        const { Recents } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice')
        return Recents(0, 50)
      } catch { return [] }
    },
    async getDocumentTheme() { return 'follow' },
    onDocumentThemeChanged: () => () => undefined,
  }
}
