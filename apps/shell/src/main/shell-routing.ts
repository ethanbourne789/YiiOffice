/// One dispatch pipeline for every path the shell opens: the open-dialog
/// filter, the "unsupported file" warning, the drop-from-OS bridge, and the
/// per-kind new-tab flows. index.ts and the IPC modules all funnel into this.

import { onFromShell } from './ipc-guard'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { app, dialog } from 'electron'

import { atomicWriteFile } from './atomic-write'
import { DOCX_RE, PDF_RE, PPTX_RE, TEXT_RE, XLSX_RE } from './app-routing'
import { blankXlsxBuffer } from '@yiioffice/xlsx-gateway/gateway/csv-import'
import { blankPdfBuffer } from '../../../pdf/src/main/blank-pdf'
import {
  recordRecentFile,
  uniquePathIn,
} from '../../../docs/src/main/docs-main'
import {
  hasActiveQueuedWorkbook,
  markSheetsUnsavedNew,
  markSheetsUntitledPath,
  sendSheetsMenuAction,
  sheetsSuggestedPathTaken,
  unmarkSheetsUnsavedNew,
} from '../../../sheets/src/main/sheets-main'
import { markPdfUntitledPath } from '../../../pdf/src/main/pdf-main'
import { DROP_OPEN_CHANNEL } from '@yiioffice/electron-utils/drop-open'
import { handleDroppedFiles } from './dropped-files'
import { showErrorDialog } from './error-dialog'
import { focusDetachedByPath } from './detached-windows'
import { revealShellWindow, shellWindow, tabManager } from './shell-state'
import { tm } from './shell-i18n'
import { bindPendingDir, newFileDir } from './shell-folders'

// ---- routing: one dispatch function for every open path ----

/**
 * Single source of truth for the open-dialog filter. Includes the
 * legacy .doc/.ppt binaries so they are selectable and surface the explicit
 * "not supported" dialog via openDocumentPath instead of being grayed out.
 */
const OPEN_DIALOG_EXTENSIONS = [
  'docx',
  'doc',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'tsv',
  'pptx',
  'ppt',
  'pdf',
  'md',
  'markdown',
  'txt',
  'json',
]

function notifyUnsupportedFile(filePath: string): void {
  const ext = extname(filePath).slice(1).toLowerCase() || basename(filePath)
  showAppWarning(tm('errUnsupportedExt', { ext }))
}

/** shell-hosted warning box; focused when a shell window exists, standalone otherwise */
function showAppWarning(message: string): void {
  const options = { type: 'warning' as const, message }
  if (shellWindow) {
    shellWindow.show()
    shellWindow.focus()
    void dialog.showMessageBox(shellWindow, options)
  } else {
    void dialog.showMessageBox(options)
  }
}

/**
 * Files dropped from the OS into any renderer arrive via installDropOpenBridge
 * and route through the normal File > Open pipeline; detached editor windows
 * can host the drop target, so the shell must reveal itself after opening.
 */
export const droppedFilesDeps = () => ({
  openDocumentPath,
  revealShellWindow,
  showWarning: showAppWarning,
  unsupportedMessage: (exts: string[]) => tm('errUnsupportedExt', { ext: exts.join(', ') }),
})

function registerDroppedFilesIpc(): void {
  onFromShell(DROP_OPEN_CHANNEL, (_event, raw: unknown) =>
    handleDroppedFiles(raw, droppedFilesDeps()),
  )
}

/** the single router: extension decides which module owns the file; false = nothing opened */
function openDocumentPath(filePath: string): boolean {
  const opened = routeDocumentPath(filePath)
  
  return opened
}

/**
 * Open a just-written export. Unlike File > Open, an already-open PDF tab is
 * reloaded from disk so a re-export to the same path shows the new bytes
 * instead of the previous in-memory document (which may also hold unsaved
 * annotations). In-memory edits on that tab are discarded — Save would
 * overwrite the file we just exported.
 */
function openGeneratedDocument(filePath: string): boolean {
  if (tabManager && PDF_RE.test(filePath)) {
    const existing = tabManager.findPdfTabByPath(filePath)
    if (existing) {
      tabManager.reloadTab(existing)
      tabManager.activateTab(existing)
      return true
    }
  }
  return openDocumentPath(filePath)
}

function routeDocumentPath(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  // a detached editor window already shows this file — focus it, never a second copy
  if (focusDetachedByPath(filePath)) return true
  if (!tabManager) return false
  if (DOCX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findDocsTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openDocsTab(filePath)
    return true
  }
  if (XLSX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSheetsTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      tabManager.openSheetsTab(filePath)
      startQueuedWorkbookNudge()
    }
    return true
  }
  if (PPTX_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findSlidesTabByPath(filePath)
    if (existing) {
      tabManager.activateTab(existing)
    } else {
      // For a new tab the path goes through the pending queue; the renderer consumes it after mounting
      tabManager.openSlidesTab(filePath)
    }
    return true
  }
  if (PDF_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findPdfTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openPdfTab(filePath)
    return true
  }
  if (TEXT_RE.test(filePath)) {
    recordRecentFile(filePath)
    const existing = tabManager.findMarkdownTabByPath(filePath)
    if (existing) tabManager.activateTab(existing)
    else tabManager.openMarkdownTab(filePath)
    return true
  }
  notifyUnsupportedFile(filePath)
  return false
}

/**
 * "New spreadsheet" no longer drops a file in the default folder up front: the
 * blank workbook is created in a temp directory and its first Save goes through
 * Save As (the same path an .xls/.tsv import takes), so a new tab that is
 * closed without saving leaves nothing behind to delete by hand — the temp
 * directory is discarded with the session. The save pipeline still needs a real
 * file to edit, hence the backing workbook rather than the in-memory blank grid.
 * Falls back to a file in the default folder, then to the in-memory blank tab.
 */
async function newSheetTab(recoverAs?: string): Promise<void> {
  // recoverAs: the would-be path of a new workbook whose recovery copy
  // survived a crash; the sheets module offers it under that name
  const dir = newFileDir('sheet')
  let suggestedPath = recoverAs ?? uniquePathIn(dir, `${tm('untitledSheet')}.xlsx`)
  // nothing is on disk yet, so two new tabs would otherwise be promised the same name
  for (let i = 2; !recoverAs && sheetsSuggestedPathTaken(suggestedPath); i++)
    suggestedPath = uniquePathIn(dir, `${tm('untitledSheet')} ${i}.xlsx`)
  try {
    // under the import root so the session-close cleanup removes it like an import copy
    const tempDir = join(app.getPath('temp'), 'yiioffice-imports', randomUUID())
    mkdirSync(tempDir, { recursive: true })
    const backingPath = join(tempDir, basename(suggestedPath))
    // reserve the name before the first await so a second new tab picks another;
    // the first Save As starts from the name the file would have had
    markSheetsUnsavedNew(backingPath, suggestedPath, tempDir)
    try {
      await atomicWriteFile(backingPath, await blankXlsxBuffer())
    } catch (err) {
      unmarkSheetsUnsavedNew(backingPath)
      throw err
    }
    // eligible for content-derived auto-rename after the first AI generation
    markSheetsUntitledPath(backingPath)
    tabManager?.openSheetsTab(backingPath)
    startQueuedWorkbookNudge()
    // no recent-file entry yet: there is no user-visible file until it is saved
    
  } catch (err) {
    console.warn('[shell] temp workbook create failed, writing to the default folder:', err)
    try {
      await atomicWriteFile(suggestedPath, await blankXlsxBuffer())
      markSheetsUntitledPath(suggestedPath)
      // route directly (not via openDocumentPath) so creating a sheet emits
      // only file_new — the file_open event is reserved for opening existing files
      routeDocumentPath(suggestedPath)
    } catch (fallbackErr) {
      console.warn(
        '[shell] blank workbook create failed, opening in-memory blank tab:',
        fallbackErr,
      )
      try {
        tabManager?.openSheetsTab(undefined, { newBlank: true })
      } catch (finalErr) {
        surfaceNewTabError(finalErr)
      }
    }
  }
}

/**
 * A throw anywhere in the create-tab path (view creation, sidecar resolution,
 * renderer load) used to be swallowed by `void`-ed promises and ipc-invoke
 * rejections, so the click looked like a pure no-op — the exact "AI Sheets /
 * AI Slides do nothing" alpha report. Surface the failure instead.
 */
function surfaceNewTabError(err: unknown): void {
  console.error('[shell] new tab failed:', err)
  showErrorDialog(shellWindow, tm('errNewTabFailed'), err)
}

function newDocTab(): void {
  try {
    bindPendingDir('doc', tabManager?.openDocsTab(undefined, { newBlank: true }))
  } catch (err) {
    surfaceNewTabError(err)
  }
}

function newSlideTab(): void {
  try {
    bindPendingDir('slide', tabManager?.openSlidesTab())
  } catch (err) {
    surfaceNewTabError(err)
  }
}

function newMarkdownTab(): void {
  try {
    bindPendingDir('markdown', tabManager?.openMarkdownTab())
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/**
 * "New PDF" creates a blank single-page .pdf in the default folder up front and
 * opens it as a regular file tab — the PDF module has no in-memory blank mode
 * (openPdfTab requires a path), same pattern as the blank workbook above.
 */
async function newPdfTab(): Promise<void> {
  try {
    const filePath = uniquePathIn(newFileDir('pdf'), `${tm('untitledPdf')}.pdf`)
    await atomicWriteFile(filePath, await blankPdfBuffer())
    // Opt the file into content-derived auto-naming on its first save
    markPdfUntitledPath(filePath)
    // route directly (not via openDocumentPath) so creating a pdf emits only
    // file_new — same as the blank workbook above
    routeDocumentPath(filePath)
  } catch (err) {
    surfaceNewTabError(err)
  }
}

/**
 * The sheets renderer subscribes to menu actions only after Univer finishes
 * mounting (seconds on cold start), so a single 'open' can fire into the
 * void. Re-send until the queued workbook is consumed; consumption clears the
 * queue entry main-side (sheets-main), which stops the loop. The nudge only
 * reaches the active tab, so it gates on that tab's own queue entry —
 * background tabs from a multi-select Open pull their path themselves via the
 * renderer's has-queued-workbook poll.
 */
let workbookNudgeTimer: ReturnType<typeof setInterval> | null = null

function startQueuedWorkbookNudge(): void {
  if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
  const startedAt = Date.now()
  sendSheetsMenuAction('open')
  workbookNudgeTimer = setInterval(() => {
    if (
      !hasActiveQueuedWorkbook() ||
      Date.now() - startedAt > 30_000 ||
      !tabManager?.findSheetsTab()
    ) {
      if (workbookNudgeTimer) clearInterval(workbookNudgeTimer)
      workbookNudgeTimer = null
      return
    }
    sendSheetsMenuAction('open')
  }, 700)
}

// the menu, the home IPC module and index.ts all call into this file
export {
  newDocTab,
  newMarkdownTab,
  newPdfTab,
  newSheetTab,
  newSlideTab,
  notifyUnsupportedFile,
  openDocumentPath,
  openGeneratedDocument,
  registerDroppedFilesIpc,
  routeDocumentPath,
  showAppWarning,
  startQueuedWorkbookNudge,
  surfaceNewTabError,
  OPEN_DIALOG_EXTENSIONS,
}
