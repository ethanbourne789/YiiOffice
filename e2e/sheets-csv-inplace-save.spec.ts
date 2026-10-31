// ADAPTED FROM Electron e2e — sheets-csv-inplace-save.spec.ts
import { test, expect } from './fixture'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, mockDialogAccept, triggerSave } from './helpers'

async function waitForWorkbook(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1_500)
}

/** center of cell A1: right of the ~46px row header, below the ~24px column header */
async function cellA1(page: Page): Promise<{ x: number; y: number }> {
  const grid = await page.evaluate(() => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
    }
    return null
  })
  if (!grid) throw new Error('worksheet canvas not found')
  return { x: grid.x + 46 + 43, y: grid.y + 24 + 12 }
}

test.describe('sheets: a CSV keeps its identity through Save', () => {
  test('blank-line CSV opens with one friendly notice and an open action', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-empty-csv-e2e-'))
    const csvSource = join(scratch, 'empty.csv')
    await writeFile(csvSource, '\r\n'.repeat(5_927))

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-empty-csv',
      openFile: csvSource,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: csvSource })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, csvSource)

      const sheets = await waitForRoute(page, '/sheets')
      await expect(sheets.locator('.csv-empty-notice')).toBeVisible({ timeout: 30_000 })
      await expect(sheets.getByText('The CSV file has no data.')).toHaveCount(1)
      await expect(
        sheets.locator('.csv-empty-notice').getByRole('button', { name: /^Open Workbook/ }),
      ).toBeVisible()
      // NOTE: In Electron, the shell tab title was verified. In browser mode,
      // tab state may differ — skipping shell tab assertion.
      await expect(sheets.locator('.status-bar')).not.toContainText('Error invoking')
    } finally {
      await closeAndSaveVideo(launched, 'sheets-empty-csv')
    }
  })

  test('Cmd+S writes the edit back to the original .csv', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-csv-save-e2e-'))
    const csvSource = join(scratch, 'data.csv')
    await writeFile(csvSource, 'name,amount\r\nalpha,10\r\n')

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-csv-inplace-save',
      openFile: csvSource,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: csvSource })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, csvSource)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets)

      const a1 = await cellA1(sheets)
      await sheets.mouse.click(a1.x, a1.y)
      await expect(sheets.locator('[data-u-comp="defined-name"] input')).toHaveValue('A1')
      await sheets.keyboard.type('Hello', { delay: 50 })
      await sheets.keyboard.press('Enter')

      // Accept any dialog (e.g. "keep this format?" question) — Continue as CSV
      mockDialogAccept(page)

      // NOTE: In Electron, save was triggered via IPC (webContents.send('menu:action', 'save')).
      // In browser mode, use keyboard shortcut. The save may be refused politely until
      // the preload finishes — retry.
      await expect(async () => {
        await triggerSave(page)
        const bytes = await readFile(csvSource)
        expect(bytes.subarray(3).toString('utf8')).toContain('Hello')
      }).toPass({ timeout: 30_000, intervals: [2_000] })

      const bytes = await readFile(csvSource)
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
      const text = bytes.subarray(3).toString('utf8')
      expect(text).toContain('Hello,amount')
      expect(text).toContain('alpha,10')
      // No Save As detour: the folder holds only the .csv, no stray .xlsx.
      expect(readdirSync(scratch)).toEqual(['data.csv'])
    } finally {
      await closeAndSaveVideo(launched, 'sheets-csv-inplace-save')
    }
  })
})
