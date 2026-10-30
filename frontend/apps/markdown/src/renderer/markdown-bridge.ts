/**
 * Wails bridge for the Markdown editor.
 *
 * Creates `window.markdownApi` compatible with the Electron preload API,
 * using generated Wails V3 bindings + events.
 */
import { on } from '@yiioffice/wails-bridge'
import * as md from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/markdownservice'
import {
  GetLanguage as HomeLanguage,
  GetTheme as HomeTheme,
  GetDocumentTheme as HomeDocumentTheme,
  GetAutoSaveDefault as HomeAutoSaveDefault,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'
import type {
  MarkdownApi,
  SaveMarkdownRequest,
  SaveMarkdownResult,
  SaveMode,
  ExportFormat,
  ExportDocxRequest,
  ExportPdfRequest,
  ImageExportPreparation,
  ExportResult,
  ImageData,
  DocTheme,
  UiTheme,
  AutoSaveDefault,
} from '../shared/ipc'
import type { Lang } from '@yiioffice/i18n'

/** No-op for stub channels (Go handler returns nil, nil) */
async function noop(): Promise<void> {}

export function installMarkdownBridge(): void {
  if ((window as any).markdownApi) return

  const api: MarkdownApi = {
    consumePending: async () => null, // stub: Phase 5

    consumeHeadlessExport: async () => null, // stub: Phase 5

    headlessExportDone: () => noop(), // stub: Phase 5

    readFile: async (path: string): Promise<string> => {
      return md.ReadFile(path)
    },

    save: async (request: SaveMarkdownRequest): Promise<SaveMarkdownResult> => {
      await md.Save(request.path, request.content)
      return { ok: true }
    },

    setDirty: () => noop(), // stub: frontend-only

    onSaveRequest: (handler: (mode: SaveMode) => void): () => void => {
      return on('markdown:save-request', (data: SaveMode) => handler(data))
    },

    sendSaveRequestAck: () => noop(), // stub: Phase 5

    onReadTextRequest: (handler: () => void): () => void => {
      return on('markdown:read-text-request', () => handler())
    },

    sendReadTextResult: () => noop(), // stub: Phase 5

    onCloseSaveRequest: (handler: () => void): () => void => {
      return on('markdown:close-save-request', () => handler())
    },

    sendCloseSaveResult: () => noop(), // stub: Phase 5

    onFileRenamed: (handler: (newPath: string) => void): () => void => {
      return on('markdown:file-renamed', (path: string) => handler(path))
    },

    pickImage: async (): Promise<string | null> => {
      return md.PickImage().catch(() => null)
    },

    saveImage: async (data: { base64: string; ext: string }): Promise<string | null> => {
      // stub: path not known from renderer side; Phase 5
      return null
    },

    readImage: async (src: string): Promise<ImageData | null> => {
      try {
        const b64 = await md.ReadImage(src)
        return { src, data: b64 }
      } catch {
        return null
      }
    },

    saveImageAs: async (src: string): Promise<{ ok: boolean; path?: string; error?: string }> => {
      try {
        return md.SaveImageAs(src)
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },

    onViewImage: (handler: (src: string) => void): () => void => {
      return on('yiioffice:view-image', (src: string) => handler(src))
    },

    onExportRequest: (handler: (format: ExportFormat) => void): () => void => {
      return on('markdown:export-request', (format: ExportFormat) => handler(format))
    },

    onPrintRequest: (handler: () => void): () => void => {
      return on('markdown:print-request', () => handler())
    },

    exportDocx: async (request: ExportDocxRequest): Promise<ExportResult> => {
      try {
        return md.ExportDocx(request.base64Data, request.suggestedName, request.mode)
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },

    exportPdf: async (request: ExportPdfRequest): Promise<ExportResult> => {
      try {
        return md.ExportPdf(request.html, request.suggestedName, request.outPath)
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },

    prepareImageExport: async () => ({ ok: false, error: 'not implemented' }), // stub: Phase 5

    writeExportImage: async () => ({ ok: false, error: 'not implemented' }), // stub: Phase 5

    finishImageExport: async () => ({ ok: false, error: 'not implemented' }), // stub: Phase 5

    getLanguage: async (): Promise<Lang> => {
      const r = await HomeLanguage()
      return (r === 'zh' || r === 'en' ? r : 'zh') as Lang
    },

    onLanguageChanged: (handler: (lang: Lang) => void): () => void => {
      return on('app:language-changed', (lang: Lang) => handler(lang))
    },

    getTheme: async (): Promise<UiTheme> => {
      const r = await HomeTheme()
      return (r === 'light' || r === 'dark' || r === 'system' ? r : 'system') as UiTheme
    },

    onThemeChanged: (handler: (theme: UiTheme) => void): () => void => {
      return on('app:theme-changed', (theme: UiTheme) => handler(theme))
    },

    getDocumentTheme: async (): Promise<DocTheme> => {
      const r = await HomeDocumentTheme()
      return (r === 'follow' || r === 'light' || r === 'dark' ? r : 'follow') as DocTheme
    },

    onDocumentThemeChanged: (handler: (theme: DocTheme) => void): () => void => {
      return on('app:document-theme-changed', (theme: DocTheme) => handler(theme))
    },

    getAutoSaveDefault: async (): Promise<AutoSaveDefault> => {
      try {
        return HomeAutoSaveDefault()
      } catch {
        return 'always'
      }
    },

    onAutoSaveDefaultChanged: (handler: (value: AutoSaveDefault) => void): () => void => {
      return on('app:auto-save-default-changed', (value: AutoSaveDefault) => handler(value))
    },

    onChromePressed: (handler: () => void): () => void => {
      // Wails does not have an equivalent; no-op
      return () => {}
    },
  }

  // Type assertion safe because we constructed every member above
  ;(window as any).markdownApi = api
}