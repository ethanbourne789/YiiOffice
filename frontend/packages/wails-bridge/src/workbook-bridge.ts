// Thin wrapper over the official Wails V3 generated WorkbookService bindings.
import type {
  WorkbookRangeReadRequest,
  WorkbookSheetRequest,
  WorkbookMediaRequest,
  WorkbookPivotRequest,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/models'
import type { FindRequest, RecalcRequest, SaveRequest } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/workbook/models'
import * as wb from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/workbookservice'

export function wbOpenFile(path: string): Promise<any> {
  return wb.OpenFile(path)
}
export function wbSelectWorkbook(): Promise<any> {
  return wb.SelectWorkbook()
}
export function wbReopenWorkbook(path: string): Promise<any> {
  return wb.ReopenWorkbook(path)
}
export function wbReadRange(request: WorkbookRangeReadRequest): Promise<any> {
  return wb.ReadRange(request)
}
export function wbReadFormulas(request: WorkbookSheetRequest): Promise<any> {
  return wb.ReadFormulas(request)
}
export function wbFindCells(request: FindRequest): Promise<any> {
  return wb.FindCells(request)
}
export function wbReadRowOutline(request: WorkbookSheetRequest): Promise<any> {
  return wb.ReadRowOutline(request)
}
export function wbRecalc(request: RecalcRequest): Promise<any> {
  return wb.Recalc(request)
}
export function wbReadMedia(request: WorkbookMediaRequest): Promise<any> {
  return wb.ReadMedia(request)
}
export function wbReadPivotDefinition(request: WorkbookPivotRequest): Promise<any> {
  return wb.ReadPivotDefinition(request)
}
export function wbSaveWorkbook(request: SaveRequest): Promise<any> {
  return wb.SaveWorkbook(request)
}
export function wbClose(session_id: string): Promise<void> {
  return wb.Close(session_id)
}
export function wbSave(path: string, content: string): Promise<void> {
  return wb.Save(path, content)
}
export function wbSaveAs(path: string, content: string): Promise<string> {
  return wb.SaveAs(path, content)
}
export function wbExportCsv(path: string, content: string): Promise<string> {
  return wb.ExportCsv(path, content)
}
export function wbFilesRead(path: string): Promise<string> {
  return wb.FilesRead(path)
}
export function wbFilesReadImage(path: string): Promise<string> {
  return wb.FilesReadImage(path)
}
export function wbDisplayName(): Promise<string> {
  return wb.DisplayName()
}
export function wbCreateDocument(type: string, title: string, content: string, sheetName: string): Promise<any> {
  return wb.CreateDocument({ type, title, content, sheetName })
}
export function wbExportPdf(fileName: string, html: string): Promise<any> {
  return wb.ExportPdf(fileName, html)
}
export function wbListPrinters(): Promise<any> {
  return wb.ListPrinters()
}
export function wbRenamed(path: string, name: string): Promise<void> {
  return wb.Renamed(path, name)
}
