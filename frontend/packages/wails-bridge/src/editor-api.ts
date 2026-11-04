import { on } from './transport'
import { shellOpenExternal as _shellOpenExternal, shellReadLocalImage as _shellReadLocalImage } from './shell-bridge'
import {
  GetLanguage as _GetLanguage,
  GetTheme as _GetTheme,
  GetDocumentTheme as _GetDocumentTheme,
  GetAutoSaveDefault as _GetAutoSaveDefault,
  Recents as _Recents,
  OpenPath as _OpenPath,
  NewDocument as _NewDocument,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'
import {
  List as _ListTabs,
  Activate as _ActivateTab,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/tabservice'
import * as docs from './docs-bridge'
import * as md from './markdown-bridge'
import * as exportBridge from './export-bridge'
import { currentTabPath, setCurrentTabDirty } from './tabs-bridge'
import { headlessExportChannel, type HeadlessExportRequest } from './headless-export-bridge'
import { toBase64, normalizeDocxSave, type BinaryPayload } from './binary'

// Shared helper: reuse across all editors without repeating inline .then chains
async function editorGetLanguage(): Promise<'zh' | 'en'> {
  const v = await _GetLanguage()
  return v === 'zh' || v === 'en' ? v : 'zh'
}

async function editorGetTheme(): Promise<'light' | 'dark' | 'system'> {
  const v = await _GetTheme()
  return (['light', 'dark', 'system'].includes(v) ? v : 'system') as 'light' | 'dark' | 'system'
}

async function editorGetDocumentTheme(): Promise<string> {
  const v = await _GetDocumentTheme()
  return typeof v === 'string' ? v : 'follow'
}

// ─── Docs editor (window.desktop) ───────────────────────────────────
/** One open document tab, as the docs window menu lists it. */
export interface DocsTabInfo {
  id: string
  title: string
  focused: boolean
}

export interface DesktopApi {
  // Existing methods
  open(path: string): Promise<unknown>
  save(path: string, content: string): Promise<void>
  saveAs(path: string, content: string): Promise<unknown>
  pickImage(): Promise<{ base64: string; mime: string; name: string } | null>
  saveImageAs(src: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  getLanguage(): Promise<'zh' | 'en'>
  getTheme(): Promise<'light' | 'dark' | 'system'>
  getDocumentTheme(): Promise<string>
  onThemeChanged(handler: (theme: 'light' | 'dark' | 'system') => void): () => void
  onDocumentThemeChanged?: (handler: (theme: string) => void) => () => void
  convertAltChunkHtml?(html: string): Promise<string>

  // Docx-specific file I/O
  openDocx(): Promise<unknown>
  openDocxPath(path: string): Promise<unknown>
  openDocxDecrypt(path: string, password: string): Promise<unknown>
  // Binary arguments are base64-encoded on the way to Go (see binary.ts): the
  // docs editor hands over an ArrayBuffer, the bindings are JSON.
  saveDocx(path: string, content: BinaryPayload, auto: boolean): Promise<unknown>
  saveDocxAs(suggestedName: string, content: BinaryPayload, srcPath: string): Promise<unknown>
  saveDocxNew(suggestedName: string, content: BinaryPayload): Promise<unknown>
  saveDocxTo(path: string, content: BinaryPayload, overwrite: boolean): Promise<unknown>
  writeRecoveryCopy(path: string, content: BinaryPayload): Promise<void>
  getSystemLocale(): Promise<string>
  consumePendingOpenDocx(): Promise<unknown>

  // Electron shell surface the docs renderer still calls at boot
  /** paths of the recent documents (start screen "recent" list) */
  getRecentFiles(): Promise<string[]>
  /** language switched from the shell home page */
  onLanguageChanged(handler: (lang: 'zh' | 'en') => void): () => void
  /** open documents across every window, for the window menu */
  listDocsTabs(): Promise<DocsTabInfo[]>
  focusDocsTab(id: string): Promise<void>
  /** open another document in a new tab; no path opens a blank document */
  openNewTab(path?: string | null): Promise<void>
  /** system print dialog for the current document */
  print(scale?: number): Promise<{ ok: boolean; error?: string }>
  consumeHeadlessExport(): Promise<HeadlessExportRequest | null>
  headlessExportDone(result: { ok: boolean; error?: string }): void

  // Spell checking (not hosted yet: the renderer degrades to no suggestions)
  copyImageToClipboard?(dataUrl: string, metaJson?: string): Promise<boolean>
  spellLanguages?(): Promise<string[]>
  spellSetLanguages?(langs: string[]): Promise<void>
  spellAddWord?(word: string): Promise<void>
  spellIgnoreWord?(word: string): Promise<void>
  spellReplace?(word: string, replacement: string): Promise<void>

  // Event handlers (frontend stubs)
  onOpenDocx?(handler: (result: unknown) => void): () => void
  onRenamedDocx?(handler: (path: string) => void): () => void
  onCloseCheck?(handler: () => void): () => void
  onCloseSaveRequest?(handler: () => void): () => void
  reportCloseCheck?(result: unknown): void
  reportCloseSaveResult?(ok: boolean): void
  onMenuCommand?(handler: (cmd: string) => void): () => void
  onTeardown?(handler: () => void): () => void
  onContextMenuRequest?(handler: (req: unknown) => void): () => void
  onViewImage?(handler: (src: string) => void): () => void
  armContextMenu?(): void
  claimContextMenu?(seq: number): void
  spellDiag?(line: string): void
  reportViewMenuState?(state: unknown): void
}

export function createDesktopApi(): DesktopApi {
  // Eager channel creation emits `docs:headless-ready` as soon as the runtime
  // starts, before React mounts — the CLI waits for this before sending the job.
  const headless = headlessExportChannel('docs')
  return {
    // Existing methods
    open: (path) => docs.docsOpenPath(path),
    save: (path, content) => docs.docsSave(path, content),
    saveAs: (path, content) => docs.docsSaveAs(path, content),
    pickImage: () => docs.docsPickImage(),
    saveImageAs: (src) => docs.docsSaveImageAs(src),
    getLanguage: () => editorGetLanguage(),
    getTheme: () => editorGetTheme(),
    getDocumentTheme: () => editorGetDocumentTheme(),
    onThemeChanged: (handler) =>
      on('app:theme-changed', (data) => {
        if (data === 'light' || data === 'dark' || data === 'system') handler(data)
      }),
    onDocumentThemeChanged: (handler) =>
      on('app:document-theme-changed', (data) => {
        if (typeof data === 'string') handler(data)
      }),

    // Docx-specific file I/O
    openDocx: () => docs.docsOpenDocx(),
    openDocxPath: (path) => docs.docsOpenDocxPath(path),
    openDocxDecrypt: (path, pwd) => docs.docsOpenDocxDecrypt(path, pwd),
    saveDocx: async (path, content, auto) =>
      normalizeDocxSave(await docs.docsSaveDocx(path, toBase64(content), auto)),
    saveDocxAs: async (name, content, src) =>
      normalizeDocxSave(await docs.docsSaveDocxAs(name, toBase64(content), src)),
    saveDocxNew: async (name, content) =>
      normalizeDocxSave(await docs.docsSaveDocxNew(name, toBase64(content))),
    saveDocxTo: async (path, content, overwrite) =>
      normalizeDocxSave(await docs.docsSaveDocxTo(path, toBase64(content), overwrite)),
    writeRecoveryCopy: (path, content) => docs.docsWriteRecoveryCopy(path, toBase64(content)),
    getSystemLocale: () => docs.docsGetSystemLocale(),
    consumePendingOpenDocx: () => docs.docsConsumePendingOpenDocx(),

    // Electron shell surface the docs renderer calls while booting. Without
    // these the renderer throws out of its first effects and React unmounts the
    // whole tree, leaving the tab blank (the "New Docs does nothing" symptom).
    getRecentFiles: async () => {
      const page = await _Recents({ cursor: '', limit: 50 })
      const entries = Array.isArray(page?.entries) ? (page.entries as { path?: unknown }[]) : []
      return entries
        .map((entry) => entry.path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
    },
    onLanguageChanged: (handler) =>
      on('app:language-changed', (data) => {
        if (data === 'zh' || data === 'en') handler(data)
      }),
    listDocsTabs: async () => {
      const tabs = await _ListTabs()
      if (!Array.isArray(tabs)) return []
      const typed = tabs as unknown as { id: string; kind: string; title: string; active?: boolean }[]
      return typed
        .filter((tab) => tab.kind === 'docs')
        .map((tab) => ({ id: tab.id, title: tab.title, focused: !!tab.active }))
    },
    focusDocsTab: async (id) => {
      if (typeof id === 'string' && id) await _ActivateTab(id)
    },
    openNewTab: async (path) => {
      if (typeof path === 'string' && path) await _OpenPath(path)
      else await _NewDocument()
    },
    // No host print pipeline yet: report a clean failure instead of throwing so
    // the print dialog can show its message.
    print: async () => ({ ok: false, error: 'Printing is not available in this build.' }),
    consumeHeadlessExport: () => headless.consume(),
    headlessExportDone: (result) => headless.done(result),
    copyImageToClipboard: async () => false,
    spellLanguages: async () => [],
    spellSetLanguages: async () => undefined,
    spellAddWord: async () => undefined,
    spellIgnoreWord: async () => undefined,
    spellReplace: async () => undefined,

    // Event handler stubs (no-ops)
    onOpenDocx: () => () => undefined,
    onRenamedDocx: () => () => undefined,
    onCloseCheck: () => () => undefined,
    onCloseSaveRequest: () => () => undefined,
    reportCloseCheck: () => undefined,
    reportCloseSaveResult: () => undefined,
    onMenuCommand: () => () => undefined,
    onTeardown: () => () => undefined,
    onContextMenuRequest: () => () => undefined,
    onViewImage: () => () => undefined,
    armContextMenu: () => undefined,
    claimContextMenu: () => undefined,
    spellDiag: () => undefined,
    reportViewMenuState: () => undefined,
  }
}

// ─── Sheets editor (window.desktopApi) ───────────────────────────────
// The sheets renderer installs its own DesktopApi from ./renderer/desktop-api-bridge
// (frontend/apps/sheets/src/renderer/main.tsx), so no shim is needed here.
// ─── Markdown editor (window.markdownApi) ────────────────────────────
interface ImageExportTarget {
  dir: string
  name: string
}

/** Decodes the opaque image-export target handed back to the renderer. */
function parseImageTarget(value: unknown): ImageExportTarget | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as Partial<ImageExportTarget>
    return typeof parsed.dir === 'string' && typeof parsed.name === 'string'
      ? { dir: parsed.dir, name: parsed.name }
      : null
  } catch {
    return null
  }
}

/** `<dir>/<base>-01.png` for page `index`, matching Docs' image export naming. */
function imagePagePath(target: ImageExportTarget, index: number): string {
  const base = target.name.replace(/\.(md|markdown|txt|json)$/i, '') || 'document'
  const sep = target.dir.includes('\\') ? '\\' : '/'
  const prefix = target.dir.endsWith(sep) ? target.dir : target.dir + sep
  return `${prefix}${base}-${String(index).padStart(2, '0')}.png`
}

export interface MarkdownApi {
  consumePending(): Promise<string | null>
  consumeHeadlessExport(): Promise<string | null>
  headlessExportDone(result: { ok: boolean; error?: string }): void
  readFile(path: string): Promise<string>
  save(request: {
    text: string
    imageSources?: string[]
    mode: 'save' | 'saveAs'
    suggestedName?: string
  }): Promise<unknown>
  setDirty(isDirty: boolean): void
  onSaveRequest(handler: (mode: 'save' | 'saveAs') => void): () => void
  sendSaveRequestAck(ok: boolean): void
  onReadTextRequest(handler: () => void): () => void
  sendReadTextResult(result: { text: string } | { error: string }): void
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  onFileRenamed(handler: (newPath: string) => void): () => void
  pickImage(): Promise<string | null>
  saveImage(data: { base64: string; ext: string }): Promise<string | null>
  readImage(src: string): Promise<{ base64: string; mime: string } | null>
  saveImageAs(src: string): Promise<{ ok: boolean; path?: string; error?: string }>
  onViewImage(handler: (src: string) => void): () => void
  onExportRequest(handler: (format: 'pdf' | 'docx' | 'docs' | 'png') => void): () => void
  onPrintRequest(handler: () => void): () => void
  exportDocx(request: { base64: string; suggestedName: string; mode: 'dialog' | 'openInDocs' }): Promise<unknown>
  exportPdf(request: {
    html: string
    suggestedName: string
    outPath?: string
  }): Promise<unknown>
  prepareImageExport(request: {
    html: string
    suggestedName: string
  }): Promise<unknown>
  writeExportImage(id: string, page: number, pngBase64: string): Promise<unknown>
  finishImageExport(id: string, ok: boolean): Promise<unknown>
  getLanguage(): Promise<'zh' | 'en'>
  onLanguageChanged(handler: (lang: 'zh' | 'en') => void): () => void
  getTheme(): Promise<'light' | 'dark' | 'system'>
  getDocumentTheme(): Promise<string>
  onThemeChanged(handler: (theme: 'light' | 'dark' | 'system') => void): () => void
  onDocumentThemeChanged(handler: (theme: string) => void): () => void
  getAutoSaveDefault(): Promise<{ on: boolean; updatedAt: number }>
  onAutoSaveDefaultChanged(handler: (value: { on: boolean; updatedAt: number }) => void): () => void
  onChromePressed(handler: () => void): () => void
}

/** Image MIME for a file path, used when handing an image back to the editor. */
function imageMimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'image/png'
  }
}

/** Resolves a document-relative image reference against the document directory. */
function resolveDocRelative(docPath: string | null, src: string): string | null {
  if (!src || /^(data:|https?:|md-asset:)/i.test(src)) return null
  if (!docPath) return null
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('/')) return src
  const sep = docPath.includes('\\') ? '\\' : '/'
  const dir = docPath.slice(0, docPath.lastIndexOf(sep) + 1)
  return dir + src.split('/').join(sep)
}

export function createMarkdownApi(): MarkdownApi {
  const headless = headlessExportChannel('markdown')
  /** Wraps a shell→renderer event with a payload filter. */
  const subscribe = <T>(event: string, handler: (value: T) => void, accept: (v: unknown) => boolean) =>
    on(event, (data) => {
      if (accept(data)) handler(data as T)
    })

  return {
    // Each tab stores its path in the tab host, so the renderer never owns it.
    consumePending: () => currentTabPath(),
    consumeHeadlessExport: async () => (await headless.consume())?.outPath ?? null,
    headlessExportDone: (result) => headless.done(result),
    readFile: (path) => md.mdReadFile(path),
    save: async (request) => {
      const docPath = request.mode === 'saveAs' ? '' : ((await currentTabPath()) ?? '')
      const result = await md.mdSaveDocument(
        request.text,
        docPath,
        request.suggestedName ?? 'document',
        request.mode === 'saveAs',
      )
      if (!result.ok) return { ok: false, error: result.error ?? 'Save failed' }
      if (result.canceled) return { ok: true, canceled: true }
      return { ok: true, path: result.path ?? '' }
    },
    setDirty: (isDirty) => setCurrentTabDirty(!!isDirty),
    onSaveRequest: (handler) =>
      subscribe<'save' | 'saveAs'>('markdown:save-request', handler, (v) => v === 'save' || v === 'saveAs'),
    sendSaveRequestAck: () => undefined,
    onReadTextRequest: (handler) => on('markdown:read-text-request', () => handler()),
    sendReadTextResult: () => undefined,
    onCloseSaveRequest: (handler) => on('markdown:close-save-request', () => handler()),
    sendCloseSaveResult: () => undefined,
    onFileRenamed: (handler) =>
      subscribe<string>('markdown:file-renamed', handler, (v) => typeof v === 'string'),
    pickImage: async () => {
      const picked = await md.mdPickImage()
      if (!picked) return null
      const docPath = await currentTabPath()
      if (!docPath) return null
      const base64 = await md.mdReadImage(picked)
      const ext = picked.slice(picked.lastIndexOf('.') + 1)
      const rel = await md.mdSaveImageBeside(docPath, base64, ext)
      return rel || null
    },
    saveImage: async (data) => {
      const docPath = await currentTabPath()
      if (!docPath) return null
      const rel = await md.mdSaveImageBeside(docPath, data.base64, data.ext)
      return rel || null
    },
    readImage: async (src) => {
      const absolute = resolveDocRelative(await currentTabPath(), src)
      if (!absolute) return null
      try {
        const base64 = await md.mdReadImage(absolute)
        return { base64, mime: imageMimeForPath(absolute) }
      } catch {
        return null
      }
    },
    saveImageAs: async (src) => {
      // A relative `![](assets/x.png)` is relative to the note, not to the
      // process working directory; a data: URL carries its own bytes.
      if (/^(data:|https?:)/i.test(src)) return md.mdSaveImageAs(src)
      const absolute = resolveDocRelative(await currentTabPath(), src)
      return md.mdSaveImageAs(absolute ?? src)
    },
    onViewImage: (handler) =>
      subscribe<string>('yiioffice:view-image', handler, (v) => typeof v === 'string'),
    onExportRequest: (handler) =>
      subscribe<'pdf' | 'docx' | 'docs' | 'png'>('markdown:export-request', handler, (v) =>
        ['pdf', 'docx', 'docs', 'png'].includes(String(v)),
      ),
    onPrintRequest: (handler) => on('markdown:print-request', () => handler()),
    exportDocx: (request) =>
      md.mdExportDocx(request.base64, request.suggestedName, request.mode),
    exportPdf: (request) => md.mdExportPdf(request.html, request.suggestedName, request.outPath ?? ''),
    prepareImageExport: async (request) => {
      const folder = await exportBridge.pickExportFolder('Export as Images')
      if (!folder) return { ok: false, canceled: true }
      // The target is opaque to the renderer: keep the folder and base name in it
      // so the per-page writes and the final result agree without more state.
      const target = JSON.stringify({ dir: folder.dir, name: request.suggestedName })
      try {
        const pdfBase64 = await exportBridge.renderPdfBase64(request.html, 0, 0)
        return { ok: true, id: target, pdfBase64 }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    writeExportImage: async (target, index, pngBase64) => {
      const parsed = parseImageTarget(target)
      if (!parsed || typeof index !== 'number') return { ok: false, error: 'Invalid image export target.' }
      const result = await exportBridge.writeBase64File(imagePagePath(parsed, index), pngBase64)
      return { ok: result.ok, error: result.error }
    },
    finishImageExport: async (target, ok) => ({
      ok,
      path: parseImageTarget(target)?.dir ?? '',
    }),
    getLanguage: () => editorGetLanguage(),
    onLanguageChanged: (handler) =>
      subscribe<'zh' | 'en'>('app:language-changed', handler, (v) => v === 'zh' || v === 'en'),
    getTheme: () => editorGetTheme(),
    getDocumentTheme: () => editorGetDocumentTheme(),
    onThemeChanged: (handler) =>
      subscribe<'light' | 'dark' | 'system'>('app:theme-changed', handler, (v) =>
        ['light', 'dark', 'system'].includes(String(v)),
      ),
    onDocumentThemeChanged: (handler) =>
      subscribe<string>('app:document-theme-changed', handler, (v) => typeof v === 'string'),
    getAutoSaveDefault: async () => {
      const v = await _GetAutoSaveDefault()
      // Go now returns {on, updatedAt} struct; handle legacy bool fallback
      if (typeof v === 'object' && v !== null && 'on' in v) {
        return { on: Boolean((v as any).on), updatedAt: Number((v as any).updatedAt || 0) }
      }
      return { on: Boolean(v), updatedAt: 0 }
    },
    onAutoSaveDefaultChanged: (handler) =>
      on('app:auto-save-default-changed', (data) => {
        // Go now emits {on, updatedAt} struct
        if (typeof data === 'object' && data !== null && 'on' in data) {
          handler({ on: Boolean((data as any).on), updatedAt: Number((data as any).updatedAt || 0) })
        } else if (typeof data === 'boolean') {
          handler({ on: data, updatedAt: Date.now() })
        }
      }),
    onChromePressed: () => () => undefined,
  }
}

// ─── Shell helpers ───────────────────────────────────────────────────
export function shellReadLocalImage(path: string) {
  return _shellReadLocalImage(path)
}

export function shellOpenExternal(url: string) {
  return _shellOpenExternal(url)
}