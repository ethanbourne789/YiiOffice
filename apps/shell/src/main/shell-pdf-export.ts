/// Save As and the three local PDF→Office exports (docx / pptx / xlsx).
///
/// The three exports used to be three ~110-line near-copies of one flow. What
/// actually differs per format is four things: the converter, the field the
/// converted bytes live in, the destination extension/filter, and the
/// "transparency" report after a degraded conversion. Everything else — the
/// shared in-flight guard, the save dialog, the stale destination tab, the
/// password prompt loop, the progress bar, the atomic write and the error
/// dialog — lives in `runPdfOfficeExport` below and is shared.

import { handleFromShell } from './ipc-guard'
import { basename } from 'node:path'
import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'

import { showSaveDialogWithMemory } from '@yiioffice/electron-utils'
import { atomicCopyFile, atomicWriteFile } from './atomic-write'
import { showErrorDialog } from './error-dialog'
import { pdfSaveAsTarget } from './rename-validation'
import { activePdfTarget, pdfHostWindow, tabManager } from './shell-state'
import { currentLang, tm } from './shell-i18n'
import { openDocumentPath } from './shell-routing'
import {
  flushPdfSave,
  pdfIsDirty,
  requestPdfSaveAs,
  setPdfSaveAsInFlight,
} from '../../../pdf/src/main/pdf-main'
import { PDF_CHANNELS } from '../../../pdf/src/shared/ipc'
import {
  convertPdfFileToDocxLocalWithPrompt,
  PdfLoadError,
  type ConvertResult,
  type PageResult,
} from './pdf2docx-local'
import {
  convertPdfFileToPptxLocalWithPrompt,
  type ConvertPptxResult,
} from './pdf2pptx-local'
import {
  convertPdfFileToXlsxLocalWithPrompt,
  type ConvertXlsxResult,
} from './pdf2xlsx-local'
import { closePdfPasswordDialog, promptPdfPassword } from './pdf-password-dialog'

/**
 * Save As for pdf tabs: write pending edits to the picked path only, then open the copy.
 * Non-destructive: the original file is never written, and a cancelled dialog changes
 * nothing on disk (dialog first, no flush into the source).
 */
/** In-flight guard (same pattern as the exports): a re-trigger while the dialog
    or write is active must not start a second flow that overwrites the first one's
    waiter/target grant or clears its autosave pause early */
let savingPdfAs = false

export async function savePdfAs(): Promise<void> {
  const tab = activePdfTarget()
  const host = pdfHostWindow(tab)
  if (!tab?.filePath || !host || savingPdfAs) return
  savingPdfAs = true
  // Pause renderer autosave for the whole flow: the dialog blurs the window, and a
  // blur-triggered autosave would write the pending edits into the original file
  setPdfSaveAsInFlight(tab.webContents, true)
  try {
    const picked = await showSaveDialogWithMemory(dialog, host, {
      defaultPath: tab.filePath,
      filters: [{ name: tm('filterPdf'), extensions: ['pdf'] }],
    })
    const target = pdfSaveAsTarget(picked, tab.filePath)
    if (!target) return
    if (pdfIsDirty(tab.webContents.id)) {
      // Renderer applies its pending edits onto the source bytes; the pdf main
      // process writes the result to the picked path only
      if (!(await requestPdfSaveAs(tab.webContents, target))) return
    } else {
      // No pending edits → a byte-identical copy
      await atomicCopyFile(tab.filePath, target)
    }
    openDocumentPath(target)
  } catch (err) {
    console.error('[shell] pdf save as failed:', err)
    showErrorDialog(host, tm('errPdfSaveAsFailed'), err)
  } finally {
    savingPdfAs = false
    setPdfSaveAsInFlight(tab.webContents, false)
  }
}

// ---- the shared conversion flow ----

/** one guard for all three conversions: pdfium must never run two at once */
let exportingPdfOffice = false

interface PdfOfficeExport<Result> {
  /** destination extension, also used to rewrite the suggested file name */
  ext: 'docx' | 'pptx' | 'xlsx'
  filterKey: 'filterWord' | 'filterPpt' | 'filterExcel'
  busyKey: 'pdfDocxBusyMsg' | 'pdfPptxBusyMsg' | 'pdfXlsxBusyMsg'
  failedKey: 'pdfDocxFailedMsg' | 'pdfPptxFailedMsg' | 'pdfXlsxFailedMsg'
  /** the tab kind that would already show the destination file */
  findStaleTab: (path: string) => string | undefined
  convert: (
    pdfPath: string,
    promptPassword: (retry: boolean) => Promise<string | null>,
    onProgress: (page: number, total: number) => void,
  ) => Promise<Result | null>
  /** where the converted bytes sit in the result */
  bytes: (result: Result) => Uint8Array
  /** the "this page came out as an image / OCR text" transparency dialogs */
  report: (host: BrowserWindow, result: Result) => Promise<void>
}

async function runPdfOfficeExport<Result>(spec: PdfOfficeExport<Result>): Promise<void> {
  const tab = activePdfTarget()
  const host = pdfHostWindow(tab)
  if (!tab?.filePath || !host) return
  if (exportingPdfOffice) {
    void dialog.showMessageBox(host, {
      type: 'info',
      message: tm(spec.busyKey),
    })
    return
  }
  exportingPdfOffice = true
  try {
    if (!(await flushPdfSave(tab.webContents))) return
    const picked = await showSaveDialogWithMemory(dialog, host, {
      defaultPath: tab.filePath.replace(/\.pdf$/i, `.${spec.ext}`),
      filters: [{ name: tm(spec.filterKey), extensions: [spec.ext] }],
    })
    if (picked.canceled || !picked.filePath) return
    // If the destination is already open in a tab of the target kind, close it
    // first (its normal unsaved-changes guard applies) so the converted file
    // opens fresh instead of leaving a stale tab whose next save would clobber
    // the result.
    const staleTabId = spec.findStaleTab(picked.filePath)
    if (staleTabId) {
      await tabManager?.closeTab(staleTabId)
      tabManager?.activateTab(tab.id)
      if (spec.findStaleTab(picked.filePath)) return
    }
    host.setProgressBar(2)
    // encrypted PDFs prompt for the password (P23), looping on wrong entries;
    // null result = user cancelled the prompt → abort silently
    const pdfPath = tab.filePath
    const result = await spec.convert(
      pdfPath,
      (retry) =>
        promptPdfPassword(host, {
          fileName: basename(pdfPath),
          retry,
          busy: false,
          lang: currentLang(),
          strings: {
            title: tm('pdfPwdTitle'),
            prompt: tm('pdfPwdPrompt'),
            retryPrompt: tm('pdfPwdRetryPrompt'),
            ok: tm('pdfPwdOk'),
            cancel: tm('btnCancel'),
            verifying: tm('pdfPwdVerifying'),
            label: tm('pdfPwdLabel'),
            placeholder: tm('pdfPwdPlaceholder'),
            show: tm('pdfPwdShow'),
            hide: tm('pdfPwdHide'),
          },
        }),
      (page, total) => {
        if (host && !host.isDestroyed() && total > 0) {
          host.setProgressBar(page / total)
        }
      },
    )
    if (result === null) return
    // every export lands through a temporary file: a failed write must leave an
    // existing destination untouched
    await atomicWriteFile(picked.filePath, spec.bytes(result))
    await spec.report(host, result)
    openDocumentPath(picked.filePath)
  } catch (err) {
    if (host && !host.isDestroyed()) {
      // structured load failures (P22): password-protected / damaged PDFs get
      // a human-readable explanation instead of the raw PDFium error string
      void dialog.showMessageBox(host, {
        type: 'error',
        message: tm(spec.failedKey),
        detail: pdfLoadErrorDetail(err),
      })
    }
  } finally {
    // the prompt window may still be open when the loop exits through cancel
    // or a non-password error thrown mid-retry
    closePdfPasswordDialog()
    exportingPdfOffice = false
    if (host && !host.isDestroyed()) host.setProgressBar(-1)
  }
}

function pdfLoadErrorDetail(err: unknown): string {
  return err instanceof PdfLoadError
    ? err.code === 'password-required'
      ? tm('pdfDocxLocalEncryptedDetail')
      : err.code === 'unsupported'
        ? // certificate-based or otherwise unsupported security (FPDF
          // error 5): a hard PDFium boundary — no password can open it
          // locally, so the message must NOT suggest one (P24 C)
          tm('pdfDocxLocalUnsupportedEncDetail')
        : tm('pdfDocxLocalCorruptDetail')
    : err instanceof Error
      ? err.message
      : String(err)
}

/** pages that did not come out as real content, in page order */
function degradedPages(result: { pageResults: PageResult[] }): number[] {
  return result.pageResults.filter((r) => r.status !== 'ok').map((r) => r.page)
}

/** the encrypted-PDF password dialog is its own module; share its strings */
const pageNumberList = (pages: number[]) => pages.join(', ')

// ---- Export as Word (pdf2docx P4): in-process PDFium wasm, no cloud counterpart ----

export function exportPdfAsDocxLocal(): Promise<void> {
  return runPdfOfficeExport<ConvertResult>({
    ext: 'docx',
    filterKey: 'filterWord',
    busyKey: 'pdfDocxBusyMsg',
    failedKey: 'pdfDocxFailedMsg',
    findStaleTab: (path) => tabManager?.findDocsTabByPath(path),
    convert: convertPdfFileToDocxLocalWithPrompt,
    bytes: (result) => result.docx,
    report: async (host, result) => {
      // degrade transparency (plan §7.6 dual-track split): whole scan → say so
      // once; individual image-fallback pages → name them;
      // OCR-recovered scans ('ocr') are SUCCESSES — announce the recovery (the
      // user should proofread machine-read text), never the image-export notice
      const ocrPages = result.pageResults.filter((r) => r.status === 'ocr').map((r) => r.page)
      const imagePages = result.pageResults
        .filter((r) => r.status !== 'ok' && r.status !== 'ocr')
        .map((r) => r.page)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfDocxLocalScannedDetail'),
        })
      } else if (imagePages.length > 0 && ocrPages.length > 0) {
        // mixed documents surface BOTH facts in one dialog: which pages shipped
        // as images and which carry machine-read text the user should proofread
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail:
            tm('pdfDocxLocalDegradedDetail', { pages: pageNumberList(imagePages) }) +
            '\n\n' +
            tm('pdfDocxLocalOcrDetail', { pages: pageNumberList(ocrPages) }),
        })
      } else if (imagePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail: tm('pdfDocxLocalDegradedDetail', { pages: pageNumberList(imagePages) }),
        })
      } else if (ocrPages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalOcrMsg'),
          detail: tm('pdfDocxLocalOcrDetail', { pages: pageNumberList(ocrPages) }),
        })
      }
    },
  })
}

// ---- Export as PowerPoint (pdf2pptx P25): one slide per page ----

export function exportPdfAsPptxLocal(): Promise<void> {
  return runPdfOfficeExport<ConvertPptxResult>({
    ext: 'pptx',
    filterKey: 'filterPpt',
    busyKey: 'pdfPptxBusyMsg',
    failedKey: 'pdfPptxFailedMsg',
    findStaleTab: (path) => tabManager?.findSlidesTabByPath(path),
    convert: convertPdfFileToPptxLocalWithPrompt,
    bytes: (result) => result.pptx,
    report: async (host, result) => {
      // degrade transparency (same split as the Word export): whole scan vs
      // individual image-fallback pages
      const imagePages = degradedPages(result)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfPptxLocalScannedDetail'),
        })
      } else if (imagePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalDegradedMsg'),
          detail: tm('pdfDocxLocalDegradedDetail', { pages: pageNumberList(imagePages) }),
        })
      }
    },
  })
}

// ---- Export as Excel (pdf2xlsx P26): one worksheet per page ----

export function exportPdfAsXlsxLocal(): Promise<void> {
  return runPdfOfficeExport<ConvertXlsxResult>({
    ext: 'xlsx',
    filterKey: 'filterExcel',
    busyKey: 'pdfXlsxBusyMsg',
    failedKey: 'pdfXlsxFailedMsg',
    findStaleTab: (path) => tabManager?.findSheetsTabByPath(path),
    convert: convertPdfFileToXlsxLocalWithPrompt,
    bytes: (result) => result.xlsx,
    report: async (host, result) => {
      // degrade transparency: pages that could not become cells got a notice
      // row on their worksheet instead of an image (a spreadsheet has none)
      const noticePages = degradedPages(result)
      if (result.scannedDocument) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfDocxLocalScannedMsg'),
          detail: tm('pdfXlsxLocalScannedDetail'),
        })
      } else if (noticePages.length > 0) {
        await dialog.showMessageBox(host, {
          type: 'info',
          message: tm('pdfXlsxLocalSkippedMsg'),
          detail: tm('pdfXlsxLocalSkippedDetail', { pages: pageNumberList(noticePages) }),
        })
      }
    },
  })
}

// The pdf renderer's converter dropdown funnels into the same local conversion
// flows as the File menu items (dialogs, password prompt, in-flight guard included)
handleFromShell(PDF_CHANNELS.convertOffice, async (e, format: unknown) => {
  // only the active pdf tab may trigger a conversion (its file is the source)
  if (activePdfTarget()?.webContents.id !== e.sender.id) return
  if (format === 'docx') await exportPdfAsDocxLocal()
  else if (format === 'xlsx') await exportPdfAsXlsxLocal()
  else if (format === 'pptx') await exportPdfAsPptxLocal()
})
