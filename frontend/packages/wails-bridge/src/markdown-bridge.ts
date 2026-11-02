// Thin wrapper over the official Wails V3 generated MarkdownService bindings.
import {
  ReadFile,
  ReadImage,
  PickImage,
  SaveImageAs,
  ExportDocx,
  ExportPdf,
  SaveDocument,
  SaveImageBeside,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/markdownservice'

export function mdReadFile(path: string): Promise<string> {
  return ReadFile(path)
}
export function mdReadImage(path: string): Promise<string> {
  return ReadImage(path)
}
export function mdPickImage(): Promise<string> {
  return PickImage()
}
export function mdSaveImageAs(src: string): Promise<any> {
  return SaveImageAs(src)
}
export function mdExportDocx(base64Data: string, suggestedName: string, mode: string): Promise<any> {
  return ExportDocx(base64Data, suggestedName, mode)
}
export function mdExportPdf(html: string, suggestedName: string, outPath: string): Promise<any> {
  return ExportPdf(html, suggestedName, outPath)
}
/** Writes markdown text; asks for a path when untitled or `saveAs` is set. */
export function mdSaveDocument(
  text: string,
  docPath: string,
  suggestedName: string,
  saveAs: boolean,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  return SaveDocument(text, docPath, suggestedName, saveAs)
}
/** Stores pasted/dropped image bytes in `assets/` next to the document. */
export function mdSaveImageBeside(
  docPath: string,
  base64Data: string,
  ext: string,
): Promise<string> {
  return SaveImageBeside(docPath, base64Data, ext)
}