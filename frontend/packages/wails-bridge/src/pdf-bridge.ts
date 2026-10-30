// Thin wrapper over the official Wails V3 generated PdfService bindings.
import {
  ReadFile,
  Save,
  SaveAs,
  ExtractPages,
  InsertPdf,
  SplitPdf,
  MergePdf,
  MergePages,
  ReplacePages,
  SetPageSize,
  SplitPages,
  CropPages,
  ExportImages,
  ListPageImages,
  InsertBlankPage,
  ExtractPagesToFile,
  InsertPdfFromDialog,
  InsertBlankPageAfter,
  ReplacePagesFromDialog,
  MergePdfFromDialog,
  SplitPdfToFolder,
  MergePagesToFile,
  SplitPagesToFile,
  CropPagesFractional,
  ExportImagesToFolder,
  ExportPageImages,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/pdfservice'

export function pdfReadFile(path: string): Promise<string> {
  return ReadFile(path)
}
export function pdfSave(path: string, content: string): Promise<void> {
  return Save(path, content)
}
export function pdfSaveAs(path: string, content: string): Promise<string> {
  return SaveAs(path, content)
}
export function pdfExtractPages(filePath: string, selectedPages: number[], targetPath: string): Promise<any> {
  return ExtractPages(filePath, selectedPages, targetPath)
}
export function pdfInsertPdf(filePath: string, pdf2Path: string, page: number, position: string): Promise<any> {
  return InsertPdf(filePath, pdf2Path, page, position)
}
export function pdfSplitPdf(filePath: string, targetPath: string, splitString: string): Promise<any> {
  return SplitPdf(filePath, targetPath, splitString)
}
export function pdfMergePdf(filePaths: string[], targetPath: string, outName: string): Promise<any> {
  return MergePdf(filePaths, targetPath, outName)
}
export function pdfMergePages(filePath: string, selectedPages: number[], nupSpan: number, targetPath: string): Promise<any> {
  return MergePages(filePath, selectedPages, nupSpan, targetPath)
}
export function pdfReplacePages(filePath: string, replacePath: string, page: number): Promise<any> {
  return ReplacePages(filePath, replacePath, page)
}
export function pdfSetPageSize(filePath: string, width: number, height: number, selectedPages: number[]): Promise<any> {
  return SetPageSize(filePath, width, height, selectedPages)
}
export function pdfSplitPages(filePath: string, selectedPages: number[], gridRows: number, gridCols: number, targetPath: string): Promise<any> {
  return SplitPages(filePath, selectedPages, gridRows, gridCols, targetPath)
}
export function pdfCropPages(filePath: string, selectedPages: number[], cropArea: [number, number, number, number], targetPath: string): Promise<any> {
  return CropPages(filePath, selectedPages, cropArea, targetPath)
}
export function pdfExportImages(filePath: string, selectedPages: number[], targetPath: string): Promise<any> {
  return ExportImages(filePath, selectedPages, targetPath)
}
export function pdfListPageImages(filePath: string, pageIndex: number): Promise<any> {
  return ListPageImages(filePath, pageIndex)
}
export function pdfInsertBlankPage(filePath: string, page: number): Promise<any> {
  return InsertBlankPage(filePath, page)
}

// ── Editor-facing page operations (dialogs + derived document) ──

/** Result of a PDF page operation; `canceled` means a dialog was dismissed. */
export interface PdfOpResult {
  ok: boolean
  canceled?: boolean
  path?: string
  savedDir?: string
  count?: number
  pages?: number
  error?: string
}

export function pdfExtractPagesToFile(
  filePath: string,
  pages: number[],
  suggestedName: string,
): Promise<PdfOpResult> {
  return ExtractPagesToFile(filePath, pages, suggestedName)
}
export function pdfInsertPdfFromDialog(filePath: string, afterPageIndex: number): Promise<PdfOpResult> {
  return InsertPdfFromDialog(filePath, afterPageIndex)
}
export function pdfInsertBlankPageAfter(filePath: string, afterPageIndex: number): Promise<PdfOpResult> {
  return InsertBlankPageAfter(filePath, afterPageIndex)
}
export function pdfReplacePagesFromDialog(filePath: string, pages: number[]): Promise<PdfOpResult> {
  return ReplacePagesFromDialog(filePath, pages)
}
export function pdfMergePdfFromDialog(filePath: string, suggestedName: string): Promise<PdfOpResult> {
  return MergePdfFromDialog(filePath, suggestedName)
}
export function pdfSplitPdfToFolder(filePath: string, chunkSize: number): Promise<PdfOpResult> {
  return SplitPdfToFolder(filePath, chunkSize)
}
export function pdfMergePagesToFile(
  filePath: string,
  pages: number[],
  pagesPerSheet: number,
  direction: 'horizontal' | 'vertical',
  separator: boolean,
  suggestedName: string,
): Promise<PdfOpResult> {
  return MergePagesToFile(filePath, pages, pagesPerSheet, direction, separator, suggestedName)
}
export function pdfSplitPagesToFile(
  filePath: string,
  pages: number[],
  rows: number,
  cols: number,
  suggestedName: string,
): Promise<PdfOpResult> {
  return SplitPagesToFile(filePath, pages, rows, cols, suggestedName)
}
export function pdfCropPagesFractional(
  filePath: string,
  pages: number[],
  rect: [number, number, number, number],
): Promise<PdfOpResult> {
  return CropPagesFractional(filePath, pages, rect[0], rect[1], rect[2], rect[3])
}
export function pdfExportImagesToFolder(filePath: string, pages: number[]): Promise<PdfOpResult> {
  return ExportImagesToFolder(filePath, pages)
}
export function pdfExportPageImages(
  images: string[],
  pageNumbers: number[],
  baseName: string,
): Promise<PdfOpResult> {
  return ExportPageImages(images, pageNumbers, baseName)
}