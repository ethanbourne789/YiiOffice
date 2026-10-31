// ADAPTED FROM Electron e2e — sheets-edit-polish.spec.ts
import { test, expect } from './fixture'
import JSZip from 'jszip'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, screenshotPath, triggerSave } from './helpers'

const FIXTURE = resolve(__dirname, '../apps/sheets/fixtures/generated/compatibility-basic.xlsx')

async function xlsxEntry(path: string, entry: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(path))
  const file = zip.file(entry)
  if (!file) throw new Error(`Entry not found: ${entry} in ${path}`)
  return file.async('text')
}

async function waitForWorkbook(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1_500)
}

test.describe('sheets: manual visual inserts are undoable', () => {
  test('undo removes an icon inserted from the ribbon', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-polish-e2e-'))
    const workbook = join(scratch, 'undo.xlsx')
    await copyFile(FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-edit-polish',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets)

      await sheets.getByRole('button', { name: 'Insert', exact: true }).click()
      await sheets.getByRole('button', { name: 'Icons' }).click()
      const dialog = sheets.getByRole('dialog', { name: 'Icons' })
      await expect(dialog).toBeVisible()
      await dialog.locator('.icons-grid button').first().click()
      await expect(dialog).not.toBeVisible({ timeout: 10_000 })
      await expect(sheets.locator('.xlsx-image')).toBeVisible({ timeout: 15_000 })

      // Put focus back on the grid so ⌘Z reaches Univer's shortcut handler.
      const grid = await sheets.evaluate(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
        }
        return null
      })
      if (!grid) throw new Error('worksheet canvas not found')
      await sheets.mouse.click(grid.x + 46 + 43, grid.y + 24 + 11 + 230)
      await sheets.keyboard.press('ControlOrMeta+z')
      await expect(sheets.locator('.xlsx-image')).not.toBeVisible({ timeout: 10_000 })
      await sheets.screenshot({ path: screenshotPath('undo-after') })

      await sheets.keyboard.press('ControlOrMeta+y')
      await expect(sheets.locator('.xlsx-image')).toBeVisible({ timeout: 10_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-edit-polish')
    }
  })
})

test.describe('sheets: freeze journal follows undo', () => {
  test('freezing then undoing leaves no pane in the saved file', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-polish-e2e-'))
    const workbook = join(scratch, 'freeze.xlsx')
    await copyFile(FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-edit-polish',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const sheets = await waitForRoute(page, '/sheets')
      await waitForWorkbook(sheets)

      await sheets.getByRole('button', { name: 'View', exact: true }).click()
      await sheets.getByRole('button', { name: 'Freeze Panes' }).click()
      await sheets.getByRole('option', { name: 'Freeze Top Row' }).click()
      await sheets.waitForTimeout(500)
      // Focus the grid so ⌘Z reaches Univer, then undo the freeze.
      const grid = await sheets.evaluate(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
        }
        return null
      })
      if (!grid) throw new Error('worksheet canvas not found')
      await sheets.mouse.click(grid.x + 46 + 43, grid.y + 24 + 11 + 46)
      await sheets.keyboard.press('ControlOrMeta+z')
      await sheets.waitForTimeout(500)
      // A cell edit keeps the workbook dirty so the save rewrites the sheet.
      await sheets.keyboard.type('marker', { delay: 30 })
      await sheets.keyboard.press('Enter')

      // NOTE: Electron used webContents.send('menu:action', 'save'). Use keyboard shortcut.
      await triggerSave(page)
      await expect(async () => {
        const xml = await xlsxEntry(workbook, 'xl/worksheets/sheet1.xml')
        expect(xml).toContain('marker')
        expect(xml).not.toContain('<pane')
      }).toPass({ timeout: 20_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-edit-polish')
    }
  })
})
