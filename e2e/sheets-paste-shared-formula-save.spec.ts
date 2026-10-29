import { test, expect } from '@playwright/test'
import JSZip from 'jszip'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

async function xlsxEntry(path: string, entry: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(path))
  const file = zip.file(entry)
  if (!file) throw new Error(`Entry not found: ${entry} in ${path}`)
  return file.async('text')
}

// the preload exposes window.__yiiofficeDebug only under this env var
process.env.YIIOFFICE_DEBUG_HOOKS = '1'

/**
 * Regression for "tile-pasted cells vanish after save" (user
 * report): pasting a copied formula row into a taller target writes follower
 * cells as {si, v} — shared-formula id without formula text. The journal
 * must materialize those into real formulas; before the fix the follow-up
 * recalc mutation wiped them and the saved file lost the whole block.
 */
test.describe('sheets: tiled paste of formulas survives save', () => {
  test('followers keep their (shifted) formula in the saved xlsx', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-paste-save-'))
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'sheets-paste-shared-formula-save',
    })
    try {
      const { app, page } = launched
      await app.evaluate(({ app: electronApp }, dir) => {
        electronApp.setPath('documents', dir)
      }, scratch)
      const saveDir = join(scratch, 'YiiOffice')
      // the workbook has no file yet: Save answers the Save As picker (yiioffice#1036)
      await app.evaluate(
        ({ dialog }, target) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
        },
        join(saveDir, 'pasted.xlsx'),
      )

      const card = page.locator('.quick-card', { hasText: 'Sheets' })
      await expect(card).toBeVisible()
      await card.click()

      const sheets = await waitForPageWithUrl(app, '://sheets/')
      await sheets.waitForFunction(() => document.body.textContent?.includes('Sheet1'), null, {
        timeout: 30_000,
      })
      await sheets.waitForTimeout(1_500)

      const grid = await sheets.evaluate(() => {
        for (const canvas of document.querySelectorAll('canvas')) {
          const rect = canvas.getBoundingClientRect()
          if (rect.width > 500 && rect.height > 300) return { x: rect.x, y: rect.y }
        }
        return null
      })
      if (!grid) throw new Error('worksheet canvas not found')
      await sheets.mouse.click(grid.x + 46 + 43, grid.y + 24 + 12)

      // source row A1:C1: two values and a formula referencing the row
      await sheets.evaluate(async () => {
        const debug = (window as unknown as Record<string, unknown>).__yiiofficeDebug as {
          univerAPI: {
            getActiveWorkbook(): {
              getActiveSheet(): {
                getRange(
                  row: number,
                  column: number,
                  rows: number,
                  columns: number,
                ): { setValues(v: unknown[][]): Promise<unknown>; activate(): unknown }
              }
            }
          }
        }
        const sheet = debug.univerAPI.getActiveWorkbook().getActiveSheet()
        await sheet.getRange(0, 0, 1, 3).setValues([[10, 'hi', '=A1&"-x"']])
        sheet.getRange(0, 0, 1, 3).activate()
      })
      await sheets.keyboard.press('Control+c')
      await sheets.waitForTimeout(300)

      // tile-paste into A2:C3 — row 3's formula cell becomes an si follower
      await sheets.evaluate(() => {
        const debug = (window as unknown as Record<string, unknown>).__yiiofficeDebug as {
          univerAPI: {
            getActiveWorkbook(): {
              getActiveSheet(): {
                getRange(
                  row: number,
                  column: number,
                  rows: number,
                  columns: number,
                ): { activate(): unknown }
              }
            }
          }
        }
        debug.univerAPI.getActiveWorkbook().getActiveSheet().getRange(1, 0, 2, 3).activate()
      })
      await sheets.keyboard.press('Control+v')
      await sheets.waitForTimeout(800)

      await app.evaluate(({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('://sheets/'))
        wc?.send('menu:action', 'save')
      })

      await expect(async () => {
        const files = (await readdir(saveDir)).filter((f) => f.endsWith('.xlsx'))
        expect(files).toHaveLength(1)
        const xml = await xlsxEntry(join(saveDir, files[0]), 'xl/worksheets/sheet1.xml')
        // Both pasted repetitions keep values and a row-shifted formula. The
        // style index is deliberately not pinned: pasted cells carry whatever
        // xf the source had (none here), and Univer renumbers its style table
        // between releases, so `s="1"` was pinning an upstream allocation
        // rather than behaviour.
        expect(xml).toMatch(/<c r="A2"( s="\d+")?><v>10<\/v><\/c>/)
        expect(xml).toMatch(/<c r="A3"( s="\d+")?><v>10<\/v><\/c>/)
        expect(xml).toMatch(/<c r="C2"( s="\d+")?><f>A2&amp;"-x"<\/f><\/c>/)
        expect(xml).toMatch(/<c r="C3"( s="\d+")?><f>A3&amp;"-x"<\/f><\/c>/)
      }).toPass({ timeout: 15_000 })
    } finally {
      await closeAndSaveVideo(launched, 'sheets-paste-shared-formula-save')
    }
  })
})