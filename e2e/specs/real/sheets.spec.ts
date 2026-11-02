import { test, expect } from '../../fixtures/app'
import { readXlsxXml, writeXlsx } from '../../fixtures/documents'
import { saveWithKeyboard } from '../../fixtures/editors'
import { stat } from 'node:fs/promises'

/**
 * Sheets editor.
 *
 * The grid is a canvas (Univer), so the assertions stay on things that are
 * observable without pixel-diffing: the grid mounts, the workbook's own sheet
 * name arrives from the Go workbook engine, and a save rewrites the file as a
 * readable package that still carries the seeded value. That last one is the
 * point — the old Electron suite proved saves by reading the file back, and the
 * Go rewrite is exactly where a migration loses data silently.
 */

test.describe('sheets: open, save', () => {
  test('an .xlsx opens with its own workbook and sheet name', async ({ app }) => {
    const path = await writeXlsx(app.workDir, 'book.xlsx', 'seed')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'book.xlsx' })

    // Grid canvas (Univer paints into <canvas>, not DOM cells).
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })
    // The sheet name comes from the parsed workbook, not from the UI defaults.
    await expect(editor.ui.locator('body')).toContainText('Sheet1')
    // Ribbon + status bar prove the renderer booted against the real backend.
    await expect(editor.ui.locator('.ribbon').first()).toBeVisible()
    await expect(editor.ui.locator('body')).toContainText(/就绪|Ready/)
  })

  test('Ctrl+S rewrites the workbook without losing the seeded cell', async ({ app }) => {
    const path = await writeXlsx(app.workDir, 'resave.xlsx', 'seed-value')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'resave.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    const before = (await stat(path)).size
    await saveWithKeyboard(app.page)

    // The Go workbook engine rewrites the package (it re-serialises shared
    // strings and styles), so the size moves; the seeded value must survive.
    await expect
      .poll(async () => readXlsxXml(path).then((xml) => xml.includes('seed-value')), {
        timeout: 30_000,
        message: 'saved workbook should still contain the seeded cell',
      })
      .toBe(true)
    expect((await stat(path)).size).toBeGreaterThan(0)
    expect(before).toBeGreaterThan(0)
  })

  // Recorded, not hidden: typing into a cell and saving is the one journey the
  // canvas cannot be driven through yet — Univer paints the grid and exposes no
  // per-cell DOM handle, so a test needs a coordinate model (cell → pixel) plus
  // the app's own selection state to click the right cell reliably. The sheet
  // round-trip above covers the save path in the meantime.
  test.fixme('typing into A1 and saving writes the value back', async ({ app }) => {
    const path = await writeXlsx(app.workDir, 'edit.xlsx', 'seed')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'edit.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    const nameBox = editor.ui.locator('[data-u-comp="defined-name"] input')
    await nameBox.click()
    await nameBox.fill('A1')
    await app.page.keyboard.press('Enter')
    await app.page.keyboard.type('E2E-CELL')
    await app.page.keyboard.press('Enter')
    await saveWithKeyboard(app.page)

    await expect
      .poll(async () => readXlsxXml(path).then((xml) => xml.includes('E2E-CELL')), {
        timeout: 30_000,
      })
      .toBe(true)
  })
})
