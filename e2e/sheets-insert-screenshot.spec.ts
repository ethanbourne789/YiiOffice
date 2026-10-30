// ADAPTED FROM Electron e2e — sheets-insert-screenshot.spec.ts
import { test, expect } from './fixture'
import JSZip from 'jszip'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, screenshotPath, triggerSave } from './helpers'

const FIXTURE = resolve(__dirname, '../apps/sheets/fixtures/generated/compatibility-basic.xlsx')

async function xlsxListEntries(path: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(await readFile(path))
  return Object.keys(zip.files)
}

async function waitForWorkbook(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1_500)
}

test.describe('sheets: Insert → Screenshot', () => {
  test('captures a screen source and saves it into the workbook', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-screenshot-e2e-'))
    const workbook = join(scratch, 'screenshot.xlsx')
    await copyFile(FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-insert-screenshot',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      // openFile is not natively supported in browser mode; simulate via desktopApi if available
      await page.evaluate(async (filePath) => {
        const desk = (window as any).desktopApi
        if (desk && typeof desk.openFile === 'function') {
          await desk.openFile(filePath)
        }
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets)

      // NOTE: In Electron, the test stubbed desktopCapturer in the main process.
      // In browser mode, we cannot access Electron's desktopCapturer API.
      // Skipping the native capturer stub — the test focuses on the picker → capture
      // → insert → save pipeline. If browser media capture is available, it will
      // use the real source; otherwise this test may need test.skip() on headless CI.

      await sheets.getByRole('button', { name: 'Insert', exact: true }).click()
      await sheets.getByRole('button', { name: 'Screenshot' }).click()
      const dialog = sheets.getByRole('dialog', { name: 'Screenshot' })
      await expect(dialog).toBeVisible()

      const grid = dialog.locator('.screenshot-grid button')
      await expect(grid.first()).toBeVisible()
      await sheets.screenshot({ path: screenshotPath('screenshot-picker') })
      await grid.first().click()

      await expect(sheets.locator('.status-msg')).toContainText('Picture inserted', {
        timeout: 20_000,
      })
      await expect(dialog).not.toBeVisible()
      await expect(sheets.locator('.xlsx-image')).toBeVisible({ timeout: 15_000 })
      await sheets.screenshot({ path: screenshotPath('screenshot-inserted') })

      // NOTE: Electron used webContents.send('menu:action', 'save'). Use keyboard shortcut.
      await triggerSave(page)
      await expect(async () => {
        const listing = await xlsxListEntries(workbook)
        expect(listing.some((e) => e.startsWith('xl/media/'))).toBe(true)
      }).toPass({ timeout: 20_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-insert-screenshot')
    }
  })
})
