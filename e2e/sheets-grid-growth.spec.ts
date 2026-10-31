// ADAPTED FROM Electron e2e — sheets-grid-growth.spec.ts
import { test, expect } from './fixture'
import JSZip from 'jszip'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, triggerSave } from './helpers'

const FIXTURE = resolve(__dirname, '../apps/sheets/fixtures/generated/compatibility-basic.xlsx')

async function xlsxEntry(path: string, entry: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(path))
  const file = zip.file(entry)
  if (!file) throw new Error(`Entry not found: ${entry} in ${path}`)
  return file.async('text')
}

/** the name box holds the active cell address, so the viewport is readable without a test hook */
const NAME_BOX = '[data-u-comp="defined-name"] input'

/** "BA12" → { column: 52, row: 11 }, 0-based the way the grid counts */
function parseAddress(address: string): { column: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(address.trim())
  if (!m) throw new Error(`unreadable address: ${address}`)
  let column = 0
  for (const letter of m[1]!) column = column * 26 + (letter.charCodeAt(0) - 64)
  return { column: column - 1, row: Number(m[2]) - 1 }
}

async function waitForWorkbook(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
    timeout: 30_000,
  })
  await page.waitForTimeout(1_500)
}

test.describe('sheets: the grid grows ahead of the viewport', () => {
  test('the cursor can travel past column Z, and a cell written there survives save', async ({ page, context }) => {
    test.setTimeout(180_000)
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-grid-'))
    const workbook = join(scratch, 'grid-growth.xlsx')
    await copyFile(FIXTURE, workbook)

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-grid-growth',
      openFile: workbook,
    })
    await setupPageAfterLaunch(launched, page, context, { openFile: workbook })
    try {
      await page.evaluate((p) => {
        (window as any).aiOffice?.openPath(p)
      }, workbook)

      const p = await waitForRoute(page, '/sheets')
      await waitForWorkbook(p)

      // A1: right of the ~46px row header, below the ~24px column header
      const canvas = await p.evaluate(() => {
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect()
          if (r.width > 500 && r.height > 300) return { x: r.x, y: r.y }
        }
        return null
      })
      expect(canvas, 'worksheet canvas not found').not.toBeNull()
      await p.mouse.click(canvas!.x + 46 + 43, canvas!.y + 24 + 12)

      const nameBox = p.locator(NAME_BOX)
      await expect(nameBox).toHaveValue(/^[A-Z]+\d+$/)

      // Past Z. On a grid pinned to its data the cursor stops at Z1, because
      // AA1 is not a cell the sheet has.
      for (let i = 0; i < 30; i++) await p.keyboard.press('ArrowRight')
      await expect(nameBox).not.toHaveValue(/^Z\d+$/)
      const address = await nameBox.inputValue()
      const { column } = parseAddress(address)
      expect(
        column,
        `cursor stopped at ${address}, still inside the data-sized grid`,
      ).toBeGreaterThan(25)

      await p.keyboard.type('PastZ', { delay: 40 })
      await p.keyboard.press('Enter')

      // File > Save via keyboard shortcut (browser mode)
      await triggerSave(p)
      // The cursor reaching column 30 is not enough on its own: a grid that did
      // not grow would still let the selection wander past the edge, and the
      // write would land nowhere. Only the saved file proves the cell existed.
      await expect(async () => {
        expect(await xlsxEntry(workbook, 'xl/worksheets/sheet1.xml'), 'the cell past Z was never written').toContain('PastZ')
      }).toPass({ timeout: 20_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-grid-growth')
    }
  })
})
