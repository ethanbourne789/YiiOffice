import { installBridge, on, setCurrentTabDirty, currentTabPath } from '@yiioffice/wails-bridge'
installBridge()

import * as pdf from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/pdfservice'
import {
  GetLanguage as HomeLanguage,
  GetTheme as HomeTheme,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'

import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@yiioffice/i18n'
import { App } from './App'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { PdfApi, UiTheme } from '../shared/ipc'
import '@yiioffice/ui/tokens.css'
import '@yiioffice/ui/screentip.css'
import '@yiioffice/ui/color-picker.css'
import '@yiioffice/ui/dropdown.css'
import '@yiioffice/ui/ribbon-collapse.css'
import '@yiioffice/ui/markdown.css'
import './styles.css'
import { installScreenTips } from '@yiioffice/ui'

// PDF.js worker: emitted by Vite as a hashed asset next to the bundle, so the
// URL honours the renderer's relative base ('./'). The old hard-coded
// '/pdf.worker.min.mjs' resolved against the origin root, which the asset
// handler maps to the shell bundle — every document failed with
// "Setting up fake worker failed / 404".
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
GlobalWorkerOptions.workerSrc = pdfWorkerUrl

installScreenTips()

/** No-op for channels that only mirror renderer state. */
async function noop(): Promise<void> {}

/** Rejection used for capabilities pdfcpu does not provide. No stub is kept:
 *  callers surface the reason instead of silently doing nothing. */
function unsupported(capability: string): Promise<never> {
  return Promise.reject(new Error(`${capability} is not supported by this build.`))
}

/** Convert 0-based page indices from the editor into 1-based page numbers. */
function toPageNumbers(indices: number[]): number[] {
  return (indices ?? []).map((index) => index + 1)
}

/** Create a wails-bridge-based PdfApi that uses generated bindings + events */
function createPdfApi(): PdfApi {
  return {
    // The shell opens a file by creating a tab for it (HomeService.OpenPath →
    // TabService/tabs:changed), so the renderer's "pending" file *is* its own
    // tab's path. Returning a hard-coded null here left every opened PDF stuck
    // on "没有要打开的文件" even though the tab and iframe existed.
    consumePending: async () => currentTabPath(),
    readFile: async (path: string) => {
      const b64 = await pdf.ReadFile(path)
      const bin = atob(b64)
      const buf = new ArrayBuffer(bin.length)
      const view = new Uint8Array(buf)
      for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
      return buf
    },
    // Markups, text edits and form fills need a native PDF content engine that
    // pdfcpu does not provide; refuse instead of writing an empty document.
    save: async () => ({ ok: false, error: 'Saving markup and text edits is not supported by this build.' }),
    requestRedactionCopy: async () => false,
    autoRename: async () => ({ renamed: false }),
    isUntitled: async () => false,
    validateTextEdits: async () => [],
    listEditFonts: async () => [],
    canDrawText: async () => false,
    listPageImages: async (path: string) => pdf.ListPageImages(path, 0),
    listStaticFormFills: async () => [],
    // pdfcpu builds ship no system-OCR engine; the flag lets the renderer skip
    // the whole pass instead of rendering a page just to throw it away.
    supportsOcr: false,
    ocrPage: async () => null,
    pageImagePng: async () => null,
    pagePreviewPng: async () => null,
    extractPages: async (req) => {
      const result = await pdf.ExtractPagesToFile(req.path, toPageNumbers(req.pages), req.suggestedName)
      if (!result.ok) return { ok: false, error: result.error ?? 'Extract failed' }
      return { ok: true, savedPath: result.path ?? '' }
    },
    insertPdf: async (req) => {
      const result = await pdf.InsertPdfFromDialog(req.path, req.afterPageIndex)
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Insert failed' }
      return { ok: true, insertedCount: result.pages ?? 0 }
    },
    insertBlankPage: async (req) => {
      const result = await pdf.InsertBlankPageAfter(req.path, req.afterPageIndex)
      if (!result.ok) return { ok: false, error: result.error ?? 'Insert failed' }
      return { ok: true }
    },
    splitPdf: async (req) => {
      const result = await pdf.SplitPdfToFolder(req.path, req.chunkSize)
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Split failed' }
      return { ok: true, savedDir: result.savedDir ?? '', count: result.count ?? 0 }
    },
    mergePdf: async (req) => {
      const result = await pdf.MergePdfFromDialog(req.path, req.suggestedName)
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Merge failed' }
      return { ok: true, savedPath: result.path ?? '', appendedCount: result.pages ?? 0 }
    },
    mergePages: async (req) => {
      const result = await pdf.MergePagesToFile(
        req.path,
        [],
        req.perSheet,
        req.direction,
        req.separator,
        req.suggestedName,
      )
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Merge pages failed' }
      return { ok: true, savedPath: result.path ?? '' }
    },
    replacePages: async (req) => {
      const result = await pdf.ReplacePagesFromDialog(req.path, toPageNumbers(req.pages))
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Replace failed' }
      return { ok: true, removed: result.count ?? 0, inserted: result.pages ?? 0 }
    },
    setPageSize: async (req) => {
      await pdf.SetPageSize(req.path, req.width, req.height, [])
      return { ok: true }
    },
    splitPages: async (req) => {
      const grid = req.perPage === 2 ? [2, 1] : req.perPage === 4 ? [2, 2] : [3, 3]
      const result = await pdf.SplitPagesToFile(req.path, [], grid[0], grid[1], req.suggestedName)
      if (!result.ok) return { ok: false, error: result.error ?? 'Split pages failed' }
      return { ok: true, savedPath: result.path ?? '' }
    },
    cropPages: async (req) => {
      const rect: [number, number, number, number] = [req.rect.l, req.rect.t, req.rect.r, req.rect.b]
      const result = await pdf.CropPagesFractional(req.path, toPageNumbers(req.pages), rect[0], rect[1], rect[2], rect[3])
      if (!result.ok) return { ok: false, error: result.error ?? 'Crop failed' }
      return { ok: true }
    },
    exportImages: async (req) => {
      const result = await pdf.ExportPageImages(req.images, req.pageNumbers, req.baseName)
      if (result.canceled) return { ok: true, canceled: true }
      if (!result.ok) return { ok: false, error: result.error ?? 'Export failed' }
      return { ok: true, savedDir: result.savedDir ?? '', count: result.count ?? 0 }
    },
    convertOffice: () => unsupported('Office conversion'),
    createDocument: () => unsupported('Document creation'),
    listSavedSignatures: async () => [],
    addSavedSignature: async () => [],
    removeSavedSignature: async () => [],
    getUsername: async () => '',
    setDirty: (dirty) => setCurrentTabDirty(!!dirty),
    onCloseSaveRequest: (handler) => on('pdf:close-save-request', () => handler()),
    sendCloseSaveResult: noop,
    onSaveAsRequest: (handler) =>
      on('pdf:save-as-request', (data) => handler(typeof data === 'string' ? data : '')),
    sendSaveAsResult: noop,
    onSaveAsFlow: (handler) =>
      on('pdf:save-as-flow', (data) => handler(data === true)),
    onPrintRequest: (handler) => on('pdf:print-request', () => handler()),
    onFileRenamed: (handler) =>
      on('pdf:file-renamed', (data) => handler(typeof data === 'string' ? data : '')),
    getLanguage: () => HomeLanguage().then((v) => (v === 'zh' || v === 'en' ? v : 'zh') as Lang),
    onLanguageChanged: (handler) =>
      on('app:language-changed', (data) => {
        if (data === 'zh' || data === 'en') handler(data as Lang)
      }),
    getTheme: () => HomeTheme().then((v) => (v === 'light' || v === 'dark' || v === 'system' ? v : 'system') as UiTheme),
    onThemeChanged: (handler) =>
      on('app:theme-changed', (data) => {
        if (data === 'light' || data === 'dark' || data === 'system') handler(data as UiTheme)
      }),
    onChromePressed: () => () => {},
  }
}

// Install pdfApi on window for use by App and all components
declare global {
  interface Window {
    pdfApi: PdfApi
  }
}
window.pdfApi = createPdfApi()

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  try {
    ;[lang, theme] = await Promise.all([
      window.pdfApi.getLanguage().catch(() => 'zh' as const),
      window.pdfApi.getTheme().catch(() => 'system' as const),
    ])
  } catch {
    /* dev renderer without the bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
}

void bootstrap()