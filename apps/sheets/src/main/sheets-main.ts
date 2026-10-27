import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen, session as electronSession, shell, systemPreferences, WebContentsView } from 'electron'
import type {
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents,
} from 'electron'
import { z } from 'zod'
import { appMenuLabels, configuredDefaultSaveDir, contextMenuLabels, installContextMenu, installNavigationGuard, isHeadlessMode, safeExternalUrl, showOpenDialogWithMemory, showSaveDialogWithMemory, helpMenuTemplate, viewMenuTemplate, windowMenuTemplate, installRendererProtocol, registerRendererScheme, rendererUrl } from '@yiioffice/electron-utils'
import { createI18n, getUiLang, type Lang, normalizeLang, setUiLang } from '@yiioffice/i18n'

import {
  csvToXlsxBufferForOpen,
  decodeCsvBuffer,
} from '@yiioffice/xlsx-gateway/gateway/csv-import'
import { parseFileToText } from '@yiioffice/file-parse'
import type { CellEdit, SheetStructuralOps } from '@yiioffice/xlsx-gateway/gateway/xlsx-gateway'
import {
  readArchiveEntryText,
  saveWorkbookViaSidecar,
} from '@yiioffice/xlsx-gateway/gateway/xlsx-package-io'
import { parsePivotDefinition } from '@yiioffice/xlsx-gateway/gateway/xlsx-pivot'
import type { SheetEditPlan } from '@yiioffice/xlsx-gateway/gateway/xlsx-sheets'
import type {
  WorkbookFile,
} from '../shared/desktop-api'

// Local attachment types (moved from shared/desktop-api.ts)
interface AttachmentMeta {
  path: string
  name: string
  ext: string
  sizeBytes: number
}
interface AttachmentAddResult {
  accepted: AttachmentMeta[]
  rejected: string[]
}
interface AttachmentReadResult {
  ok: boolean
  error?: string
  name?: string
  text?: string
  totalChars?: number
  offset?: number
}
interface AttachmentImageResult {
  ok: boolean
  base64?: string
  mime?: string
  error?: string
}
import {
  workbookFileSchema,
  workbookFormulaCellsRequestSchema,
  workbookRowOutlineResultSchema,
  workbookFormulaCellsResultSchema,
  workbookFindCellsRequestSchema,
  workbookFindCellsResultSchema,
  workbookRecalcRequestSchema,
  workbookRecalcResultSchema,
  workbookMediaRequestSchema,
  workbookMediaResultSchema,
  workbookPivotRequestSchema,
  localImageRequestSchema,
  localImageResultSchema,
  screenCaptureRequestSchema,
  screenCaptureResultSchema,
  screenSourcesResultSchema,
  workbookPivotDefinitionSchema,
  workbookExportCsvRequestSchema,
  workbookExportPdfRequestSchema,
  printerInfoSchema,
  workbookRangeRequestSchema,
  workbookRangeResultSchema,
  workbookSaveEditsAbortSchema,
  workbookSaveEditsBeginSchema,
  saveEditsChunkArraySchema,
  workbookSaveEditsChunkSchema,
  workbookSaveRequestSchema,
  type WorkbookSaveRequest,
} from '../shared/desktop-api'
import { APP_CHANNELS, IPC_CHANNELS } from '../shared/ipc-channels'
import { atomicWriteFile } from './atomic-write'
import { closeGuardDecision, ShutdownLatch } from './close-guard'
import { SaveEditsTransferStore } from './save-edits-transfer'
import { exportPdf, printWorkbook } from './pdf-export'
import { allowsAutomaticWorkbookRecovery } from './recovery-policy'
import {
  setSystemShortDate,
  shortDatePatternForSystemLocale,
} from '@yiioffice/xlsx-gateway/shared/short-date'
import {
  cleanupExpiredPastedFiles,
  cleanupImportTempDirectory,
  cleanupSessionResources,
} from './temp-files'
import { XlsxSidecarClient } from './xlsx-sidecar-client'
import { sessionAfterRename } from './session-rename'

/**
 * Sheets main-process logic as an embeddable module: no top-level lifecycle.
 * Standalone mode (apps/sheets entry) calls startSheetsStandalone(); the
 * unified shell calls configureSheetsRuntime() + createSheetsWindow() and
 * owns the app lifecycle. AI IPC is registered separately so the shell can
 * substitute its single unified handler set (same channel names as docs).
 */

const tMain = createI18n({
  zh: {
    filterSpreadsheets: '电子表格',
    filterXlsx: 'Excel 工作簿',
    filterXlsm: 'Excel 启用宏的工作簿',
    dlgAddAttachment: '添加附件',
    filterSupported: '支持的文件',
    filterAll: '所有文件',
    errUnsupportedExt: '暂不支持 .{ext} 类型',
    errNotFile: '不是文件',
    errTooLarge: '超过 {mb}MB 上限',
    errImageTooLarge: '图片超过 5MB 上限',
    errUnreadable: '无法读取',
    errFileTooLarge: '文件超过大小上限',
    errParseFailed: '文件解析失败',
    errImageNoText: '图片附件不提供文本,已作为图像随用户消息发送,直接看图即可',
    errNotImage: '不是支持的图片类型',
    errNotLoggedIn: '未登录:请点击下方「登录」完成登录后重试',
    errNoApiKey: '未配置 {provider} 的 API Key',
    errNoModel: '未配置模型名称',
    errImgAbsPath: '图片路径必须是绝对路径。',
    errImgNotFound: '找不到图片文件: {path}',
    errImgTooLarge20: '图片超过 20MB,不支持插入。',
    errImgBadType: '该文件不是 PNG/JPEG/GIF 图片。',
    errDiskChanged: '工作簿在打开后被磁盘上的改动覆盖——请改用另存为。',
    autosaveFoundTitle: '发现自动恢复版本',
    autosaveFoundBody:
      '上次会话有未保存的更改。要恢复自动保存的版本吗?恢复后,保存将直接覆盖原文件。',
    autosaveRestore: '恢复',
    autosaveDiscard: '放弃',
    menuFile: '文件',
    menuOpenWorkbook: '打开工作簿…',
    menuSave: '保存',
    menuSaveAs: '另存为…',
    menuExportPdf: '导出 PDF…',
    menuPrint: '打印…',
    menuClose: '关闭',
    menuQuit: '退出',
    menuEdit: '编辑',
    menuUndo: '撤销',
    menuRedo: '重做',
    closeUnsavedMsg: '有 {count} 处未保存的修改',
    closeUnsavedDetail: '不保存直接关闭,这些修改将丢失。',
    btnDontSave: '不保存',
    btnCancel: '取消',
    csvSaveAsNotice: 'CSV 格式不保留样式等格式修改——另存为 .xlsx 可保留全部内容。',
    menuExportCsv: '导出 CSV…',
    filterCsv: 'CSV (逗号分隔)',
    csvFormulaLossMsg: '当前工作表包含公式,CSV 格式无法保留。',
    csvFormulaLossDetail: 'CSV 只保留纯文本值——公式会被替换为当前计算结果,格式也会丢失。',
    csvKeepXlsxBtn: '另存为 .xlsx',
    csvContinueBtn: '继续保存为 CSV',
    csvActiveSheetOnlyNotice: 'CSV 文件只包含一张工作表——只会导出当前工作表“{name}”。',
    csvKeepFormatMsg: '继续以 CSV 格式保存吗?',
    csvKeepFormatDetail:
      'CSV 只保留单张工作表的纯文本值——公式、格式和其他工作表不会存入 .csv 文件。',
  },
  en: {
    filterSpreadsheets: 'Spreadsheets',
    filterXlsx: 'Excel Workbooks',
    filterXlsm: 'Excel Macro-Enabled Workbooks',
    dlgAddAttachment: 'Add Attachments',
    filterSupported: 'Supported Files',
    filterAll: 'All Files',
    errUnsupportedExt: '.{ext} files are not supported',
    errNotFile: 'not a file',
    errTooLarge: 'exceeds the {mb}MB limit',
    errImageTooLarge: 'image exceeds the 5MB limit',
    errUnreadable: 'cannot be read',
    errFileTooLarge: 'File exceeds the size limit',
    errParseFailed: 'Failed to parse file',
    errImageNoText: 'Image attachments have no text; the image is sent along with the user message',
    errNotImage: 'not a supported image type',
    errNotLoggedIn:
      'Not signed in: click "Sign in" below, sign in, then retry',
    errNoApiKey: 'No API key configured for {provider}',
    errNoModel: 'No model name configured',
    errImgAbsPath: 'Image path must be absolute.',
    errImgNotFound: 'Image file not found: {path}',
    errImgTooLarge20: 'Image exceeds 20MB and cannot be inserted.',
    errImgBadType: 'The file is not a PNG/JPEG/GIF image.',
    errDiskChanged: 'The workbook changed on disk after it was opened — use Save As instead.',
    autosaveFoundTitle: 'Recovered version found',
    autosaveFoundBody:
      'There are unsaved changes from your last session. Restore the autosaved version? Saving after a restore overwrites the original file.',
    autosaveRestore: 'Restore',
    autosaveDiscard: 'Discard',
    menuFile: 'File',
    menuOpenWorkbook: 'Open Workbook…',
    menuSave: 'Save',
    menuSaveAs: 'Save As…',
    menuExportPdf: 'Export PDF…',
    menuPrint: 'Print…',
    menuClose: 'Close',
    menuQuit: 'Quit',
    menuEdit: 'Edit',
    menuUndo: 'Undo',
    menuRedo: 'Redo',
    closeUnsavedMsg: '{count} unsaved change(s)',
    closeUnsavedDetail: 'Your changes will be lost if you close without saving.',
    btnDontSave: "Don't Save",
    btnCancel: 'Cancel',
    csvSaveAsNotice: "CSV files can't keep formatting — saving as .xlsx keeps all your changes.",
    menuExportCsv: 'Export CSV…',
    filterCsv: 'CSV (Comma delimited)',
    csvFormulaLossMsg: 'This sheet contains formulas that CSV cannot keep.',
    csvFormulaLossDetail:
      'CSV keeps plain values only — formulas are flattened to their current results, and formatting is lost.',
    csvKeepXlsxBtn: 'Save as .xlsx',
    csvContinueBtn: 'Continue as CSV',
    csvActiveSheetOnlyNotice:
      'CSV files hold a single sheet — only the active sheet "{name}" will be exported.',
    csvKeepFormatMsg: 'Keep saving in CSV format?',
    csvKeepFormatDetail:
      'CSV keeps plain values of a single sheet only — formulas, formatting, and any additional sheets are not saved to the .csv file.',
  },
})
const tm = (key: Parameters<typeof tMain>[1], params?: Parameters<typeof tMain>[2]) =>
  tMain(getUiLang(), key, params)

interface SessionInfo {
  readonly path: string
  /// Byte-for-byte copy of the file as it was opened (in the OS temp dir).
  /// Saves patch this snapshot rather than the live path, so an external
  /// overwrite of the file can never corrupt the save base — and Save As
  /// stays usable after one. Removed when the session closes.
  readonly snapshotPath: string
  /// Digest of the snapshot (== the file at open time).
  readonly sha256: string
  readonly sheetNames: ReadonlyMap<string, string>
  readonly automaticRecoveryDisabled: boolean
  /// Set when the session opened a converted copy (.xls import): the
  /// first save routes through Save As, defaulting to this .xlsx path.
  readonly suggestSaveAs?: string
  /// The shell's "New spreadsheet" backing file in a temp directory: like an
  /// import the first Save is a Save As, but AutoSave and the recovery copy
  /// keep running (keyed on suggestSaveAs), and a quiet save writes in place.
  readonly unsavedNew?: boolean
  /// The converted copy came from a CSV: the Save As dialog explains that
  /// formatting requires .xlsx (CSV keeps values only).
  readonly csvImport?: boolean
  /// CSV session: the original .csv on disk. Save keeps the CSV identity —
  /// the xlsx save lands on the temp copy and the serialized csvContent is
  /// written back here.
  readonly csvSourcePath?: string
  /// Digest of the original .csv at open/save time — guards the write-back
  /// against external modification, like restoreTargetSha.
  readonly csvSourceSha?: string
  /// App-owned directory containing the converted CSV/XLS copy. Removed only
  /// after the sidecar session and its independent snapshot are closed.
  readonly importTempDir?: string
  /// Set when the session opened a restored crash-recovery copy: the restore
  /// prompt was the user's confirmation, so a plain Save silently writes back
  /// to this original path (no Save As detour).
  readonly restoreTarget?: string
  /// Digest of the original file at restore time — guards the silent
  /// write-back against external modification, mirroring the sha256 check on
  /// the session's own path.
  readonly restoreTargetSha?: string
  /// The opened file was 0 bytes: the session runs on a blank archive in the
  /// temp dir and restoreTarget is the empty original. Unlike a restored
  /// recovery copy, this session still needs its own crash-recovery copy,
  /// keyed by the original.
  readonly emptySource?: boolean
}

// ---- runtime configuration (paths differ when bundled into the shell) ----

interface SheetsRuntimeConfig {
  /** absolute path to the sheets preload bundle */
  preloadPath: string
  /** dev-server URL for the sheets renderer (wins over rendererFile) */
  rendererUrl?: string | undefined
  /** absolute path to the built sheets renderer index.html */
  rendererFile: string
  /** absolute path to the Rust xlsx-sidecar binary */
  sidecarPath?: string | undefined
  /** Shell router used to open exported/AI-generated files in a new YiiOffice tab. */
  openGeneratedPath?: (path: string) => boolean
}

let runtime: SheetsRuntimeConfig = {
  preloadPath: join(__dirname, '../preload/index.js'),
  rendererUrl: process.env.ELECTRON_RENDERER_URL,
  rendererFile: join(__dirname, '../renderer/index.html'),
}

export function configureSheetsRuntime(config: SheetsRuntimeConfig): void {
  runtime = config
}

/** After writing an exported/AI-generated file: open it in the right tab
 * (shell) or reveal it in the folder (standalone). Tab-opening failure must
 * not report the write itself as failed — the file is already persisted. */
function openGeneratedFile(path: string): void {
  // Headless export must stay silent: no tab, no file-manager window
  // (same guard as markdown-main's openExportedPdf, yiioffice#1815).
  if (isHeadlessMode()) return
  try {
    if (runtime.openGeneratedPath?.(path)) return
  } catch (err) {
    console.warn('[sheets] Failed to open generated file:', err)
  }
  shell.showItemInFolder(path)
}

let mainWindow: BrowserWindow | null = null
let sidecar: XlsxSidecarClient | null = null

/** the single real BrowserWindow hosting the tab strip, used as dialog parent in tab mode */
let sheetsShellWindow: BrowserWindow | null = null
export function setSheetsShellWindow(win: BrowserWindow | null): void {
  sheetsShellWindow = win
}

/** the window hosting a tab's WebContentsView when BrowserWindow.fromWebContents
 *  cannot tell (detached "Open in New Window" editors) */
let hostWindowHook: ((wc: WebContents) => BrowserWindow | undefined) | null = null
export function setSheetsHostWindowHook(
  fn: ((wc: WebContents) => BrowserWindow | undefined) | null,
): void {
  hostWindowHook = fn
}

function hostWindowFor(wc: WebContents): BrowserWindow | undefined {
  const own = hostWindowHook?.(wc) ?? BrowserWindow.fromWebContents(wc)
  if (own && !own.isDestroyed()) return own
  return sheetsShellWindow && !sheetsShellWindow.isDestroyed() ? sheetsShellWindow : undefined
}

interface SheetsTabSession {
  readonly webContents: WebContents
  readonly client: XlsxSidecarClient
  readonly sessions: Map<string, SessionInfo>
  /// Chunked uploads of large saves' cell edits, pending their save request.
  readonly saveTransfers: SaveEditsTransferStore
}

/** per-tab session state, keyed by webContents.id — replaces the old single-window closures
 * that `registerIpcHandlers`/`validateSender` used to capture, which broke as soon as a second
 * tab (or a closed-then-reopened tab) registered and overwrote the previous closure. */
/** Max .csv/.tsv bytes converted on open: stops a 500MB text file OOMing main before sidecar limits. */
const MAX_DELIMITED_IMPORT_BYTES = 32 * 1024 * 1024

const sheetsTabs = new Map<number, SheetsTabSession>()
let activeSheetsWebContents: WebContents | null = null
let pastedTempCleanupStarted = false

function startPastedTempCleanup(): void {
  if (pastedTempCleanupStarted) return
  pastedTempCleanupStarted = true
  void cleanupExpiredPastedFiles(app.getPath('temp'))
}

function sessionFor(event: IpcMainInvokeEvent): SheetsTabSession {
  const entry = sheetsTabs.get(event.sender.id)
  if (!entry) throw new Error('Untrusted IPC sender.')
  return entry
}

/// A save request referencing a chunked edit transfer gets the accumulated
/// edits spliced back in; the transfer is consumed either way.
function resolveTransferredEdits(
  entry: SheetsTabSession,
  request: WorkbookSaveRequest,
): WorkbookSaveRequest {
  if (request.editsTransferId === undefined) return request
  if (request.edits.length > 0) throw new Error('Save request mixes inline and transferred edits.')
  const edits = entry.saveTransfers.take(request.editsTransferId, request.sessionId)
  return { ...request, edits }
}

function dialogParent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return hostWindowFor(event.sender)
}

async function openFileDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  return showOpenDialogWithMemory(dialog, dialogParent(event), options)
}

async function saveFileDialog(event: IpcMainInvokeEvent, options: SaveDialogOptions) {
  // before any pick is remembered, bare-name suggestions anchor in the
  // configurable default save folder instead of Electron's Downloads pin
  return showSaveDialogWithMemory(
    dialog,
    dialogParent(event),
    options,
    configuredDefaultSaveDir(app),
  )
}

/** Workbook file extensions the open pipeline accepts. Single source for the
 *  picker filters, the merge-source check, and the crash re-open check. */
const WORKBOOK_EXTS = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv'])

/** register a tab's webContents/client pair and wire up cleanup on teardown */
/** Clients whose process-death notification is already wired. A sidecar client
 *  is shared by every tab (the `sidecar ?? new XlsxSidecarClient(...)` reuse),
 *  so the wiring is per client and the crash is broadcast to the tabs using
 *  it — not attached once per tab, which would notify N times over. */
const crashNotifiedClients = new WeakSet<XlsxSidecarClient>()

/** Tell every live tab that the sidecar died, so it can re-open its workbook
 *  and adopt a live session. Positive signal: a workbook the app closed on
 *  purpose (closeWorkbook) or swapped during Save never reaches the client,
 *  because those only send a `close` command down the live pipe. */
function broadcastSidecarCrash(client: XlsxSidecarClient): void {
  for (const entry of sheetsTabs.values()) {
    if (entry.client !== client) continue
    if (entry.webContents.isDestroyed()) continue
    entry.webContents.send(IPC_CHANNELS.sidecarCrashed)
  }
}

function registerSheetsSession(webContents: WebContents, client: XlsxSidecarClient): void {
  startPastedTempCleanup()
  if (!crashNotifiedClients.has(client)) {
    crashNotifiedClients.add(client)
    client.onProcessExit(() => broadcastSidecarCrash(client))
  }
  sheetsTabs.set(webContents.id, {
    webContents,
    client,
    sessions: new Map(),
    saveTransfers: new SaveEditsTransferStore(),
  })
  activeSheetsWebContents = webContents
  webContents.once('destroyed', () => {
    const entry = sheetsTabs.get(webContents.id)
    sheetsTabs.delete(webContents.id)
    if (entry) {
      // Free pending chunked-save uploads with the tab (the sweep timer's
      // closure would otherwise keep them reachable until the idle expiry).
      entry.saveTransfers.dispose()
      void closeAllSessions(entry)
    }
    if (activeSheetsWebContents === webContents) activeSheetsWebContents = null
  })
}

export function getSheetsWindow(): BrowserWindow | null {
  return mainWindow
}

/** the webContents of whichever sheets tab most recently registered or activated */
export function getActiveSheetsWebContents(): WebContents | null {
  return activeSheetsWebContents
}

/** shell tab switching keeps menu actions routed at the visible sheets tab */
export function setActiveSheetsWebContents(wc: WebContents | null): void {
  activeSheetsWebContents = wc
}

/** Shell notification: an open view's file was renamed on disk (renamed in the
 *  Home list) — sync the matching session's path in that tab (later saves write
 *  the new file) and push the renderer to update the title-bar file name. */
export function sheetsFileRenamed(wc: WebContents, oldPath: string, newPath: string): void {
  // A user-chosen name always wins: the file no longer qualifies for auto-rename.
  // A move that keeps the untitled name (folder tree), including the "(2)"
  // suffix a keep-both move adds, does not count as choosing one.
  const stem = (p: string) => basename(p).replace(/ \(\d+\)(?=\.[^.]+$)/, '')
  if (untitledWorkbookPaths.delete(oldPath) && stem(newPath) === stem(oldPath)) {
    untitledWorkbookPaths.add(newPath)
  }
  const entry = sheetsTabs.get(wc.id)
  if (!entry) return
  let matched = false
  for (const [id, session] of entry.sessions) {
    // Converted copies (.csv / .xls / .tsv) and restored recovery copies keep
    // the user's file in a side field, not in `path`; move those too, or the
    // next Save recreates the file under the old name.
    let renamed = sessionAfterRename(session, oldPath, newPath)
    if (renamed === null) continue
    // An unsaved new workbook's tab renames its hidden backing file; the name
    // the user typed is what the first Save As should offer, and the crash copy
    // is keyed on that name.
    if (session.unsavedNew && session.path === oldPath && session.suggestSaveAs !== undefined) {
      const suggested = join(dirname(session.suggestSaveAs), basename(newPath))
      if (
        suggested !== session.suggestSaveAs &&
        !existsSync(suggested) &&
        !sheetsSuggestedPathTaken(suggested) &&
        retargetUnsavedNewRecovery(session.suggestSaveAs, suggested)
      )
        renamed = { ...renamed, suggestSaveAs: suggested }
    }
    entry.sessions.set(id, renamed)
    matched = true
  }
  if (matched) wc.send(IPC_CHANNELS.workbookRenamed, basename(newPath))
}

/**
 * Workbooks the shell pre-created on disk with the localized untitled name
 * ("New Spreadsheet"). Only these ever qualify for the content-derived
 * auto-rename after an AI run; any manual rename removes the mark.
 */
const untitledWorkbookPaths = new Set<string>()
export function markSheetsUntitledPath(path: string): void {
  untitledWorkbookPaths.add(path)
}

/**
 * Backing workbooks the shell created in a temp directory for "New
 * spreadsheet". The user has no file yet — it only comes into existence at the
 * first Save, which this routes through Save As — and a tab closed without
 * saving discards the temp directory with it. Same shape as an .xls/.tsv
 * import: the file the session edits is not the user's file.
 */
const unsavedNewWorkbooks = new Map<string, { suggestSaveAs: string; tempDir: string }>()

/**
 * shell: a would-be path already promised to another unsaved new workbook (open
 * tab, tab about to open, or a crash copy waiting to be re-offered). The file
 * itself does not exist yet, so uniqueness on disk is not enough.
 */
export function sheetsSuggestedPathTaken(path: string): boolean {
  for (const pending of unsavedNewWorkbooks.values())
    if (pending.suggestSaveAs === path) return true
  for (const tab of sheetsTabs.values())
    for (const session of tab.sessions.values()) if (session.suggestSaveAs === path) return true
  return readUnsavedNewIndex().includes(path)
}

/** shell: mark a backing workbook it just created as not-yet-saved (see above) */
export function markSheetsUnsavedNew(
  openPath: string,
  suggestSaveAs: string,
  tempDir: string,
): void {
  unsavedNewWorkbooks.set(openPath, { suggestSaveAs, tempDir })
}

/** shell: the backing workbook could not be written, release its name */
export function unmarkSheetsUnsavedNew(openPath: string): void {
  unsavedNewWorkbooks.delete(openPath)
}



/** Sanitize an AI-provided sheet name into a safe filename base: strip illegal path chars, collapse whitespace, cap length; null if invalid. (Mirrors slides' draft naming.) */
function sanitizeAutoRenameBase(raw: string): string | null {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point here
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim()
  if (!cleaned) return null
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned
}

/** shell hook: a tab opened a workbook (dialog or queued path) — used for tab titles/dedupe */
let workbookOpenedHook: ((wc: WebContents, path: string) => void) | null = null
export function setSheetsWorkbookOpenedHook(
  fn: ((wc: WebContents, path: string) => void) | null,
): void {
  workbookOpenedHook = fn
}

/** forward an application-menu File command into the sheets renderer */
export function sendSheetsMenuAction(
  action: 'open' | 'save' | 'save-as' | 'print' | 'export-pdf' | 'export-csv' | 'undo' | 'redo',
): void {
  activeSheetsWebContents?.send(IPC_CHANNELS.menuAction, action)
}

/** An already-mounted renderer polled for its queued workbook before one existed. */
export function nudgeQueuedWorkbook(contents: WebContents): void {
  contents.send(IPC_CHANNELS.menuAction, 'open')
}

// ---- AI settings persistence (main process avoids renderer CORS for the chat/stream proxy) ----

function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

// ── Crash recovery ──────────────────────────────────────────
// A dirty renderer asks for a recovery copy every 30s; it is written through the
// normal save pipeline (writeWorkbookTo) to a userData path, so it is a real .xlsx.
// A successful save removes it; opening a file whose copy is newer offers Restore.
const recoveryDir = () => userDataPath('sheets-autosave')
const recoveryPathFor = (filePath: string) =>
  join(recoveryDir(), `${createHash('sha1').update(filePath).digest('hex').slice(0, 16)}.xlsx`)

function clearWorkbookRecovery(filePath: string): void {
  try {
    unlinkSync(recoveryPathFor(filePath))
  } catch {
    /* nothing to clean */
  }
}

// An unsaved new workbook has no file for pendingRecoveryFor to compare
// against, so the would-be paths of its recovery copies are listed here and
// the shell re-offers them at launch (and "New spreadsheet" reuses the name).
const unsavedNewIndexPath = () => join(recoveryDir(), 'unsaved-new.json')

function readUnsavedNewIndex(): string[] {
  const list = readJson<unknown>(unsavedNewIndexPath(), [])
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

function writeUnsavedNewIndex(list: string[]): void {
  try {
    mkdirSync(recoveryDir(), { recursive: true })
    writeFileSync(unsavedNewIndexPath(), JSON.stringify(list))
  } catch (error) {
    console.warn('[sheets] unsaved-new index write failed:', error)
  }
}

function rememberUnsavedNewRecovery(suggestSaveAs: string): void {
  const list = readUnsavedNewIndex()
  if (!list.includes(suggestSaveAs)) writeUnsavedNewIndex([...list, suggestSaveAs])
}

function forgetUnsavedNewRecovery(suggestSaveAs: string): void {
  clearWorkbookRecovery(suggestSaveAs)
  const list = readUnsavedNewIndex()
  if (list.includes(suggestSaveAs)) writeUnsavedNewIndex(list.filter((p) => p !== suggestSaveAs))
}

/** shell, at launch: would-be paths of new workbooks whose recovery copy survived a crash */
export function pendingUnsavedNewRecoveries(): string[] {
  const live = readUnsavedNewIndex().filter((p) => existsSync(recoveryPathFor(p)))
  writeUnsavedNewIndex(live)
  return live
}

/** the would-be name changed: the crash copy keyed on it follows (false = copy stays under the old key) */
function retargetUnsavedNewRecovery(from: string, to: string): boolean {
  if (!pendingUnsavedNewRecoveryFor(from)) return true
  try {
    renameSync(recoveryPathFor(from), recoveryPathFor(to))
    rememberUnsavedNewRecovery(to)
    forgetUnsavedNewRecovery(from)
    return true
  } catch (err) {
    console.warn('[sheets] recovery copy rename failed:', err)
    return false
  }
}

function pendingUnsavedNewRecoveryFor(suggestSaveAs: string): string | null {
  const copy = recoveryPathFor(suggestSaveAs)
  return readUnsavedNewIndex().includes(suggestSaveAs) && existsSync(copy) ? copy : null
}

/// Restore/Discard choice for a pending recovery copy. Rendered as a styled
/// in-app dialog by the renderer (the native message box looks dated,
/// especially on Windows); strings ship pre-localized in the payload.
/// 'dismissed' (renderer gone before answering) opens the original file and
/// keeps the copy, so the offer repeats on the next open.
type RecoveryChoice = 'restore' | 'discard' | 'dismissed'

const recoveryPromptWaiters = new Map<number, (choice: RecoveryChoice) => void>()

function promptRecoveryRestore(
  contents: WebContents,
  filePath: string,
  recoveryPath: string,
): Promise<RecoveryChoice> {
  return new Promise((resolve) => {
    let savedAtMs = Date.now()
    try {
      savedAtMs = statSync(recoveryPath).mtimeMs
    } catch {
      /* copy vanished: the prompt still works, just without a precise time */
    }
    const settle = (choice: RecoveryChoice): void => {
      recoveryPromptWaiters.delete(contents.id)
      contents.removeListener('destroyed', onDestroyed)
      resolve(choice)
    }
    const onDestroyed = (): void => settle('dismissed')
    recoveryPromptWaiters.set(contents.id, settle)
    contents.once('destroyed', onDestroyed)
    contents.send(IPC_CHANNELS.recoveryPrompt, {
      title: tm('autosaveFoundTitle'),
      body: tm('autosaveFoundBody'),
      restoreLabel: tm('autosaveRestore'),
      discardLabel: tm('autosaveDiscard'),
      fileName: basename(filePath),
      savedAtMs,
    })
  })
}

/** Native message-box fallback for the rare open with no live renderer to draw the prompt. */
async function promptRecoveryRestoreNative(
  parent?: BrowserWindow | undefined,
): Promise<RecoveryChoice> {
  const options = {
    type: 'question' as const,
    buttons: [tm('autosaveRestore'), tm('autosaveDiscard')],
    defaultId: 0,
    cancelId: 1,
    message: tm('autosaveFoundTitle'),
    detail: tm('autosaveFoundBody'),
  }
  const answer = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return answer.response === 0 ? 'restore' : 'discard'
}

/** Recovery copy newer than the file itself, i.e. unsaved work from a lost session. */
function pendingRecoveryFor(filePath: string): string | null {
  const copy = recoveryPathFor(filePath)
  try {
    if (!existsSync(copy)) return null
    if (statSync(copy).mtimeMs <= statSync(filePath).mtimeMs) {
      unlinkSync(copy)
      return null
    }
    return copy
  } catch {
    return null
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* corrupted state file: fall back to defaults */
  }
  return fallback
}

// Dev-only automation hooks: a fixed CDP port for driving the app from test
// scripts, and a workbook path that bypasses the native file dialog.
const debugPort = app.isPackaged ? undefined : process.env.XLSX_DEBUG_PORT
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort)
let forcedWorkbookPath = app.isPackaged ? undefined : process.env.XLSX_OPEN_PATH
/** shell-queued workbook paths keyed by tab webContents id: a multi-select Open
 * creates several sheets tabs at once, so the path must be bound to its own tab
 * (a single global would be overwritten by the next iteration). One-shot, unlike
 * the sticky dev env/capture-server path above. */
const queuedWorkbookPaths = new Map<number, string>()

/** queue a workbook this tab's first selectWorkbook call opens without a dialog (shell routing) */
export function queueWorkbookForView(contents: WebContents, path: string): void {
  queuedWorkbookPaths.set(contents.id, path)
  contents.once('destroyed', () => {
    queuedWorkbookPaths.delete(contents.id)
  })
}

/** is the active tab still waiting for the renderer to consume a shell-queued workbook? */
export function hasActiveQueuedWorkbook(): boolean {
  return activeSheetsWebContents !== null && queuedWorkbookPaths.has(activeSheetsWebContents.id)
}

/** set by shell for home:new-sheet: renderer opens blank workbook instead of demo */
let pendingNewBlank = false

/** signal the next sheets renderer to open a new blank workbook (shell mode only) */
export function setSheetsNewBlank(): void {
  pendingNewBlank = true
}

// capturePage forces a renderer frame even when the window is occluded or on
// another Space, unlike CDP Page.captureScreenshot / macOS screencapture.
function startCaptureServer(): void {
  if (!debugPort) return
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/open') {
      forcedWorkbookPath = url.searchParams.get('path') ?? undefined
      response.writeHead(200)
      response.end('ok')
      return
    }
    // Drives the File menu from test scripts: CDP input can't reach native
    // menu accelerators, and osascript focus-stealing is flaky.
    if (url.pathname === '/menu') {
      const action = url.searchParams.get('action')
      if (
        action === 'open' ||
        action === 'save' ||
        action === 'save-as' ||
        action === 'print' ||
        action === 'export-pdf' ||
        action === 'export-csv' ||
        action === 'undo' ||
        action === 'redo'
      ) {
        sendSheetsMenuAction(action)
        response.writeHead(200)
        response.end('ok')
      } else {
        response.writeHead(400)
        response.end('unknown action')
      }
      return
    }
    const webContents = getActiveSheetsWebContents()
    if (url.pathname !== '/capture' || !webContents) {
      response.writeHead(404)
      response.end()
      return
    }
    webContents
      .capturePage()
      .then((image) => {
        response.writeHead(200, { 'Content-Type': 'image/png' })
        response.end(image.toPNG())
      })
      .catch((error: unknown) => {
        response.writeHead(500)
        response.end(String(error))
      })
  })
  server.listen(Number(debugPort) + 1, '127.0.0.1')
}

const sidecarOpenResultSchema = workbookFileSchema.omit({
  sha256: true,
  readOnly: true,
})

export async function createSheetsWindow(
  _options: { includeAiHandlers?: boolean } = {},
): Promise<BrowserWindow> {
  const client = sidecar ?? new XlsxSidecarClient(resolveSidecarPath())
  sidecar = client
  client.start()
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 550,
    show: false,
    title: 'YiiOffice Sheets',
    // Traffic lights sit inside the toolbar row.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  mainWindow = window
  registerSheetsIpc()
  registerSheetsSession(window.webContents, client)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (!app.isPackaged) {
    window.webContents.on('console-message', (details) => {
      process.stderr.write(`[renderer:${details.level}] ${details.message}\n`)
    })
  }
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (sheetsPendingEditCount(window.webContents.id) === 0) return
    event.preventDefault()
    void requestSheetsClose(window.webContents, window).then((proceed) => {
      // destroy() skips this handler on the way out (close() would re-enter
      // with the count possibly still non-zero after a discard).
      if (proceed && !window.isDestroyed()) window.destroy()
      // not proceeding vetoes any quit that was in flight: go back to
      // prompting on later closes (see resetSheetsShuttingDown)
      else resetSheetsShuttingDown()
    })
  })
  window.on('close', () => {
    mainWindow = null
  })

  await window.loadURL(rendererUrl(runtime.rendererUrl, 'sheets'))
  return window
}

/** hidden export windows: webContents id -> the PDF path the renderer must write */
const headlessExportTargets = new Map<number, string>()
/** settled by IPC_CHANNELS.headlessExportDone (or by the renderer dying) */
const headlessExportWaiters = new Map<number, (result: HeadlessSheetsReport) => void>()

interface HeadlessSheetsReport {
  ok: boolean
  error?: string
}

/** End a headless run early (a failure the renderer can never observe). */
function failHeadlessExport(wcId: number, message: string): void {
  const settle = headlessExportWaiters.get(wcId)
  if (!settle) return
  headlessExportWaiters.delete(wcId)
  settle({ ok: false, error: message })
}

/**
 * Render `input` to `outPath` with no visible window: a hidden sheets
 * renderer opens the workbook through the normal queued-open path, lays the
 * active sheet out with its Page Layout settings and prints via the existing
 * hidden print window (main/pdf-export.ts).
 */
export async function exportSheetsPdfHeadless(
  input: string,
  outPath: string,
  timeoutMs = 600_000,
): Promise<void> {
  const client = sidecar ?? new XlsxSidecarClient(resolveSidecarPath())
  sidecar = client
  client.start()
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  registerSheetsIpc()
  registerSheetsSession(win.webContents, client)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  const wcId = win.webContents.id
  queueWorkbookForView(win.webContents, input)
  headlessExportTargets.set(wcId, outPath)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const report = await new Promise<HeadlessSheetsReport>((resolve) => {
      headlessExportWaiters.set(wcId, resolve)
      win.webContents.on('render-process-gone', (_event, details) =>
        resolve({ ok: false, error: `sheets renderer stopped (${details.reason})` }),
      )
      timer = setTimeout(
        () => resolve({ ok: false, error: `sheets export timed out after ${timeoutMs}ms` }),
        timeoutMs,
      )
      void win.webContents.loadURL(rendererUrl(runtime.rendererUrl, 'sheets'))
    })
    if (!report.ok) throw new Error(report.error ?? 'sheets export failed')
  } finally {
    if (timer) clearTimeout(timer)
    headlessExportWaiters.delete(wcId)
    headlessExportTargets.delete(wcId)
    if (!win.isDestroyed()) win.destroy()
  }
}

/** tab-mode equivalent of createSheetsWindow: same runtime/IPC wiring, no BrowserWindow of its own. */
export function createSheetsView(
  options: { includeAiHandlers?: boolean; openingWorkbook?: boolean } = {},
): WebContentsView {
  const client = sidecar ?? new XlsxSidecarClient(resolveSidecarPath())
  sidecar = client
  client.start()
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  registerSheetsIpc()
  registerSheetsSession(view.webContents, client)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())
  if (!app.isPackaged) {
    view.webContents.on('console-message', (details) => {
      process.stderr.write(`[renderer:${details.level}] ${details.message}\n`)
    })
  }
  // mode=tab: the shell's tab strip owns the traffic lights / caption buttons,
  // so the ribbon must not reserve space for them
  void view.webContents.loadURL(
    rendererUrl(runtime.rendererUrl, 'sheets', {
      mode: 'tab',
      ...(options.openingWorkbook ? { openingWorkbook: '1' } : {}),
    }),
  )
  return view
}

// ---- Chat attachments: local files parsed and fed to the agent (copied from
// the apps/docs docs-main attachment pipeline) ----

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
/** Plain-text extensions, read as UTF-8 */
const ATTACHMENT_TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'go',
  'rs',
  'rb',
  'sh',
  'sql',
  'css',
])
/** Image extensions that go multimodal rather than text extraction */
const ATTACHMENT_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
/** office/pdf formats extract text via @yiioffice/file-parse; images skip text
 * extraction and go multimodal (sheets:files-read-image) */
const ATTACHMENT_EXTS = new Set([
  ...ATTACHMENT_TEXT_EXTS,
  'doc',
  'docx',
  'pdf',
  'pptx',
  'ppt',
  'xlsx',
  'xlsm',
  'xls',
  ...ATTACHMENT_IMAGE_EXTS,
])

const ATTACHMENT_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}
/** Multimodal cap per image attachment (protects the context window) */
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Extracted-text cache keyed by path; invalidated when mtime+size change */
const attachmentTextCache = new Map<string, { stamp: string; text: string }>()

function statAttachment(filePath: string): { meta?: AttachmentMeta; error?: string } {
  const name = basename(filePath)
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ATTACHMENT_EXTS.has(ext)) return { error: `${name}: ${tm('errUnsupportedExt', { ext })}` }
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { error: `${name}: ${tm('errNotFile')}` }
    if (stat.size > ATTACHMENT_MAX_BYTES) {
      return {
        error: `${name}: ${tm('errTooLarge', { mb: Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024) })}`,
      }
    }
    if (ATTACHMENT_IMAGE_EXTS.has(ext) && stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { error: `${name}: ${tm('errImageTooLarge')}` }
    }
    return { meta: { path: filePath, name, ext, sizeBytes: stat.size } }
  } catch {
    return { error: `${name}: ${tm('errUnreadable')}` }
  }
}

function collectAttachments(paths: string[]): AttachmentAddResult {
  const accepted: AttachmentMeta[] = []
  const rejected: string[] = []
  for (const p of paths) {
    const { meta, error } = statAttachment(p)
    if (meta) accepted.push(meta)
    else if (error) rejected.push(error)
  }
  return { accepted, rejected }
}

/** Persists clipboard-pasted image bytes to a temp file (screenshots/bitmaps
 * without a local path); returns null for non-images or empty data */
let pastedImageSeq = 0
function savePastedImage(data: unknown, ext: unknown): string | null {
  const cleanExt = typeof ext === 'string' ? ext.toLowerCase() : ''
  if (!ATTACHMENT_IMAGE_EXTS.has(cleanExt)) return null
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null
  if (!bytes || bytes.byteLength === 0) return null
  const dir = join(app.getPath('temp'), 'yiioffice-pasted')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  const filePath = join(dir, `pasted-${stamp}-${++pastedImageSeq}.${cleanExt}`)
  writeFileSync(filePath, bytes)
  return filePath
}

/** Attachment text extraction via @yiioffice/file-parse (docx/pdf/pptx/xlsx/plain text) */
async function extractAttachmentText(filePath: string): Promise<string> {
  const stat = statSync(filePath)
  const stamp = `${stat.mtimeMs}:${stat.size}`
  const cached = attachmentTextCache.get(filePath)
  if (cached && cached.stamp === stamp) return cached.text
  if (stat.size > ATTACHMENT_MAX_BYTES) throw new Error(tm('errFileTooLarge'))
  const parsed = await parseFileToText(filePath)
  if (!parsed.ok || parsed.kind !== 'text' || parsed.text == null) {
    throw new Error(parsed.error ?? tm('errParseFailed'))
  }
  attachmentTextCache.set(filePath, { stamp, text: parsed.text })
  // The cache is bounded (keeping a few recent files is enough)
  if (attachmentTextCache.size > 8) {
    const oldest = attachmentTextCache.keys().next().value
    if (oldest) attachmentTextCache.delete(oldest)
  }
  return parsed.text
}

// Close guard: the renderer mirrors its pending-save count here, used to show a
// save confirmation before closing the window/tab.
const pendingEditCounts = new Map<number, number>()
const closeSaveWaiters = new Map<number, (ok: boolean) => void>()
const trackedEditSenders = new Set<number>()

export function sheetsPendingEditCount(webContentsId: number): number {
  return pendingEditCounts.get(webContentsId) ?? 0
}

/**
 * Close guard for a sheets renderer: true means proceed with the close.
 * Clean → true; dirty → Save/Don't Save/Cancel dialog. Save asks the renderer to run
 * its journal save and waits for the outcome — a failed or canceled save
 * keeps the window open (the renderer already surfaced the error).
 */
/**
 * The app is shutting down (quit menu, SIGTERM from a restart/installer/killall,
 * SIGINT from a terminal). The close guard must not save then: nobody answered the
 * prompt, and a dialog raised during shutdown resolves to its default button, which
 * silently overwrote the user's original file. Unsaved work is covered
 * by the 30s recovery copy instead — the next launch offers to restore it.
 */
const shutdownLatch = new ShutdownLatch()

export function markSheetsShuttingDown(): void {
  shutdownLatch.mark()
}

/**
 * The quit was vetoed (a prevented window close that ended up not proceeding).
 * The latch must go back down: from now on closes are interactive again and
 * the save prompt must run — leaving it set would silently discard unsaved
 * edits on every later close.
 */
export function resetSheetsShuttingDown(): void {
  shutdownLatch.reset()
}

app.on('before-quit', markSheetsShuttingDown)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    shutdownLatch.mark()
    app.quit()
  })
}

export async function requestSheetsClose(
  contents: WebContents,
  parent?: BrowserWindow | null,
): Promise<boolean> {
  // A quiet AutoSave leaves an unsaved new workbook's journal empty, but its
  // work still sits on no user-visible path: closing it is discarding it.
  const autosavedNew = [...(sheetsTabs.get(contents.id)?.sessions.values() ?? [])].filter(
    (s) =>
      s.unsavedNew &&
      s.suggestSaveAs !== undefined &&
      pendingUnsavedNewRecoveryFor(s.suggestSaveAs),
  ).length
  const count = (pendingEditCounts.get(contents.id) ?? 0) + autosavedNew
  const decision = closeGuardDecision({
    pendingEdits: count,
    destroyed: contents.isDestroyed(),
    shuttingDown: shutdownLatch.active,
  })
  if (decision === 'proceed') return true
  const options = {
    // On macOS 'warning' shows the system warning triangle + app-icon badge
    type: 'warning' as const,
    message: tm('closeUnsavedMsg', { count }),
    detail: tm('closeUnsavedDetail'),
    buttons: [tm('menuSave'), tm('btnDontSave'), tm('btnCancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  if (response === 2) return false
  if (response === 1) return true
  // The window went away (or a quit started) while the prompt was up: don't save
  if (shutdownLatch.active || contents.isDestroyed()) return true
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      closeSaveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    closeSaveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send(IPC_CHANNELS.closeSaveRequest)
  })
}

let coreIpcRegistered = false

export function registerSheetsIpc(): void {
  if (coreIpcRegistered) return
  coreIpcRegistered = true

  ipcMain.handle(IPC_CHANNELS.userDisplayName, (event): string => {
    sessionFor(event)
    try {
      return userInfo().username
    } catch {
      return ''
    }
  })

  ipcMain.on(IPC_CHANNELS.recoveryPromptReply, (event, restore: unknown) => {
    recoveryPromptWaiters.get(event.sender.id)?.(restore === true ? 'restore' : 'discard')
  })

  ipcMain.on(IPC_CHANNELS.pendingEditsChanged, (event, count: unknown) => {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return
    const senderId = event.sender.id
    pendingEditCounts.set(senderId, Math.floor(count))
    if (!trackedEditSenders.has(senderId)) {
      trackedEditSenders.add(senderId)
      event.sender.once('destroyed', () => {
        trackedEditSenders.delete(senderId)
        pendingEditCounts.delete(senderId)
        closeSaveWaiters.get(senderId)?.(false)
        closeSaveWaiters.delete(senderId)
      })
    }
  })

  ipcMain.on(IPC_CHANNELS.closeSaveResult, (event, ok: unknown) => {
    const waiter = closeSaveWaiters.get(event.sender.id)
    if (!waiter) return
    closeSaveWaiters.delete(event.sender.id)
    waiter(ok === true)
  })

  // shared with the other editor modules — last (identical) registration wins
  ipcMain.removeHandler(APP_CHANNELS.getLanguage)
  ipcMain.handle(APP_CHANNELS.getLanguage, () => getUiLang())

  /** returns true once when shell opened this tab for a new blank workbook */
  ipcMain.handle(IPC_CHANNELS.consumeNewBlank, () => {
    if (pendingNewBlank) {
      pendingNewBlank = false
      return true
    }
    return false
  })

  /**
   * Is a shell-queued workbook still waiting to be opened? The shell's 'open'
   * nudge loop gives up after 30s; on slow dev cold starts (vite compiles the
   * renderer on demand) Univer mounts later than that and the queued path
   * would strand the tab as a blank in-memory workbook. The renderer polls
   * this once it is ready and triggers the open itself.
   */
  ipcMain.handle(IPC_CHANNELS.hasQueuedWorkbook, (event) => queuedWorkbookPaths.has(event.sender.id))

  // ---- headless export mode (--headless-export) ----

  ipcMain.handle(IPC_CHANNELS.consumeHeadlessExport, (event): string | null => {
    const target = headlessExportTargets.get(event.sender.id) ?? null
    headlessExportTargets.delete(event.sender.id)
    return target
  })

  ipcMain.on(IPC_CHANNELS.headlessExportDone, (event, result: unknown) => {
    const settle = headlessExportWaiters.get(event.sender.id)
    if (!settle) return
    headlessExportWaiters.delete(event.sender.id)
    const state = result as { ok?: unknown; error?: unknown } | null
    settle({
      ok: state?.ok === true,
      ...(typeof state?.error === 'string' ? { error: state.error } : {}),
    })
  })

  /// `explicitPath` re-opens a known file without the picker or the shell
  /// queue — the crash-recovery entry point. It runs the SAME pipeline
  /// (prepareWorkbookForOpen + openWorkbookSession + the opened hook) as a
  /// user-picked or shell-queued open, so a recovered workbook is a normal
  /// session rather than a merge source.
  const openSelectedWorkbook = async (event: IpcMainInvokeEvent, explicitPath?: string) => {
    const entry = sessionFor(event)
    let path = explicitPath ?? queuedWorkbookPaths.get(event.sender.id) ?? forcedWorkbookPath
    // consume immediately (before the slow session open) so the shell's
    // retry loop stops re-sending 'open' for the same file
    queuedWorkbookPaths.delete(event.sender.id)
    if (!path) {
      const selection = await openFileDialog(event, {
        properties: ['openFile'],
        filters: [
          { name: tm('filterSpreadsheets'), extensions: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'] },
        ],
      })
      if (selection.canceled || !selection.filePaths[0]) return null
      path = selection.filePaths[0]
    }
    const prepared = await prepareWorkbookForOpen(
      entry.client,
      path,
      event.sender,
      dialogParent(event),
    )
    // The recovery prompt (or the file dialog / import conversion) can outlive
    // the tab: once the renderer is destroyed, its 'destroyed' handler has
    // already run closeAllSessions and dropped the tab entry, so a session
    // opened now would never be closed and its snapshot would leak.
    if (event.sender.isDestroyed()) {
      await discardPreparedOpen(prepared)
      return null
    }
    const result = await openWorkbookSession(entry.client, prepared.openPath, entry.sessions, {
      suggestSaveAs: prepared.suggestSaveAs,
      csvImport: prepared.csvImport,
      csvSourcePath: prepared.csvSourcePath,
      emptyCsv: prepared.emptyCsv,
      importTempDir: prepared.importTempDir,
      restoreTarget: prepared.restoreTarget,
      emptySource: prepared.emptySource,
      unsavedNew: prepared.unsavedNew,
    })
    // The sidecar open itself can also outlive the tab after the pre-open
    // check. Close the newly registered session instead of stranding it in
    // the detached entry map.
    if (event.sender.isDestroyed()) {
      const session = entry.sessions.get(result.sessionId)
      entry.sessions.delete(result.sessionId)
      if (session !== undefined) {
        await cleanupSessionResources({
          tempRoot: app.getPath('temp'),
          snapshotPath: session.snapshotPath,
          importTempDir: session.importTempDir,
          closeSidecar: () => entry.client.close(result.sessionId),
        })
      }
      return null
    }
    // an unsaved new workbook's tab already shows the untitled name; its temp
    // backing path must not become a recent file
    if (!prepared.unsavedNew) workbookOpenedHook?.(event.sender, path)
    return result
  }

  ipcMain.handle(IPC_CHANNELS.selectWorkbook, async (event) => {
    try {
      return await openSelectedWorkbook(event)
    } catch (err) {
      // A headless export has no dialog to report a failed open through, and
      // its renderer would poll to the deadline waiting for a workbook that
      // will never arrive — settle the run with the real reason instead.
      failHeadlessExport(event.sender.id, `the input workbook did not open (${String(err)})`)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.reopenWorkbook, async (event, path: unknown) => {
    const validated = z.string().min(1).parse(path)
    // A crash re-open targets the file the user already has open, so a
    // missing/deleted file is a real failure rather than a reason to pop the
    // picker at someone who did not ask to open anything.
    if (!existsSync(validated)) throw new Error('Workbook file not found.')
    const ext = validated.slice(validated.lastIndexOf('.') + 1).toLowerCase()
    if (!WORKBOOK_EXTS.has(ext)) throw new Error(`Unsupported workbook: ${ext}`)
    return openSelectedWorkbook(event, validated)
  })

  // Merge sources: same open pipeline as selectWorkbook, but multi-select,
  // never consuming the shell's queued open path and never retitling the tab
  // (workbookOpenedHook) — these sessions exist only to be read from and
  // closed by the renderer's merge routine.
  /** Open the given spreadsheet paths as merge-source sessions; cleans up
   *  everything already opened when a later file fails or the tab dies. */
  const openMergeSources = async (
    event: Electron.IpcMainInvokeEvent,
    paths: readonly string[],
  ): Promise<unknown[] | null> => {
    const entry = sessionFor(event)
    const opened: { sessionId: string }[] = []
    const closeOpened = async () => {
      for (const { sessionId } of opened) {
        const session = entry.sessions.get(sessionId)
        entry.sessions.delete(sessionId)
        if (session !== undefined) {
          await cleanupSessionResources({
            tempRoot: app.getPath('temp'),
            snapshotPath: session.snapshotPath,
            importTempDir: session.importTempDir,
            closeSidecar: () => entry.client.close(sessionId),
          })
        }
      }
    }
    try {
      for (const path of paths) {
        const prepared = await prepareWorkbookForOpen(
          entry.client,
          path,
          event.sender,
          dialogParent(event),
          { skipRecoveryPrompt: true },
        )
        if (event.sender.isDestroyed()) {
          await discardPreparedOpen(prepared)
          break
        }
        const result = await openWorkbookSession(entry.client, prepared.openPath, entry.sessions, {
          suggestSaveAs: prepared.suggestSaveAs,
          csvImport: prepared.csvImport,
          csvSourcePath: prepared.csvSourcePath,
          importTempDir: prepared.importTempDir,
          restoreTarget: prepared.restoreTarget,
          emptySource: prepared.emptySource,
          unsavedNew: prepared.unsavedNew,
        })
        opened.push(result as { sessionId: string })
        if (event.sender.isDestroyed()) break
      }
    } catch (error) {
      // a later file failing must not strand the sessions already opened
      await closeOpened()
      throw error
    }
    if (event.sender.isDestroyed()) {
      await closeOpened()
      return null
    }
    return opened.length > 0 ? opened : null
  }

  ipcMain.handle(IPC_CHANNELS.selectWorkbooksForMerge, async (event) => {
    const selection = await openFileDialog(event, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: tm('filterSpreadsheets'), extensions: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'] },
      ],
    })
    if (selection.canceled || selection.filePaths.length === 0) return null
    return openMergeSources(event, selection.filePaths)
  })

  const MERGE_SOURCE_EXTS = WORKBOOK_EXTS
  ipcMain.handle(IPC_CHANNELS.openWorkbooksForMerge, async (event, input: unknown) => {
    const paths = z.array(z.string().min(1)).min(1).max(20).parse(input)
    for (const path of paths) {
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (!MERGE_SOURCE_EXTS.has(ext)) throw new Error(`Unsupported merge source: ${ext}`)
      if (!existsSync(path)) throw new Error('Merge source not found.')
    }
    return openMergeSources(event, paths)
  })

  ipcMain.handle(IPC_CHANNELS.readWorkbookRange, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookRangeRequestSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    const result = await entry.client.readRange(request)
    return workbookRangeResultSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.readWorkbookFormulas, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookFormulaCellsRequestSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    const result = await entry.client.readFormulaCells(request)
    return workbookFormulaCellsResultSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.findWorkbookCells, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookFindCellsRequestSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    const result = await entry.client.findCells(request)
    return workbookFindCellsResultSchema.parse(result)
  })

  ipcMain.handle(IPC_CHANNELS.readWorkbookRowOutline, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookFormulaCellsRequestSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    const result = await entry.client.readRowOutline(request)
    return workbookRowOutlineResultSchema.parse(result)
  })

  // IronCalc recalculation: sheet ids resolve through the session's file
  // sheet names, so the renderer never sees paths and sheets added this
  // session (no file part) fail closed before reaching the engine.
  const sidecarRecalcResultSchema = z
    .object({
      cells: z.array(
        z
          .object({
            sheet: z.string(),
            row: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            formatted: z.string(),
            number: z.number().optional(),
            isError: z.boolean().optional(),
            isFormula: z.boolean(),
          })
          .strict(),
      ),
      cached: z.boolean().optional(),
    })
    .strict()
  ipcMain.handle(IPC_CHANNELS.recalcWorkbook, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookRecalcRequestSchema.parse(input)
    const session = entry.sessions.get(request.sessionId)
    if (!session) throw new Error('Unknown workbook session.')
    const fileSheetName = (sheetId: string): string => {
      const name = session.sheetNames.get(sheetId)
      if (name === undefined) throw new Error(`Unknown sheet for recalculation: ${sheetId}`)
      return name
    }
    const result = sidecarRecalcResultSchema.parse(
      await entry.client.recalcCells({
        // The snapshot, not the live path: recalculated values are painted on
        // the session's grid (and saved into its formula cells), so they must
        // come from the session's own bytes even if the file changed on disk.
        path: session.snapshotPath,
        edits: request.edits.map((edit) => ({
          sheet: fileSheetName(edit.sheetId),
          row: edit.row,
          column: edit.column,
          input: edit.input,
        })),
        reads: request.reads.map((read) => ({
          sheet: fileSheetName(read.sheetId),
          range: read.range,
        })),
      }),
    )
    const idsByName = new Map([...session.sheetNames].map(([id, name]) => [name, id]))
    return workbookRecalcResultSchema.parse({
      cells: result.cells.flatMap((cell) => {
        const sheetId = idsByName.get(cell.sheet)
        if (sheetId === undefined) return []
        return [
          {
            sheetId,
            row: cell.row,
            column: cell.column,
            formatted: cell.formatted,
            ...(cell.number === undefined ? {} : { number: cell.number }),
            ...(cell.isError ? { isError: true } : {}),
            isFormula: cell.isFormula,
          },
        ]
      }),
    })
  })

  ipcMain.handle(IPC_CHANNELS.readWorkbookMedia, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookMediaRequestSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    const result = await entry.client.readMedia(request)
    return workbookMediaResultSchema.parse(result)
  })

  function sniffImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | null {
    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
      return 'image/png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg'
    }
    if (bytes.length >= 6 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
    return null
  }

  ipcMain.handle(IPC_CHANNELS.readLocalImage, async (event, input: unknown) => {
    sessionFor(event)
    const request = localImageRequestSchema.parse(input)
    const resolved = request.path.startsWith('~/')
      ? join(app.getPath('home'), request.path.slice(2))
      : request.path
    if (!isAbsolute(resolved)) throw new Error(tm('errImgAbsPath'))
    const info = await stat(resolved).catch(() => null)
    if (!info?.isFile()) throw new Error(tm('errImgNotFound', { path: request.path }))
    if (info.size > 20 * 1024 * 1024) throw new Error(tm('errImgTooLarge20'))
    const bytes = await readFile(resolved)
    const mediaType = sniffImageType(bytes)
    if (mediaType === null) {
      throw new Error(tm('errImgBadType'))
    }
    return localImageResultSchema.parse({ mediaType, base64: bytes.toString('base64') })
  })

  ipcMain.handle(IPC_CHANNELS.captureScreenSources, async (event) => {
    sessionFor(event)
    // macOS gates desktopCapturer behind the Screen Recording permission and
    // returns black frames instead of failing; surface a real denied state.
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status !== 'granted' && status !== 'not-determined') {
        return screenSourcesResultSchema.parse({ status: 'denied', sources: [] })
      }
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    })
    if (
      process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('screen') !== 'granted'
    ) {
      return screenSourcesResultSchema.parse({ status: 'denied', sources: [] })
    }
    const selfWindow = hostWindowFor(event.sender)
    const selfId = selfWindow?.getMediaSourceId()
    return screenSourcesResultSchema.parse({
      status: 'ok',
      sources: sources
        .filter((source) => source.id !== selfId)
        .map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.id.startsWith('screen') ? 'screen' : 'window',
          thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        })),
    })
  })

  ipcMain.handle(IPC_CHANNELS.captureScreenSource, async (event, input: unknown) => {
    sessionFor(event)
    const request = screenCaptureRequestSchema.parse(input)
    // desktopCapturer only ever returns thumbnails, so a full-res capture is
    // a re-listing with the thumbnail sized to the largest physical display.
    const displays = screen.getAllDisplays()
    const captureSize = {
      width: Math.min(
        4096,
        Math.max(1920, ...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor))),
      ),
      height: Math.min(
        4096,
        Math.max(1080, ...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor))),
      ),
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: captureSize,
      fetchWindowIcons: false,
    })
    const source = sources.find((candidate) => candidate.id === request.id)
    if (!source || source.thumbnail.isEmpty()) return null
    let image = source.thumbnail
    let png = image.toPNG()
    if (png.length > 20 * 1024 * 1024) {
      image = image.resize({ width: Math.round(image.getSize().width / 2) })
      png = image.toPNG()
    }
    const { width, height } = image.getSize()
    return screenCaptureResultSchema.parse({
      mediaType: 'image/png',
      base64: png.toString('base64'),
      width,
      height,
    })
  })

  ipcMain.handle(IPC_CHANNELS.readPivotDefinition, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookPivotRequestSchema.parse(input)
    const session = entry.sessions.get(request.sessionId)
    if (!session) throw new Error('Unknown workbook session.')
    // Read from the session snapshot so the definition matches what the
    // renderer shows even if the file on disk changed since open.
    const [pivotXml, cacheXml] = await Promise.all([
      readArchiveEntryText(entry.client, session.snapshotPath, request.path),
      readArchiveEntryText(entry.client, session.snapshotPath, request.cachePath),
    ])
    return workbookPivotDefinitionSchema.parse(parsePivotDefinition(pivotXml, cacheXml))
  })

  ipcMain.handle(IPC_CHANNELS.exportPdf, async (event, input: unknown) => {
    sessionFor(event)
    const request = workbookExportPdfRequestSchema.parse(input)
    const result = await exportPdf(event, request)
    if (!result.canceled && result.path) openGeneratedFile(result.path)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.printWorkbook, async (event, input: unknown) => {
    sessionFor(event)
    return printWorkbook(event, workbookExportPdfRequestSchema.parse(input))
  })

  ipcMain.handle(IPC_CHANNELS.listPrinters, async (event) => {
    sessionFor(event)
    const printers = await event.sender.getPrintersAsync()
    return printers.map((printer) =>
      printerInfoSchema.parse({
        name: printer.name,
        displayName: printer.displayName || printer.name,
      }),
    )
  })

  ipcMain.handle(IPC_CHANNELS.exportCsv, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookExportCsvRequestSchema.parse(input)
    const parent = dialogParent(event)
    if (request.hasFormulas) {
      // Excel's CSV warning flow: offer keeping the formulas via .xlsx first.
      const options = {
        type: 'warning' as const,
        message: tm('csvFormulaLossMsg'),
        detail: tm('csvFormulaLossDetail'),
        buttons: [tm('csvKeepXlsxBtn'), tm('csvContinueBtn'), tm('btnCancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const { response } = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (response === 0) return { canceled: true, saveAsXlsxInstead: true }
      if (response === 2) return { canceled: true }
    }
    let pickedPath = request.targetPath
    if (pickedPath === undefined) {
      const selection = await saveFileDialog(event, {
        defaultPath: request.fileName,
        filters: [{ name: tm('filterCsv'), extensions: ['csv'] }],
        ...(request.activeSheetName
          ? {
              title: tm('csvActiveSheetOnlyNotice', { name: request.activeSheetName }),
              message: tm('csvActiveSheetOnlyNotice', { name: request.activeSheetName }),
            }
          : {}),
      })
      if (selection.canceled || !selection.filePath) return { canceled: true }
      pickedPath = selection.filePath
    }
    const targetPath = pickedPath.toLowerCase().endsWith('.csv') ? pickedPath : `${pickedPath}.csv`
    // UTF-8 BOM so Excel decodes the reopened file correctly. Written beside
    // the destination and renamed into place: a plain writeFile creates the
    // (empty) file before the data lands, and anything watching for the
    // export — the e2e retry loop included — can read zero bytes in that
    // window.
    const csvBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(request.content, 'utf8'),
    ])
    await atomicWriteFile(targetPath, csvBytes)
    // An export can land on a CSV session's own source file — refresh that
    // session's guard digest so its next Save doesn't mistake this write for
    // an external change.
    const writtenSha = await sha256File(targetPath).catch(() => undefined)
    if (writtenSha !== undefined) {
      for (const [sessionId, session] of entry.sessions) {
        if (session.csvSourcePath === targetPath) {
          entry.sessions.set(sessionId, { ...session, csvSourceSha: writtenSha })
        }
      }
    }
    return { canceled: false, path: targetPath }
  })

  // First Save of a CSV session: Excel's "keep this format?" question. The
  // renderer remembers the answer for the file, so it is asked once.
  ipcMain.handle(IPC_CHANNELS.csvSaveConfirm, async (event) => {
    sessionFor(event)
    const options = {
      type: 'warning' as const,
      message: tm('csvKeepFormatMsg'),
      detail: tm('csvKeepFormatDetail'),
      buttons: [tm('csvContinueBtn'), tm('csvKeepXlsxBtn'), tm('btnCancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }
    const parent = dialogParent(event)
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    return response === 0 ? 'csv' : response === 1 ? 'xlsx' : 'cancel'
  })

  ipcMain.handle(IPC_CHANNELS.saveWorkbook, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const client = entry.client
    const request = resolveTransferredEdits(entry, workbookSaveRequestSchema.parse(input))
    const session = entry.sessions.get(request.sessionId)
    if (!session) throw new Error('Unknown workbook session.')

    // A CSV session's plain Save keeps the CSV identity: the xlsx save lands
    // on the temp copy and the serialized csvContent is written back to the
    // original .csv afterwards.
    const csvInPlace = request.mode === 'save' && session.csvSourcePath !== undefined
    let targetPath = session.path
    // Explicit-path save: dialog-free Save As to an exact path with a clobber guard — docs:save-to parity.
    if (request.targetPath !== undefined) {
      if (request.mode !== 'save-as') throw new Error('An explicit save path needs Save As.')
      if (!isAbsolute(request.targetPath)) throw new Error('Save path must be absolute.')
      targetPath = /\.xlsx$/i.test(request.targetPath)
        ? request.targetPath
        : `${request.targetPath}.xlsx`
      if (existsSync(targetPath) && request.overwrite !== true) {
        throw new Error(`file already exists: ${targetPath}`)
      }
    } else if (request.mode === 'save' && request.quiet && session.unsavedNew) {
      // AutoSave / AI-run autosave of a workbook the user has not named yet:
      // no dialog mid-flow, the edits land in the backing temp file and the
      // session stays an unsaved new one (Ctrl+S still asks where to save)
      targetPath = session.path
    } else if (request.mode === 'save-as' || session.suggestSaveAs !== undefined) {
      // .xlsm keeps its extension: untouched archive entries (vbaProject.bin,
      // the macro-enabled content type) round-trip verbatim through the save.
      const macroEnabled = /\.xlsm$/i.test(
        session.suggestSaveAs ?? session.restoreTarget ?? session.path,
      )
      const ext = macroEnabled ? 'xlsm' : 'xlsx'
      const selection = await saveFileDialog(event, {
        defaultPath:
          session.suggestSaveAs ??
          session.csvSourcePath?.replace(/\.[^.]+$/, '.xlsx') ??
          session.restoreTarget ??
          session.path,
        filters: macroEnabled
          ? [{ name: tm('filterXlsm'), extensions: ['xlsm'] }]
          : [
              { name: tm('filterXlsx'), extensions: ['xlsx'] },
              { name: tm('filterCsv'), extensions: ['csv'] },
            ],
        // CSV import: explain why the save goes through .xlsx (CSV keeps values only)
        ...(session.csvImport
          ? { title: tm('csvSaveAsNotice'), message: tm('csvSaveAsNotice') }
          : {}),
      })
      if (selection.canceled || !selection.filePath) return { canceled: true }
      // A CSV pick can't ride the xlsx pipeline: hand the path back so the
      // renderer serializes the active sheet through the CSV export channel.
      if (!macroEnabled && selection.filePath.toLowerCase().endsWith('.csv')) {
        return { canceled: true, csvSaveAsPath: selection.filePath }
      }
      targetPath = selection.filePath.toLowerCase().endsWith(`.${ext}`)
        ? selection.filePath
        : `${selection.filePath}.${ext}`
    } else if (session.restoreTarget !== undefined) {
      // Restored crash-recovery copy: the restore prompt was the confirmation,
      // so Save writes straight back to the original — unless someone else
      // changed it since the restore.
      const currentSha = await sha256File(session.restoreTarget).catch(() => undefined)
      if (currentSha !== undefined && currentSha !== session.restoreTargetSha) {
        throw new Error(tm('errDiskChanged'))
      }
      targetPath = session.restoreTarget
    } else {
      // Plain in-place save: refuse to silently overwrite a file some other
      // program changed after this session opened it. Save As (above) skips
      // this guard on purpose — it patches the session snapshot, not the live
      // file, and writes to a path the user just confirmed, so it stays
      // usable as the escape hatch this error message points to. A file that
      // was deleted on disk is fine: saving recreates it.
      const currentSha = await sha256File(session.path).catch(() => undefined)
      if (currentSha !== undefined && currentSha !== session.sha256) {
        throw new Error(tm('errDiskChanged'))
      }
    }
    // The CSV write-back gets the same external-change guard as restoreTarget;
    // a deleted .csv is fine — the write recreates it.
    if (csvInPlace && session.csvSourcePath !== undefined) {
      const csvSha = await sha256File(session.csvSourcePath).catch(() => undefined)
      if (csvSha !== undefined && csvSha !== session.csvSourceSha) {
        throw new Error(tm('errDiskChanged'))
      }
    }

    const mutation = await writeWorkbookTo(client, session, request, targetPath)

    if (csvInPlace && session.csvSourcePath !== undefined && request.csvContent !== undefined) {
      // The temp copy already holds the saved bytes: refresh the session's
      // guard digest first, so a failed CSV write-back below leaves a
      // retryable session instead of stranding the next Save on
      // errDiskChanged against its own write.
      const savedSha = await sha256File(session.path).catch(() => undefined)
      if (savedSha !== undefined && entry.sessions.has(request.sessionId)) {
        entry.sessions.set(request.sessionId, { ...session, sha256: savedSha })
      }
      // UTF-8 BOM so Excel decodes the reopened file correctly.
      await writeFile(
        session.csvSourcePath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(request.csvContent, 'utf8')]),
      )
    }

    // The sidecar session still streams the pre-save bytes; swap it for a
    // fresh session over the saved file so future reads match the disk state.
    // The file is already on disk at this point: a rebuild failure must not
    // surface as "save failed" and make the user retry a save that landed.
    const quietUnsavedNew = targetPath === session.path && session.unsavedNew === true
    entry.sessions.delete(request.sessionId)
    let file: WorkbookFile
    try {
      await cleanupSessionResources({
        tempRoot: app.getPath('temp'),
        snapshotPath: session.snapshotPath,
        // A CSV in-place save keeps saving into the temp copy, and a quiet save of
        // an unsaved new workbook just wrote its backing file — the directory
        // must survive the session swap.
        importTempDir: csvInPlace || quietUnsavedNew ? undefined : session.importTempDir,
        closeSidecar: () => client.close(request.sessionId),
      })
      file = await openWorkbookSession(
        client,
        targetPath,
        entry.sessions,
        csvInPlace
          ? {
              csvImport: true,
              csvSourcePath: session.csvSourcePath,
              importTempDir: session.importTempDir,
            }
          : quietUnsavedNew
            ? {
                suggestSaveAs: session.suggestSaveAs,
                importTempDir: session.importTempDir,
                unsavedNew: true,
              }
            : undefined,
      )
    } catch (error) {
      console.error('[sheets] file saved but the session rebuild failed:', error)
      // Hand back a path-bearing stub so the caller reports a successful save
      // (and a reopen warning) rather than a failure. The stub is not a real
      // session — the renderer's reopen will fail and tell the user to reopen
      // the file — but the bytes on disk are correct and must not be reported
      // as a failed save. The cast is deliberate: filling the 15 optional
      // worksheet-metadata fields from a session that no longer exists would
      // invent data.
      const savedSha = await sha256File(targetPath).catch(() => undefined)
      file = {
        sessionId: request.sessionId,
        name: basename(targetPath),
        path: targetPath,
        sha256: savedSha ?? session.sha256,
        entryCount: 0,
        sheets: [...session.sheetNames.values()].map((name) => ({ name })),
        activeTab: 0,
        styles: [],
        dxfStyles: [],
        visuals: [],
        definedNames: [],
        readOnly: false,
      } as unknown as WorkbookFile
    }
    if (quietUnsavedNew && session.suggestSaveAs !== undefined) {
      // the temp path must not reach the title or recents; the recovery copy
      // is what a crash restores from, so it tracks the saved bytes
      try {
        await mkdir(recoveryDir(), { recursive: true })
        await copyFile(targetPath, recoveryPathFor(session.suggestSaveAs))
        rememberUnsavedNewRecovery(session.suggestSaveAs)
      } catch (error) {
        console.warn('[sheets] recovery copy of an unsaved new workbook failed:', error)
      }
      return { canceled: false, file, touchedEntries: mutation.touchedEntries }
    }
    // Notify shell (if running) so it can update the tab title and record the
    // saved path in recent files (mirrors the open hook; covers Save As + first
    // save after converting an .xls/.csv import). A CSV session's user-visible
    // file is the original .csv, not the temp copy the xlsx save landed on.
    workbookOpenedHook?.(
      event.sender,
      (csvInPlace ? session.csvSourcePath : undefined) ?? targetPath,
    )
    // The file on disk now carries these edits
    clearWorkbookRecovery(targetPath)
    if (session.suggestSaveAs !== undefined) {
      if (session.unsavedNew) forgetUnsavedNewRecovery(session.suggestSaveAs)
      else clearWorkbookRecovery(session.suggestSaveAs)
    }
    // Restored session saved (possibly Save As elsewhere): the unsaved work is
    // persisted, so the original's recovery copy must not re-offer it.
    if (session.restoreTarget !== undefined) clearWorkbookRecovery(session.restoreTarget)
    return { canceled: false, file, touchedEntries: mutation.touchedEntries }
  })

  // Chunked upload for edit sets too large to inline in one save request:
  // the renderer opens a transfer, streams ordered slices, then references
  // the transfer id from the save (or recovery) request that follows.
  ipcMain.handle(IPC_CHANNELS.saveEditsBegin, (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookSaveEditsBeginSchema.parse(input)
    if (!entry.sessions.has(request.sessionId)) throw new Error('Unknown workbook session.')
    entry.saveTransfers.begin(request)
  })

  ipcMain.handle(IPC_CHANNELS.saveEditsChunk, (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookSaveEditsChunkSchema.parse(input)
    // The chunk crosses the bridge and the IPC hop as a flat JSON string;
    // the edits stay untrusted input until they pass the cell-edit schema.
    entry.saveTransfers.addChunk({
      sessionId: request.sessionId,
      transferId: request.transferId,
      seq: request.seq,
      edits: saveEditsChunkArraySchema.parse(JSON.parse(request.editsJson)),
    })
  })

  // Best-effort cleanup from renderer failure paths; a no-op if the transfer
  // was already consumed or expired.
  ipcMain.handle(IPC_CHANNELS.saveEditsAbort, (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = workbookSaveEditsAbortSchema.parse(input)
    entry.saveTransfers.discard(request.transferId, request.sessionId)
  })

  // Crash-recovery copy of a dirty workbook: the same save pipeline with a
  // userData target, no session swap and no dialogs — best-effort, silent on failure.
  ipcMain.handle(IPC_CHANNELS.writeWorkbookRecovery, async (event, input: unknown) => {
    const entry = sessionFor(event)
    const request = resolveTransferredEdits(entry, workbookSaveRequestSchema.parse(input))
    const session = entry.sessions.get(request.sessionId)
    // A converted import has no original file to recover into (and a CSV
    // session's original can't hold the workbook bytes); a restored recovery
    // session is backed by the recovery copy itself — writing over the file
    // the sidecar streams from would corrupt the open session.
    if (
      !session ||
      (session.suggestSaveAs !== undefined && !session.unsavedNew) ||
      session.csvSourcePath !== undefined ||
      (session.restoreTarget !== undefined && !session.emptySource)
    )
      return { ok: false }
    if (session.automaticRecoveryDisabled) return { ok: false }
    // an unsaved new workbook recovers under the name its first save would get;
    // an empty original's session runs on a temp blank and recovers into the file the user opened
    const recoveryKey = session.unsavedNew
      ? session.suggestSaveAs!
      : session.emptySource
        ? (session.restoreTarget ?? session.path)
        : session.path
    try {
      await mkdir(recoveryDir(), { recursive: true })
      await writeWorkbookTo(entry.client, session, request, recoveryPathFor(recoveryKey))
      if (session.unsavedNew) rememberUnsavedNewRecovery(recoveryKey)
      return { ok: true }
    } catch (error) {
      console.warn('[sheets] recovery copy failed:', error)
      return { ok: false }
    }
  })

  ipcMain.handle(IPC_CHANNELS.closeWorkbook, async (event, sessionId: unknown) => {
    const entry = sessionFor(event)
    const validatedSessionId = z.string().uuid().parse(sessionId)
    entry.saveTransfers.discardSession(validatedSessionId)
    const session = entry.sessions.get(validatedSessionId)
    if (!entry.sessions.delete(validatedSessionId)) return
    if (session === undefined) return
    if (session.unsavedNew && session.suggestSaveAs !== undefined)
      forgetUnsavedNewRecovery(session.suggestSaveAs)
    await cleanupSessionResources({
      tempRoot: app.getPath('temp'),
      snapshotPath: session.snapshotPath,
      importTempDir: session.importTempDir,
      closeSidecar: () => entry.client.close(validatedSessionId),
    })
  })

  // Content-derived naming for AI-generated workbooks (sheets' analog of slides'
  // deckName): the renderer proposes a base name after an AI run lands; the file
  // is renamed only while it still carries the shell's auto-created untitled name.
  ipcMain.handle(
    IPC_CHANNELS.autoRenameWorkbook,
    (event, sessionId: unknown, baseName: unknown) => {
      const entry = sessionFor(event)
      const validatedSessionId = z.string().uuid().parse(sessionId)
      const session = entry.sessions.get(validatedSessionId)
      if (!session || !untitledWorkbookPaths.has(session.path)) return { renamed: false }
      const base = sanitizeAutoRenameBase(z.string().min(1).max(100).parse(baseName))
      if (!base) return { renamed: false }
      // An unsaved new workbook has no user-visible file to rename — it sits in
      // a temp directory that closing the tab discards. Retarget the suggested
      // Save As name instead, so the AI-derived name is what the first save
      // offers, and leave the mark in place for a later run. No rename on disk
      // and no open hook: the temp path must not reach the title or recents.
      if (session.suggestSaveAs !== undefined) {
        const suggestDir = dirname(session.suggestSaveAs)
        let suggested = join(suggestDir, `${base}.xlsx`)
        const taken = (p: string) =>
          p !== session.suggestSaveAs && (existsSync(p) || sheetsSuggestedPathTaken(p))
        for (let i = 2; taken(suggested) && i < 100; i++) {
          suggested = join(suggestDir, `${base}-${i}.xlsx`)
        }
        if (suggested === session.suggestSaveAs || taken(suggested)) return { renamed: false }
        // a failed move leaves the copy valid under the old name; a crash can still restore it
        if (session.unsavedNew && !retargetUnsavedNewRecovery(session.suggestSaveAs, suggested))
          return { renamed: false }
        entry.sessions.set(validatedSessionId, { ...session, suggestSaveAs: suggested })
        event.sender.send(IPC_CHANNELS.workbookRenamed, basename(suggested))
        return { renamed: true, name: basename(suggested) }
      }
      const dir = dirname(session.path)
      let target = join(dir, `${base}.xlsx`)
      for (let i = 2; existsSync(target) && i < 100; i++) target = join(dir, `${base}-${i}.xlsx`)
      if (existsSync(target) || target === session.path) return { renamed: false }
      try {
        renameSync(session.path, target)
      } catch (err) {
        console.warn('[sheets] auto-rename failed:', err)
        return { renamed: false }
      }
      untitledWorkbookPaths.delete(session.path)
      entry.sessions.set(validatedSessionId, { ...session, path: target })
      event.sender.send(IPC_CHANNELS.workbookRenamed, basename(target))
      // Same contract as open/save: shell updates the tab title and recents
      workbookOpenedHook?.(event.sender, target)
      return { renamed: true, name: basename(target) }
    },
  )

  ipcMain.handle(IPC_CHANNELS.openExternal, async (event, url: unknown) => {
    sessionFor(event)
    const validatedUrl = safeExternalUrl(url)
    if (!validatedUrl) {
      throw new Error('Only http(s) links can be opened.')
    }
    await shell.openExternal(validatedUrl)
  })

  // ── Chat attachments (same structure as the docs/slides files:* pipeline) ──

  ipcMain.handle(IPC_CHANNELS.filesPick, async (event): Promise<AttachmentAddResult | null> => {
    sessionFor(event)
    const selection = await openFileDialog(event, {
      title: tm('dlgAddAttachment'),
      filters: [
        { name: tm('filterSupported'), extensions: [...ATTACHMENT_EXTS] },
        { name: tm('filterAll'), extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (selection.canceled || selection.filePaths.length === 0) return null
    return collectAttachments(selection.filePaths)
  })

  ipcMain.handle(IPC_CHANNELS.filesAdd, (event, paths: unknown): AttachmentAddResult => {
    sessionFor(event)
    return collectAttachments(z.array(z.string().min(1).max(1024)).max(50).parse(paths))
  })

  ipcMain.handle(
    IPC_CHANNELS.filesRead,
    async (
      event,
      filePath: unknown,
      offset: unknown,
      maxChars: unknown,
    ): Promise<AttachmentReadResult> => {
      sessionFor(event)
      const validatedPath = z.string().min(1).max(1024).parse(filePath)
      const name = basename(validatedPath)
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      if (!ATTACHMENT_EXTS.has(ext)) return { ok: false, error: tm('errUnsupportedExt', { ext }) }
      if (ATTACHMENT_IMAGE_EXTS.has(ext)) {
        return { ok: false, error: tm('errImageNoText') }
      }
      try {
        const text = await extractAttachmentText(validatedPath)
        const start = Math.max(0, Math.floor(Number(offset)) || 0)
        const size = Math.min(Math.max(1, Math.floor(Number(maxChars)) || 1), 48_000)
        return {
          ok: true,
          name,
          totalChars: text.length,
          offset: start,
          text: text.slice(start, start + size),
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // Image attachments read raw bytes → base64; the renderer puts them into the
  // user message's images for multimodal input
  ipcMain.handle(IPC_CHANNELS.filesReadImage, (event, filePath: unknown): AttachmentImageResult => {
    sessionFor(event)
    const validatedPath = z.string().min(1).max(1024).parse(filePath)
    const name = basename(validatedPath)
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const mime = ATTACHMENT_IMAGE_MIME[ext]
    if (!mime) return { ok: false, error: `${name}: ${tm('errNotImage')}` }
    try {
      const stat = statSync(validatedPath)
      if (stat.size > ATTACHMENT_IMAGE_MAX_BYTES) {
        return { ok: false, error: `${name}: ${tm('errImageTooLarge')}` }
      }
      return { ok: true, base64: readFileSync(validatedPath).toString('base64'), mime }
    } catch {
      return { ok: false, error: `${name}: ${tm('errUnreadable')}` }
    }
  })

  // Clipboard-pasted images (screenshots and other bitmaps without a local
  // path): persisted to a temp file, then go through the regular attachment flow
  ipcMain.handle(
    IPC_CHANNELS.filesAddPastedImage,
    (event, data: unknown, ext: unknown): AttachmentAddResult => {
      sessionFor(event)
      const filePath = savePastedImage(data, ext)
      return filePath
        ? collectAttachments([filePath])
        : { accepted: [], rejected: [tm('errNotImage')] }
    },
  )
}

/**
 * Resolve a save request's sheet ops / name mappings and write the workbook through
 * the sidecar. Split out of the save handler so a crash-recovery copy can reuse the
 * exact same pipeline with a different targetPath.
 */
async function writeWorkbookTo(
  client: XlsxSidecarClient,
  session: SessionInfo,
  request: WorkbookSaveRequest,
  targetPath: string,
): Promise<Awaited<ReturnType<typeof saveWorkbookViaSidecar>>> {
  // Sheet ops resolve first: added sheets have Univer ids the session map
  // doesn't know, so cell edits into them resolve through the op's name.
  const addedSheetNames = new Map<string, string>()
  // Added sheet id → file name of the sheet whose part seeds the new part.
  const duplicateSources = new Map<string, string>()
  const renames: { sheetName: string; newName: string }[] = []
  const removals: string[] = []
  const hiddenChanges: { sheetName: string; hidden: boolean }[] = []
  const tabColorStates: { sheetName: string; color: string | null }[] = []
  let orderChanged = false
  for (const op of request.sheetOps) {
    if (op.kind === 'add-sheet') {
      addedSheetNames.set(op.sheetId, op.name)
      continue
    }
    if (op.kind === 'duplicate-sheet') {
      // The renderer resolves duplicate chains to a sheet the file knows,
      // so the source must be in the session map.
      const sourceName = session.sheetNames.get(op.sourceSheetId)
      if (!sourceName) throw new Error(`Unknown duplicate source ${op.sourceSheetId}.`)
      addedSheetNames.set(op.sheetId, op.name)
      duplicateSources.set(op.sheetId, sourceName)
      continue
    }
    if (op.kind === 'reorder-sheets') {
      orderChanged = true
      continue
    }
    const sheetName = addedSheetNames.get(op.sheetId) ?? session.sheetNames.get(op.sheetId)
    if (!sheetName) throw new Error(`Unknown worksheet ${op.sheetId}.`)
    if (op.kind === 'rename-sheet') renames.push({ sheetName, newName: op.newName })
    else if (op.kind === 'set-sheet-hidden') {
      hiddenChanges.push({ sheetName, hidden: op.hidden })
    } else if (op.kind === 'set-sheet-tab-color') {
      tabColorStates.push({ sheetName, color: op.color })
    } else removals.push(sheetName)
  }
  const renameByOriginal = new Map(renames.map((rename) => [rename.sheetName, rename.newName]))
  const resolveSheetName = (sheetId: string): string => {
    const sheetName = addedSheetNames.get(sheetId) ?? session.sheetNames.get(sheetId)
    if (!sheetName) throw new Error(`Unknown worksheet ${sheetId}.`)
    return sheetName
  }
  let sheetPlan: SheetEditPlan | undefined
  if (request.sheetOps.some((op) => op.kind !== 'set-sheet-tab-color')) {
    sheetPlan = {
      renames,
      additions: [...addedSheetNames].map(([sheetId, name]) => ({
        name,
        sourceSheetName: duplicateSources.get(sheetId),
      })),
      removals,
      hiddenChanges,
      orderChanged,
      order: request.sheetOrder.map((sheetId) => {
        const original = resolveSheetName(sheetId)
        return addedSheetNames.has(sheetId)
          ? original
          : (renameByOriginal.get(original) ?? original)
      }),
    }
  }

  const edits: CellEdit[] = request.edits.map((edit) => ({
    sheetName: resolveSheetName(edit.sheetId),
    row: edit.row,
    column: edit.column,
    writeValue: edit.writeValue,
    cell: { value: edit.value, formula: edit.formula },
    style: edit.style,
    rich: edit.rich,
    styleReset: edit.styleReset,
  }))
  const bulkConstantFills = (request.bulkConstantFills ?? []).map(({ sheetId, ...fill }) => ({
    sheetName: resolveSheetName(sheetId),
    ...fill,
  }))
  const opsBySheet = new Map<string, SheetStructuralOps['ops'][number][]>()
  for (const op of request.structuralOps) {
    const sheetName = resolveSheetName(op.sheetId)
    const sheetOps = opsBySheet.get(sheetName) ?? []
    if ('range' in op) {
      sheetOps.push({ kind: op.kind, range: op.range })
    } else if ('size' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, size: op.size })
    } else if ('level' in op) {
      sheetOps.push({
        kind: op.kind,
        start: op.start,
        end: op.end,
        level: op.level,
        ...(op.collapsed === undefined ? {} : { collapsed: op.collapsed }),
      })
    } else if ('summaryBelow' in op) {
      sheetOps.push({
        kind: op.kind,
        summaryBelow: op.summaryBelow,
        summaryRight: op.summaryRight,
      })
    } else if ('hidden' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, hidden: op.hidden })
    } else if ('style' in op) {
      sheetOps.push({ kind: op.kind, start: op.start, end: op.end, style: op.style })
    } else if ('before' in op) {
      sheetOps.push({ kind: op.kind, index: op.index, count: op.count, before: op.before })
    } else {
      sheetOps.push({ kind: op.kind, index: op.index, count: op.count })
    }
    opsBySheet.set(sheetName, sheetOps)
  }
  const structuralOps: SheetStructuralOps[] = [...opsBySheet].map(([sheetName, ops]) => ({
    sheetName,
    ops,
  }))
  const filterStates = request.filterStates.map((state) => ({
    sheetName: resolveSheetName(state.sheetId),
    filter: state.filter,
    hiddenRows: state.hiddenRows,
    visibilityRange: state.visibilityRange,
  }))
  const linksBySheet = new Map<string, { row: number; column: number; target: string | null }[]>()
  for (const link of request.hyperlinkEdits) {
    const sheetName = resolveSheetName(link.sheetId)
    const sheetLinks = linksBySheet.get(sheetName) ?? []
    sheetLinks.push({ row: link.row, column: link.column, target: link.target })
    linksBySheet.set(sheetName, sheetLinks)
  }
  const hyperlinkEdits = [...linksBySheet].map(([sheetName, links]) => ({
    sheetName,
    edits: links,
  }))
  const cfStates = request.cfStates.map((state) => ({
    sheetName: resolveSheetName(state.sheetId),
    rules: state.rules,
  }))
  const dvStates = request.dvStates.map((state) => ({
    sheetName: resolveSheetName(state.sheetId),
    rules: state.rules,
  }))
  const sheetProtections = request.sheetProtections.map(({ sheetId, ...state }) => ({
    sheetName: resolveSheetName(sheetId),
    ...state,
  }))
  const protectedRangeStates = request.protectedRangeStates.map((state) => ({
    sheetName: resolveSheetName(state.sheetId),
    ranges: state.ranges,
  }))
  const pageSetupStates = request.pageSetupStates.map(({ sheetId, ...state }) => ({
    sheetName: resolveSheetName(sheetId),
    ...state,
  }))
  const noteStates = request.noteStates.map(({ sheetId, notes }) => ({
    sheetName: resolveSheetName(sheetId),
    notes,
  }))
  const visualAdditions = request.visualAdditions.map((addition) => ({
    sheetName: resolveSheetName(addition.sheetId),
    anchor: addition.anchor,
    chart: addition.chart,
    shape: addition.shape,
    image: addition.image,
  }))
  const tableAdditions = request.tableAdditions.map((table) => ({
    sheetName: resolveSheetName(table.sheetId),
    area: table.area,
    name: table.name,
    columnNames: table.columnNames,
    style: table.style,
    bandedRows: table.bandedRows,
    options: {
      headerRow: table.headerRow,
      totalsRow: table.totalsRow,
      firstColumn: table.firstColumn,
      lastColumn: table.lastColumn,
      bandedColumns: table.bandedColumns,
      filterButton: table.filterButton,
    },
  }))
  const tableEdits = (request.tableEdits ?? []).map(({ sheetId, ...edit }) => ({
    ...edit,
    sheetName: resolveSheetName(sheetId),
  }))
  const pivotAdditions = request.pivotAdditions.map((pivot) => ({
    sheetName: resolveSheetName(pivot.sheetId),
    sourceSheetName: resolveSheetName(pivot.sourceSheetId),
    sourceArea: pivot.sourceArea,
    location: pivot.location,
    name: pivot.name,
    fieldNames: pivot.fieldNames,
    rowFieldIndices: pivot.rowFieldIndices,
    columnFieldIndex: pivot.columnFieldIndex,
    pageFieldIndices: pivot.pageFieldIndices,
    pageLevelItems: pivot.pageLevelItems,
    pageItems: pivot.pageItems,
    rowItems: pivot.rowItems,
    rowLevelItems: pivot.rowLevelItems,
    rowLines: pivot.rowLines,
    columnItems: pivot.columnItems,
    columnFieldIndices: pivot.columnFieldIndices,
    colLevelItems: pivot.colLevelItems,
    colLines: pivot.colLines,
    groupings: pivot.groupings,
    filters: pivot.filters,
    rowHiddenItems: pivot.rowHiddenItems,
    colHiddenItems: pivot.colHiddenItems,
    values: pivot.values,
  }))
  const sparklineAdditions = request.sparklineAdditions.map(({ sheetId, ...group }) => ({
    sheetName: resolveSheetName(sheetId),
    ...group,
  }))
  // Recalculated formula values: sheetId → file sheet name, the same
  // resolution the cell edits use.
  const formulaValuesBySheet = new Map<
    string,
    { row: number; column: number; value: string | number | boolean | null | { error: string } }[]
  >()
  for (const cell of request.formulaValues) {
    const sheetName = resolveSheetName(cell.sheetId)
    const list = formulaValuesBySheet.get(sheetName) ?? []
    list.push({ row: cell.row, column: cell.column, value: cell.value })
    formulaValuesBySheet.set(sheetName, list)
  }
  const formulaValues = [...formulaValuesBySheet].map(([sheetName, cells]) => ({
    sheetName,
    cells,
  }))
  const mutation = await saveWorkbookViaSidecar({
    client,
    // The snapshot, not the live path: the save base must be the bytes this
    // session's pending edits were made against, regardless of what other
    // programs did to the file since.
    sourcePath: session.snapshotPath,
    targetPath,
    edits,
    bulkConstantFills,
    structuralOps,
    chartEdits: request.chartEdits,
    // Located by package-absolute drawingPath, so no sheet-name mapping.
    visualEdits: request.visualEdits,
    sheetPlan,
    filterStates,
    hyperlinkEdits,
    cfStates,
    dvStates,
    sheetProtections,
    tabColorStates,
    definedNamesState: request.definedNamesState,
    themeState: request.themeState,
    workbookProtectionState: request.workbookProtectionState,
    protectedRangeStates,
    visualAdditions,
    pageSetupStates,
    noteStates,
    tableAdditions,
    tableEdits,
    pivotAdditions,
    sparklineAdditions,
    formulaValues,
    pivotCacheRefreshPaths: request.pivotCacheRefreshPaths,
    // Output-area expansion from layout growth: sheetId → sheet name; the part
    // path is resolved by the gateway.
    pivotRefreshUpdates: request.pivotRefreshUpdates.map((update) => ({
      cachePath: update.cachePath,
      sheetName: resolveSheetName(update.sheetId),
      newOutputRef: update.newOutputRef,
      ...(update.relayout === undefined
        ? {}
        : {
            relayout: (({ sheetId: _sheetId, sourceSheetId, ...rest }) => ({
              ...rest,
              sourceSheetName: resolveSheetName(sourceSheetId),
            }))(update.relayout),
          }),
    })),
  })
  return mutation
}

/** Copies the workbook into the temp snapshot dir; the copy is the session's
 * save base (see SessionInfo.snapshotPath). */
async function snapshotWorkbook(path: string): Promise<string> {
  const dir = join(app.getPath('temp'), 'yiioffice-sheets-sessions')
  await mkdir(dir, { recursive: true })
  const snapshotPath = join(dir, `${randomUUID()}.xlsx`)
  await copyFile(path, snapshotPath)
  return snapshotPath
}

let cachedShortDate: string | undefined

/// Derived from the OS region (not the UI language) and shared with the
/// gateway's save-side numFmtId mapping via setSystemShortDate.
function systemShortDate(): string {
  if (cachedShortDate === undefined) {
    cachedShortDate = shortDatePatternForSystemLocale(app.getSystemLocale())
    setSystemShortDate(cachedShortDate)
  }
  return cachedShortDate
}

/** the tab died between prepare and open: release the temp copy and any name reserved for it */
async function discardPreparedOpen(prepared: {
  openPath: string
  importTempDir?: string | undefined
}): Promise<void> {
  unsavedNewWorkbooks.delete(prepared.openPath)
  if (prepared.importTempDir !== undefined)
    await cleanupImportTempDirectory(app.getPath('temp'), prepared.importTempDir)
}

async function openWorkbookSession(
  client: XlsxSidecarClient,
  path: string,
  sessions: Map<string, SessionInfo>,
  options?: {
    suggestSaveAs?: string | undefined
    csvImport?: boolean | undefined
    csvSourcePath?: string | undefined
    emptyCsv?: boolean | undefined
    importTempDir?: string | undefined
    restoreTarget?: string | undefined
    emptySource?: boolean | undefined
    unsavedNew?: boolean | undefined
  },
): Promise<WorkbookFile> {
  const {
    suggestSaveAs,
    csvImport,
    csvSourcePath,
    emptyCsv,
    importTempDir,
    restoreTarget,
    emptySource,
    unsavedNew,
  } = options ?? {}
  // Snapshot first, then the sidecar opens the snapshot (not the live path):
  // everything the session serves — cell reads, media, recalc, saves — comes
  // from the same bytes, even if the file on disk changes right after the
  // copy. The digest also describes exactly those bytes.
  const snapshotPath = await snapshotWorkbook(path)
  try {
    const [opened, digest, snapshotStat, restoreTargetSha, csvSourceSha] = await Promise.all([
      client
        .open(snapshotPath, getUiLang(), systemShortDate())
        .then((result) => sidecarOpenResultSchema.parse(result)),
      sha256File(snapshotPath),
      stat(snapshotPath),
      // Missing original (deleted since the crash) is fine: the write-back recreates it.
      restoreTarget === undefined
        ? Promise.resolve(undefined)
        : sha256File(restoreTarget).catch(() => undefined),
      csvSourcePath === undefined
        ? Promise.resolve(undefined)
        : sha256File(csvSourcePath).catch(() => undefined),
    ])
    sessions.set(opened.sessionId, {
      path,
      snapshotPath,
      sha256: digest,
      sheetNames: new Map(opened.sheets.map((sheet) => [sheet.id, sheet.name])),
      automaticRecoveryDisabled: !allowsAutomaticWorkbookRecovery(opened.sheets),
      ...(suggestSaveAs === undefined ? {} : { suggestSaveAs }),
      ...(csvImport ? { csvImport } : {}),
      ...(csvSourcePath === undefined ? {} : { csvSourcePath }),
      ...(csvSourceSha === undefined ? {} : { csvSourceSha }),
      ...(importTempDir === undefined ? {} : { importTempDir }),
      ...(restoreTarget === undefined ? {} : { restoreTarget }),
      ...(restoreTargetSha === undefined ? {} : { restoreTargetSha }),
      ...(emptySource ? { emptySource } : {}),
      ...(unsavedNew ? { unsavedNew } : {}),
    })
    unsavedNewWorkbooks.delete(path)
    return workbookFileSchema.parse({
      ...opened,
      // The renderer-facing path is what the user opened: for a restored
      // recovery copy that is the original file, not the copy under userData.
      path: restoreTarget ?? path,
      sha256: digest,
      fileBytes: snapshotStat.size,
      readOnly: false,
      needsSaveAs: suggestSaveAs !== undefined,
      ...(unsavedNew ? { unsavedNew: true } : {}),
      ...(csvSourcePath === undefined ? {} : { csvPath: csvSourcePath }),
      ...(emptyCsv ? { emptyCsv: true } : {}),
      restoredFromRecovery: restoreTarget !== undefined,
      automaticRecoveryDisabled: !allowsAutomaticWorkbookRecovery(opened.sheets),
    })
  } catch (error) {
    await rm(snapshotPath, { force: true }).catch(() => undefined)
    unsavedNewWorkbooks.delete(path)
    if (importTempDir !== undefined) {
      await cleanupImportTempDirectory(app.getPath('temp'), importTempDir)
    }
    throw error
  }
}

/// A 0-byte .xlsx is an empty workbook, not a corrupt one. The sidecar needs a
/// real archive, so a blank one opens from the temp dir with the original as
/// the write-back target (the restore path: Save writes it even with no edits).
async function openEmptyXlsx(path: string): Promise<{
  openPath: string
  importTempDir: string
  restoreTarget: string
  emptySource: true
}> {
  const directory = join(app.getPath('temp'), 'yiioffice-imports', randomUUID())
  await mkdir(directory, { recursive: true })
  const openPath = join(directory, basename(path))
  try {
    await writeFile(openPath, (await csvToXlsxBufferForOpen('', 'Sheet1')).buffer)
  } catch (error) {
    await cleanupImportTempDirectory(app.getPath('temp'), directory)
    throw error
  }
  return { openPath, importTempDir: directory, restoreTarget: path, emptySource: true }
}

/** which legacy charset an Excel CSV most likely uses, judged by the UI language */
function legacyCsvCharset(): string | undefined {
  const byLang: Partial<Record<Lang, string>> = {
    zh: 'gb18030',
  }
  return byLang[getUiLang()]
}

/// .xls and .tsv open as a converted copy in the temp dir; the session
/// remembers the original's .xlsx sibling as the Save As default. .csv converts
/// the same way but keeps its file identity, so Save writes values back to it.
async function prepareWorkbookForOpen(
  client: XlsxSidecarClient,
  path: string,
  contents?: WebContents | undefined,
  parent?: BrowserWindow | undefined,
  options?: { skipRecoveryPrompt?: boolean },
): Promise<{
  openPath: string
  suggestSaveAs?: string
  csvImport?: boolean
  csvSourcePath?: string
  emptyCsv?: boolean
  importTempDir?: string
  restoreTarget?: string
  emptySource?: boolean
  unsavedNew?: boolean
}> {
  // A shell-created "New spreadsheet" opens from a temp directory and has no
  // user-visible file yet: Save As produces it, and closing unsaved discards
  // the directory. The mark is consumed once the session exists (see
  // openWorkbookSession) so the name stays reserved through the open and a
  // reopened path is a normal file.
  const unsavedNew = unsavedNewWorkbooks.get(path)
  if (unsavedNew !== undefined) {
    const base = {
      suggestSaveAs: unsavedNew.suggestSaveAs,
      importTempDir: unsavedNew.tempDir,
      unsavedNew: true,
    }
    // a crash left work under this would-be name: offer it like a file's
    // recovery copy, opening the copy itself as the (still unsaved) workbook
    const recovery = pendingUnsavedNewRecoveryFor(unsavedNew.suggestSaveAs)
    if (recovery) {
      const choice =
        contents && !contents.isDestroyed()
          ? await promptRecoveryRestore(contents, unsavedNew.suggestSaveAs, recovery)
          : await promptRecoveryRestoreNative(parent)
      // the copy is what the recovery writer keeps overwriting, so the session
      // streams from the backing file, not from the copy
      if (choice === 'restore') {
        try {
          await copyFile(recovery, path)
        } catch (error) {
          await discardPreparedOpen({ openPath: path, importTempDir: unsavedNew.tempDir })
          throw error
        }
      } else if (choice === 'discard') forgetUnsavedNewRecovery(unsavedNew.suggestSaveAs)
    }
    return { openPath: path, ...base }
  }
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension !== 'csv' && extension !== 'tsv' && extension !== 'xls') {
    // Unsaved work from a lost session: offer the recovery copy. Restoring
    // opens it with restoreTarget pointing back at the original, so a plain
    // Save writes straight back over the file the user opened — the restore
    // prompt (which spells out the overwrite) was the confirmation.
    // Merge sources are read-only picks: never surface (or worse, discard)
    // another workbook's crash recovery from here.
    const recovery = options?.skipRecoveryPrompt ? undefined : pendingRecoveryFor(path)
    if (recovery) {
      const choice =
        contents && !contents.isDestroyed()
          ? await promptRecoveryRestore(contents, path, recovery)
          : await promptRecoveryRestoreNative(parent)
      if (choice === 'restore') return { openPath: recovery, restoreTarget: path }
      if (choice === 'discard') clearWorkbookRecovery(path)
    }
    if (extension === 'xlsx' && (await stat(path)).size === 0) return openEmptyXlsx(path)
    return { openPath: path }
  }
  const stem = basename(path).replace(/\.[^.]+$/, '')
  const directory = join(app.getPath('temp'), 'yiioffice-imports', randomUUID())
  await mkdir(directory, { recursive: true })
  const openPath = join(directory, `${stem}.xlsx`)
  let emptyCsv = false
  try {
    if (extension === 'csv' || extension === 'tsv') {
      const csvStat = await stat(path)
      if (csvStat.size > MAX_DELIMITED_IMPORT_BYTES) throw new Error(tm('errFileTooLarge'))
      const converted = await csvToXlsxBufferForOpen(
        decodeCsvBuffer(await readFile(path), legacyCsvCharset()),
        'Sheet1',
        // A .tsv's delimiter is declared by its extension, and sniffing by
        // frequency can get it wrong: annotation-heavy exports (gene
        // descriptions, database cross-references) hold comma-separated
        // lists, so a narrow table ends up with more commas than tabs and
        // every row shatters on the comma. A .csv keeps the sniff — the prose
        // guard in resolveImportDelimiter is what that path needs.
        extension === 'tsv' ? '\t' : undefined,
      )
      emptyCsv = converted.empty
      await writeFile(openPath, converted.buffer)
    } else {
      await client.convertWorkbook({ path, targetPath: openPath })
    }
  } catch (error) {
    await cleanupImportTempDirectory(app.getPath('temp'), directory)
    throw error
  }
  // CSV keeps its file identity: Save writes the values back to the original
  // .csv (Excel's behavior), so no Save As detour is suggested. Legacy .xls and
  // view-only .tsv route the first save through Save As to a fresh .xlsx —
  // writing values back to a .tsv would need a tab serializer this path lacks.
  return extension === 'csv'
    ? {
        openPath,
        importTempDir: directory,
        csvImport: true,
        csvSourcePath: path,
        ...(emptyCsv ? { emptyCsv: true } : {}),
      }
    : { openPath, importTempDir: directory, suggestSaveAs: path.replace(/\.[^.]+$/, '.xlsx') }
}

/** shell-injected items appended to the File menu (e.g. Back to Home) */
let extraFileMenuItems: MenuItemConstructorOptions[] = []

export function setSheetsExtraFileMenuItems(items: MenuItemConstructorOptions[]): void {
  extraFileMenuItems = items
}

/** tab mode: closes the sheets tab instead of the whole shell window (Cmd+W / role:'close') */
let closeActiveTabHook: (() => void) | null = null
export function setSheetsCloseTabHook(fn: (() => void) | null): void {
  closeActiveTabHook = fn
}

/// The ribbon has no File tab; file commands live in
/// the application menu and are forwarded to the renderer.
function installApplicationMenu(): void {
  const sendMenuAction = sendSheetsMenuAction
  const labels = appMenuLabels(getUiLang())
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: tm('menuFile'),
        submenu: [
          {
            label: tm('menuOpenWorkbook'),
            accelerator: 'CmdOrCtrl+O',
            click: () => sendMenuAction('open'),
          },
          ...(extraFileMenuItems.length > 0
            ? [{ type: 'separator' as const }, ...extraFileMenuItems]
            : []),
          { type: 'separator' },
          {
            label: tm('menuSave'),
            accelerator: 'CmdOrCtrl+S',
            click: () => sendMenuAction('save'),
          },
          {
            label: tm('menuSaveAs'),
            accelerator: 'Shift+CmdOrCtrl+S',
            click: () => sendMenuAction('save-as'),
          },
          { type: 'separator' },
          {
            label: tm('menuPrint'),
            accelerator: 'CmdOrCtrl+P',
            click: () => sendMenuAction('print'),
          },
          { type: 'separator' },
          {
            label: tm('menuExportPdf'),
            click: () => sendMenuAction('export-pdf'),
          },
          {
            label: tm('menuExportCsv'),
            click: () => sendMenuAction('export-csv'),
          },
          { type: 'separator' },
          closeActiveTabHook
            ? {
                label: process.platform === 'darwin' ? tm('menuClose') : tm('menuQuit'),
                accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+W' : 'CmdOrCtrl+Q',
                click: () => closeActiveTabHook?.(),
              }
            : process.platform === 'darwin'
              ? { role: 'close' as const, label: tm('menuClose') }
              : { role: 'quit' as const, label: tm('menuQuit') },
        ],
      },
      {
        label: tm('menuEdit'),
        submenu: [
          // role: 'editMenu' would bind ⌘Z to webContents.undo(), a text-editing
          // no-op that starves Univer of the shortcut — forward it instead.
          {
            label: tm('menuUndo'),
            accelerator: 'CmdOrCtrl+Z',
            click: () => sendMenuAction('undo'),
          },
          {
            label: tm('menuRedo'),
            accelerator: 'Shift+CmdOrCtrl+Z',
            click: () => sendMenuAction('redo'),
          },
          { type: 'separator' },
          { role: 'cut', label: labels.cut },
          { role: 'copy', label: labels.copy },
          { role: 'paste', label: labels.paste },
          { type: 'separator' },
          { role: 'selectAll', label: labels.selectAll },
        ],
      },
      // ⌘R is Fill Right and ⌘0/⌘+/⌘- hide columns / zoom the sheet; menu
      // accelerators would swallow them on macOS.
      viewMenuTemplate(labels, { devItems: !app.isPackaged, pageZoom: false }),
      windowMenuTemplate(process.platform, labels),
      helpMenuTemplate(labels),
    ]),
  )
}

/** stop the Rust sidecar (shell calls this from its own before-quit hook) */
export function stopSheetsSidecar(): void {
  sidecar?.stop()
  sidecar = null
}

export {
  installApplicationMenu as installSheetsMenu,
  startCaptureServer as startSheetsCaptureServer,
}

/**
 * Attaches a proxy to the main process's global fetch (same source as
 * slides-main.applyMainProcessProxy): main-process Node fetch (undici) ignores
 * the system proxy by default, so direct connections from mainland networks to
 * overseas LLM endpoints like api.anthropic.com time out or get rejected by
 * egress region (403 Request not allowed). Environment variables take priority;
 * otherwise the system proxy is read via session.resolveProxy() after app ready.
 */
async function applyMainProcessProxy(): Promise<void> {
  const setDispatcher = async (proxyUrl: string) => {
    try {
      const { ProxyAgent, setGlobalDispatcher } = await import('undici')
      setGlobalDispatcher(new ProxyAgent(proxyUrl))
      // strip user:pass credentials before logging
      console.log('[proxy] main-process fetch via', proxyUrl.replace(/\/\/[^@/]*@/, '//***@'))
    } catch (e) {
      console.warn('[proxy] failed to set ProxyAgent:', e)
    }
  }
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  if (envProxy) {
    await setDispatcher(envProxy)
    return
  }
  try {
    await app.whenReady()
    // PAC/rule proxies answer per-host: probe a well-known host
    const resolved = await electronSession.defaultSession.resolveProxy('https://www.example.com/')
    const m = /PROXY\s+([^;]+)/i.exec(resolved || '')
    if (m?.[1]) {
      await setDispatcher(`http://${m[1].trim()}`)
    } else {
      console.log('[proxy] system proxy = DIRECT, no dispatcher set')
    }
  } catch (e) {
    console.warn('[proxy] resolveProxy failed:', e)
  }
}

export function startSheetsStandalone(): void {
  registerRendererScheme()
  installNavigationGuard(app)
  installContextMenu(app, () => contextMenuLabels(getUiLang()))
  // YIIOFFICE_USER_DATA: test drivers point this at a scratch dir so automated
  // instances get their own userData AND single-instance lock (the lock is scoped
  // to userData), allowing parallel instances alongside a normal dev run.
  // Same dev-only hook as apps/slides/src/main/slides-main.ts.
  if (!app.isPackaged && process.env.YIIOFFICE_USER_DATA) {
    app.setPath('userData', process.env.YIIOFFICE_USER_DATA)
  }
  void applyMainProcessProxy()
  app.whenReady().then(() => {
    installRendererProtocol({ sheets: join(__dirname, '../renderer') })
    setUiLang(normalizeLang(process.env.YIIOFFICE_LANG ?? app.getLocale()))
    app.setAccessibilitySupportEnabled(true)
    installApplicationMenu()
    startCaptureServer()
    return createSheetsWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    stopSheetsSidecar()
  })
  app.on('activate', () => {
    if (!mainWindow) void createSheetsWindow()
  })
}

function resolveSidecarPath(): string {
  const executable = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
  if (runtime.sidecarPath) return runtime.sidecarPath
  if (process.env.XLSX_SIDECAR_PATH) return process.env.XLSX_SIDECAR_PATH
  if (app.isPackaged) return join(process.resourcesPath, 'native', executable)
  return join(app.getAppPath(), 'native', 'xlsx-engine', 'target', 'release', executable)
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function closeAllSessions(entry: {
  client: XlsxSidecarClient
  sessions: Map<string, SessionInfo>
}): Promise<void> {
  const sessions = [...entry.sessions.entries()]
  entry.sessions.clear()
  await Promise.allSettled(
    sessions.map(async ([sessionId, session]) => {
      await cleanupSessionResources({
        tempRoot: app.getPath('temp'),
        snapshotPath: session.snapshotPath,
        importTempDir: session.importTempDir,
        closeSidecar: () => entry.client.close(sessionId),
      })
    }),
  )
}
