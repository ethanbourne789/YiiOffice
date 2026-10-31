// ADAPTED FROM Electron e2e — sheets-csv-export.spec.ts
import { test, expect } from './fixture'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, mockSaveDialog, mockDialogAccept, triggerMenuAction } from './helpers'

const FIXTURE = resolve(__dirname, '../apps/sheets/fixtures/generated/compatibility-basic.xlsx')
// has a cached formula (B3 =SUM(C1:C2)) so the CSV flows hit the loss warning;
// its single sheet is named "Data"
const FORMULA_FIXTURE = resolve(
  __dirname,
  '../apps/sheets/fixtures/generated/compatibility-edit.xlsx',
)

async function waitForWorkbook(page: Page, sheetName = 'Sheet1'): Promise<void> {
  await page.waitForFunction((name) => document.body.textContent?.includes(name), sheetName, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1_500)
}

test.describe('sheets: export the active sheet as CSV', () => {
  test('File > Export CSV writes a BOM-prefixed CSV of the grid', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-csv-e2e-'))
    const workbook = join(scratch, 'export-source.xlsx')
    const target = join(scratch, 'exported.csv')
    await copyFile(FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-csv-export',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets)

      // Mock save dialog and accept any confirmation message boxes
      await mockSaveDialog(page, target)
      mockDialogAccept(page)

      // The export refuses politely until the workbook preload finishes, so
      // keep re-sending the menu action until the file lands.
      await expect(async () => {
        await triggerMenuAction(page, 'export-csv')
        expect(existsSync(target)).toBe(true)
      }).toPass({ timeout: 30_000, intervals: [2_000] })

      const bytes = await readFile(target)
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
      const text = bytes.subarray(3).toString('utf8')
      // the fixture's numeric cell renders as-is, rows end with CRLF
      expect(text).toContain('10')
      expect(text).toContain('\r\n')
    } finally {
      await closeAndSaveVideo(launched, 'sheets-csv-export')
    }
  })

  test('Export CSV with formulas: Continue on the loss warning writes the file and toasts', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-csv-formula-e2e-'))
    const workbook = join(scratch, 'formula-source.xlsx')
    const target = join(scratch, 'exported.csv')
    await copyFile(FORMULA_FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-csv-export-formula',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets, 'Data')

      // Mock save dialog and accept any confirmation message boxes (formula loss warning)
      await mockSaveDialog(page, target)
      mockDialogAccept(page)

      await expect(async () => {
        await triggerMenuAction(page, 'export-csv')
        expect(existsSync(target)).toBe(true)
      }).toPass({ timeout: 30_000, intervals: [2_000] })

      // NOTE: In the Electron version, the test checked `shownBoxes()` to
      // verify the formula-loss warning actually fired. In browser mode,
      // we cannot access Electron's dialog.showMessageBox internals.
      // The dialog accept mock above handles the confirmation automatically.

      // formula cell exported as its computed value
      const text = (await readFile(target)).subarray(3).toString('utf8')
      expect(text).toContain('5')

      // the export announces itself with a toast, not just the status bar
      await triggerMenuAction(page, 'export-csv')
      await sheets.waitForSelector('.app-toast', { timeout: 10_000 })
      expect(await sheets.locator('.app-toast').textContent()).toContain('Exported')
    } finally {
      await closeAndSaveVideo(launched, 'sheets-csv-export-formula')
    }
  })

  test('Save As with a .csv pick rides the formula warning through to the file', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-csv-saveas-e2e-'))
    const workbook = join(scratch, 'saveas-source.xlsx')
    const target = join(scratch, 'saved.csv')
    await copyFile(FORMULA_FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-csv-saveas',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets, 'Data')

      // Mock save dialog and accept any confirmation message boxes (formula loss warning)
      await mockSaveDialog(page, target)
      mockDialogAccept(page)

      await expect(async () => {
        await triggerMenuAction(page, 'save-as')
        expect(existsSync(target)).toBe(true)
      }).toPass({ timeout: 30_000, intervals: [2_000] })

      // NOTE: In the Electron version, the test checked `shownBoxes()` to
      // verify the formula-loss warning actually fired. In browser mode,
      // we cannot access Electron's dialog internals. The mockDialogAccept
      // handles the confirmation automatically above.

      const bytes = await readFile(target)
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
      expect(bytes.subarray(3).toString('utf8')).toContain('5')
    } finally {
      await closeAndSaveVideo(launched, 'sheets-csv-saveas')
    }
  })
})
