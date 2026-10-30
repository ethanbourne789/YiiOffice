// Thin wrapper over the official Wails V3 generated ExportService bindings.
import {
  ExportPdf,
  ExportHtml,
  RenderPdfBase64,
  MergePdfParts,
  PickExportFolder,
  TakeTempPdf,
  WriteBase64File,
  PickSaveFile,
  ListPrinters,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/exportservice'

export interface ExportResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

export interface ExportFolder {
  dir: string
  pdfPath: string
}

export interface PrinterInfo {
  name: string
  displayName: string
}

/** Renders HTML to a PDF file (an empty outPath opens a save dialog). */
export function exportPdfFile(
  html: string,
  outPath: string,
  suggestedName: string,
  widthIn: number,
  heightIn: number,
): Promise<ExportResult> {
  return ExportPdf(html, outPath, suggestedName, widthIn, heightIn)
}

/** Writes a standalone HTML document to disk (an empty outPath opens a save dialog). */
export function exportHtmlFile(
  html: string,
  outPath: string,
  suggestedName: string,
): Promise<ExportResult> {
  return ExportHtml(html, outPath, suggestedName)
}

/** Renders HTML and returns the PDF bytes base64-encoded. */
export function renderPdfBase64(html: string, widthIn: number, heightIn: number): Promise<string> {
  return RenderPdfBase64(html, widthIn, heightIn)
}

/** Concatenates base64 PDF parts in order into one file. */
export function mergePdfParts(
  parts: string[],
  outPath: string,
  suggestedName: string,
): Promise<ExportResult> {
  return MergePdfParts(parts, outPath, suggestedName)
}

/** Picks an export folder; resolves null when the user cancels. */
export async function pickExportFolder(title: string): Promise<ExportFolder | null> {
  const folder = await PickExportFolder(title)
  return folder && folder.dir ? folder : null
}

/** Reads a temp PDF written during an image export and deletes it. */
export async function takeTempPdf(path: string): Promise<{ ok: boolean; base64?: string; error?: string }> {
  try {
    const base64 = await TakeTempPdf(path)
    return { ok: true, base64 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Writes base64 bytes to a path (parent directories are created). */
export function writeBase64File(path: string, content: string): Promise<ExportResult> {
  return WriteBase64File(path, content)
}

/** Opens a save dialog and returns the chosen path, null when canceled. */
export async function pickSavePath(defaultName: string, ext: string): Promise<string | null> {
  const path = await PickSaveFile(defaultName, ext)
  return path ? path : null
}

/** Names of the installed system printers. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const value = await ListPrinters()
  return Array.isArray(value) ? (value as PrinterInfo[]) : []
}
