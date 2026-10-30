// Thin wrapper over the official Wails V3 generated DocsService bindings.
import {
  OpenPath,
  Save,
  SaveAs,
  PickImage,
  SaveImageAs,
  PickFiles,
  ExportPdf,
  OpenDocx,
  OpenDocxPath,
  OpenDocxDecrypt,
  SaveDocx,
  SaveDocxAs,
  SaveDocxNew,
  SaveDocxTo,
  WriteRecoveryCopy,
  SetDocPassword,
  DocPasswordIntentRevision,
  DiscardDocPasswordIntents,
  ConfirmDocumentReplace,
  GetSystemLocale,
  ConsumePendingOpenDocx,
  ConsumeNewBlankDoc,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/docsservice'

/** Opens a docs file and returns its base64-encoded content. */
export function docsOpenPath(path: string): Promise<string> {
  return OpenPath(path)
}

/** Atomically saves base64 content to the given path. */
export function docsSave(path: string, content: string): Promise<void> {
  return Save(path, content)
}

/** Atomically saves base64 content to a new path and returns the path. */
export function docsSaveAs(path: string, content: string): Promise<string> {
  return SaveAs(path, content)
}

/** Opens the native image picker; null when the user cancels. */
export async function docsPickImage(): Promise<{ base64: string; mime: string; name: string } | null> {
  const picked = await PickImage()
  return picked ? (picked as { base64: string; mime: string; name: string }) : null
}

/** Writes an editor image (path or data URL) to a user-chosen file. */
export function docsSaveImageAs(
  src: string,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  return SaveImageAs(src)
}

/** Opens a multi-select media dialog; empty when canceled. */
export async function docsPickFiles(kind: string): Promise<string[]> {
  const files = await PickFiles(kind)
  return Array.isArray(files) ? files : []
}

/** Renders HTML to a PDF (empty outPath opens a save dialog). */
export function docsExportPdf(
  html: string,
  outPath: string,
  suggestedName: string,
  widthIn: number,
  heightIn: number,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  return ExportPdf(html, outPath, suggestedName, widthIn, heightIn)
}

// ─── Docs editor docx-specific file I/O ─────────────────────────────

export function docsOpenDocx(): Promise<any> {
  return OpenDocx()
}

export function docsOpenDocxPath(path: string): Promise<any> {
  return OpenDocxPath(path)
}

export function docsOpenDocxDecrypt(path: string, password: string): Promise<any> {
  return OpenDocxDecrypt(path, password)
}

export function docsSaveDocx(path: string, content: string, auto: boolean): Promise<any> {
  return SaveDocx(path, content, auto)
}

export function docsSaveDocxAs(suggestedName: string, content: string, srcPath: string): Promise<any> {
  return SaveDocxAs(suggestedName, content, srcPath)
}

export function docsSaveDocxNew(suggestedName: string, content: string): Promise<any> {
  return SaveDocxNew(suggestedName, content)
}

export function docsSaveDocxTo(path: string, content: string, overwrite: boolean): Promise<any> {
  return SaveDocxTo(path, content, overwrite)
}

export function docsWriteRecoveryCopy(path: string, content: string): Promise<void> {
  return WriteRecoveryCopy(path, content)
}

export function docsSetDocPassword(_path: string, _password: string): Promise<void> {
  return SetDocPassword(_path, _password)
}

export function docsDocPasswordIntentRevision(): Promise<number> {
  return DocPasswordIntentRevision()
}

export function docsDiscardDocPasswordIntents(rev: number): void {
  DiscardDocPasswordIntents(rev)
}

export function docsConfirmDocumentReplace(): Promise<boolean> {
  return ConfirmDocumentReplace()
}

export function docsGetSystemLocale(): Promise<string> {
  return GetSystemLocale()
}

export function docsConsumePendingOpenDocx(): Promise<any> {
  // HomeService.OpenPath puts the file in the tab (the renderer resolves it via
  // currentTabPath), so nothing is ever queued here. Go returns an empty
  // DocxOpenResult struct rather than null, and an empty object is truthy in
  // JS: the renderer would try to open a file with no path and show a
  // "zip: end of central directory not found" failure on every new document.
  return ConsumePendingOpenDocx().then((result) =>
    result && typeof result.path === 'string' && result.path ? result : null,
  )
}

export function docsConsumeNewBlankDoc(): Promise<boolean> {
  return ConsumeNewBlankDoc()
}