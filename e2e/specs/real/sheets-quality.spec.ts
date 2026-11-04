import { test, expect } from '../../fixtures/app'
import { readXlsxXml, writeXlsx } from '../../fixtures/documents'
import { enableSheetsDebugHooks, pollUniver, typeIntoCell } from '../../fixtures/sheets'
import type { EditorHandle } from '../../fixtures/editors'
import { resolve } from 'node:path'

/**
 * Real-backend regressions for the four recent quality fixes:
 *  1. Save-loss warning (cancel keeps the edit off disk, continue persists it).
 *  2. Encrypted .xlsx password prompt (wrong password retries, right one opens).
 *  3. Ctrl+P converges on PDF export instead of printing.
 *  4. An export failure raises the system-notification call (observed at the
 *     Wails runtime boundary; a native toast cannot be asserted headlessly).
 *
 * The server build has no native save/print dialogs, so the print tests record
 * the bridge call the shell makes — that is the layer the "no print dialog"
 * fix changes (window.print is asserted to stay untouched).
 */

const ENCRYPTED_FIXTURE = resolve(__dirname, '../../fixtures/files/encrypted.xlsx')

/** Turn the sheet's autosave toggle off if an earlier pref left it on. */
async function ensureAutoSaveOff(editor: EditorHandle) {
  const toggle = editor.ui.locator('.autosave-toggle')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('class'))?.includes('on')) await toggle.click()
}

interface BridgeProbeWindow extends Window {
  __e2eExportCalls?: { fileName?: string; hasHtml: boolean }[]
  __e2ePrintCalls?: number
}

async function exportCalls(editor: EditorHandle) {
  return editor.frame.evaluate(
    () => (window as unknown as BridgeProbeWindow).__e2eExportCalls ?? [],
  )
}

async function printCalls(editor: EditorHandle) {
  return editor.frame.evaluate(() => (window as unknown as BridgeProbeWindow).__e2ePrintCalls ?? 0)
}

/** The app only allows save/print once the streamed preload reports done. */
async function waitForFullyLoaded(editor: EditorHandle) {
  await expect(editor.ui.locator('body')).toContainText(/已完整加载|fully loaded/i, {
    timeout: 45_000,
  })
}

test('save-loss warning: cancel leaves the edit off disk, continue writes it', async ({ app }) => {
  const path = await writeXlsx(app.workDir, 'save-loss.xlsx', 'seed-loss')
  const editor = await app.openFile(path, { kind: 'sheets', title: 'save-loss.xlsx' })
  await expect(editor.ui.locator('#univer-container')).toBeVisible({ timeout: 30_000 })
  await waitForFullyLoaded(editor)
  await ensureAutoSaveOff(editor)

  await typeIntoCell(app.page, editor, 'A2', 'E2E-LOSS-KEEP')
  // Print gridlines is a Page Layout setting the Go SaveRequest cannot persist,
  // so it must trip the unsaved-object warning on the next save.
  await editor.ui.getByRole('button', { name: /Page Layout|页面布局/ }).first().click()
  await editor.ui.locator('.check-column').first().locator('.check-item').nth(1).click()
  // The journal entry proves the print setting is flagged as unpersistable.
  await expect(editor.ui.locator('.status-msg')).toContainText(
    /将打印网格线|will print gridlines/i,
    { timeout: 5_000 },
  )

  // Ctrl+S is a shell-level chord; click the ribbon Save so the request goes
  // through the same handleSave path from inside the editor frame.
  const saveButton = editor.ui.locator('.qa-btn').first()
  await saveButton.click()
  const dialog = editor.ui.locator('.dialog-backdrop')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('.recovery-list')).toBeVisible()

  // Cancel: nothing may reach the file.
  await editor.ui.locator('.dialog-backdrop .secondary').click()
  await expect(dialog).toHaveCount(0)
  await expect(editor.ui.locator('.status-msg')).toContainText(/取消|Cancel/)

  const afterCancel = await readXlsxXml(path)
  expect(afterCancel).not.toContain('E2E-LOSS-KEEP')

  // Continue: the persistable part (the cell edit) is written.
  await saveButton.click()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await editor.ui.locator('.dialog-backdrop .primary-action').click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(async () => (await readXlsxXml(path)).includes('E2E-LOSS-KEEP'), { timeout: 20_000 })
    .toBe(true)
})

test('encrypted xlsx: password prompt retries and opens with the right password', async ({ app }) => {
  enableSheetsDebugHooks(app.page)
  const editor = await app.openFile(ENCRYPTED_FIXTURE, { kind: 'sheets', title: 'encrypted.xlsx' })

  const dialog = editor.ui.locator('.workbook-password-dialog')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(dialog).toContainText('encrypted.xlsx')

  // Cancel keeps the (empty) tab open and reports it in the status bar.
  await dialog.locator('.secondary').click()
  await expect(dialog).toHaveCount(0)
  await expect(editor.ui.locator('.status-msg')).toContainText(/取消|Cancel/)

  // Reopen and walk the retry loop: wrong password shows the inline error, the
  // right one loads the workbook with its real cell content.
  await app.closeAllTabs()
  const reopened = await app.openFile(ENCRYPTED_FIXTURE, { kind: 'sheets', title: 'encrypted.xlsx' })
  const retryDialog = reopened.ui.locator('.workbook-password-dialog')
  await expect(retryDialog).toBeVisible({ timeout: 30_000 })
  const input = retryDialog.locator('.workbook-password-input')
  await input.fill('wrong-password')
  await retryDialog.locator('.primary-action').click()
  await expect(retryDialog.locator('.workbook-password-error')).toBeVisible({ timeout: 15_000 })
  await expect(retryDialog.locator('.workbook-password-error')).toContainText(/密码|password/i)

  await input.fill('s3cret')
  await retryDialog.locator('.primary-action').click()
  await expect(retryDialog).toHaveCount(0, { timeout: 20_000 })
  await expect(reopened.ui.locator('#univer-container canvas').first()).toBeVisible({
    timeout: 45_000,
  })
  await pollUniver(
    reopened,
    "(api, wb) => wb.getActiveSheet().getRange('A1').getValue()",
    (value) => String(value) === 'encrypted-secret',
    'encrypted workbook A1 should hold the fixture value',
    30_000,
  )
})

/**
 * Wrap `desktopApi` before the sheets frame boots. `exportPdf` is replaced so
 * the spec can assert the Ctrl+P route and the failure notification without a
 * native save dialog (the server build has none).
 */
function stubDesktopApi(page: import('@playwright/test').Page, mode: 'cancel' | 'fail') {
  return page.addInitScript((behavior) => {
    const w = window as unknown as Record<string, unknown>
    w.__e2ePrintCalls = 0
    w.__e2eExportCalls = [] as { fileName?: string; hasHtml: boolean }[]
    window.print = () => {
      w.__e2ePrintCalls = (w.__e2ePrintCalls as number) + 1
    }
    let api: Record<string, unknown> | undefined
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      get: () => api,
      set: (value: Record<string, unknown> | undefined) => {
        api = value
        if (!value) return
        value.exportPdf = async (request: { fileName?: string; html?: string }) => {
          ;(w.__e2eExportCalls as { fileName?: string; hasHtml: boolean }[]).push({
            fileName: request?.fileName,
            hasHtml: typeof request?.html === 'string',
          })
          if (behavior === 'fail') throw new Error('e2e-pdf-failed')
          return { canceled: true }
        }
      },
    })
  }, mode)
}

test('Ctrl+P exports PDF through the bridge and never calls window.print', async ({ app }) => {
  await stubDesktopApi(app.page, 'cancel')
  const path = await writeXlsx(app.workDir, 'print-route.xlsx', 'seed-print')
  const editor = await app.openFile(path, { kind: 'sheets', title: 'print-route.xlsx' })
  await expect(editor.ui.locator('#univer-container')).toBeVisible({ timeout: 30_000 })
  await waitForFullyLoaded(editor)

  // Commit a cell edit so the grid owns focus, then send the chord like a user.
  await typeIntoCell(app.page, editor, 'A1', 'seed-print')
  await app.page.keyboard.press('Control+p')

  await expect
    .poll(async () => (await exportCalls(editor)).length, { timeout: 15_000 })
    .toBe(1)
  const calls = await exportCalls(editor)
  expect(calls[0].fileName).toMatch(/\.pdf$/)
  expect(calls[0].hasHtml).toBe(true)
  expect(await printCalls(editor)).toBe(0)
  await expect(editor.ui.locator('.status-msg')).toContainText(/取消|Cancel/)
})

test('a failed PDF export raises the system-notification call', async ({ app }) => {
  await stubDesktopApi(app.page, 'fail')
  const runtimeBodies: string[] = []
  app.page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/wails/')) return
    const body = request.postData()
    if (body) runtimeBodies.push(body)
  })

  const path = await writeXlsx(app.workDir, 'print-fail.xlsx', 'seed-fail')
  const editor = await app.openFile(path, { kind: 'sheets', title: 'print-fail.xlsx' })
  await expect(editor.ui.locator('#univer-container')).toBeVisible({ timeout: 30_000 })
  await waitForFullyLoaded(editor)
  await typeIntoCell(app.page, editor, 'A1', 'seed-fail')
  await app.page.keyboard.press('Control+p')

  await expect(editor.ui.locator('.status-msg')).toContainText('e2e-pdf-failed', { timeout: 15_000 })
  // systemNotify posts to /wails/runtime; the body carries the same message.
  await expect
    .poll(() => runtimeBodies.some((body) => body.includes('e2e-pdf-failed')), { timeout: 15_000 })
    .toBe(true)
  expect(await printCalls(editor)).toBe(0)
})
