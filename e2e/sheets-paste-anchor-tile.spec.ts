// ADAPTED FROM Electron e2e — sheets-paste-anchor-tile.spec.ts
import { test, expect } from './fixture'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute, waitForDocumentReady } from './helpers'

// the preload exposes window.__yiiofficeDebug only under this env var
process.env.YIIOFFICE_DEBUG_HOOKS = '1'

/**
 * Regression for "copied C2:E2, selected C2:C14, paste didn't repeat" (user
 * report): pasting a copied row into a single-column multi-row
 * target must repeat the row for each selected row, spilling the source's
 * width — Excel/Google Sheets bulk-fill.
 */

interface SheetFacade {
  getActiveWorkbook(): {
    getActiveSheet(): {
      getRange(
        row: number,
        column: number,
        rows: number,
        columns: number,
      ): {
        setValues(v: unknown[][]): Promise<unknown>
        activate(): unknown
        getValues(): unknown[][]
      }
    }
  }
}

function facade(sheets: Page): Promise<void> {
  return sheets.evaluate(() => undefined)
}

test.describe('sheets: paste repeats into an anchor-shaped target', () => {
  test('a copied 1x3 row tiles down a 4x1 selection', async ({ page, context }) => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-anchor-tile-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-paste-anchor-tile',
    })
    await setupPageAfterLaunch(launched, page, context)
    try {
      // app.evaluate with electronApp.setPath is not available in browser mode.
      await page.goto('/sheets')
      const sheets = await waitForRoute(page, '/sheets')
      await waitForDocumentReady(sheets)
      await sheets.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
        timeout: 30_000,
      })
      await sheets.waitForTimeout(1_500)
      await facade(sheets)

      const grid = await sheets.evaluate(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
        }
        return null
      })
      if (!grid) throw new Error('worksheet canvas not found')
      await sheets.mouse.click(grid.x + 46 + 43, grid.y + 24 + 12)

      // source row A1:C1, copy it
      await sheets.evaluate(async () => {
        const debug = (window as unknown as { __yiiofficeDebug: { univerAPI: SheetFacade } })
          .__yiiofficeDebug
        const sheet = debug.univerAPI.getActiveWorkbook().getActiveSheet()
        await sheet.getRange(0, 0, 1, 3).setValues([['a', 'b', 'c']])
        sheet.getRange(0, 0, 1, 3).activate()
      })
      await sheets.keyboard.press('Control+c')
      await sheets.waitForTimeout(300)

      // paste into the 4x1 anchor selection A2:A5
      await sheets.evaluate(() => {
        const debug = (window as unknown as { __yiiofficeDebug: { univerAPI: SheetFacade } })
          .__yiiofficeDebug
        debug.univerAPI.getActiveWorkbook().getActiveSheet().getRange(1, 0, 4, 1).activate()
      })
      await sheets.keyboard.press('Control+v')

      await expect(async () => {
        const values = await sheets.evaluate(() => {
          const debug = (window as unknown as { __yiiofficeDebug: { univerAPI: SheetFacade } })
            .__yiiofficeDebug
          return debug.univerAPI
            .getActiveWorkbook()
            .getActiveSheet()
            .getRange(1, 0, 4, 3)
            .getValues()
        })
        expect(values).toEqual([
          ['a', 'b', 'c'],
          ['a', 'b', 'c'],
          ['a', 'b', 'c'],
          ['a', 'b', 'c'],
        ])
      }).toPass({ timeout: 10_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-paste-anchor-tile')
    }
  })
})
