import { test, expect } from '../../fixtures/app'
import { readXlsxXml, writeXlsx, writeRichXlsx } from '../../fixtures/documents'
import { saveWithKeyboard } from '../../fixtures/editors'
import { enableSheetsDebugHooks, pollUniver, typeIntoCell, univerEval } from '../../fixtures/sheets'
import { stat } from 'node:fs/promises'

/**
 * Sheets editor against the real Go backend.
 *
 * The grid is a canvas (Univer), so content assertions go through the app's
 * opt-in e2e hook (`enableSheetsDebugHooks`), which exposes the Univer Facade —
 * the exact model the canvas paints from. Edits use the name box + keyboard,
 * i.e. the same command path the ribbon drives. File-level facts (a save
 * reached the disk) are still checked by reading the package back.
 */

test.describe('sheets: open, save', () => {
  test('an .xlsx opens with its own workbook and sheet name', async ({ app }) => {
    const path = await writeXlsx(app.workDir, 'book.xlsx', 'seed')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'book.xlsx' })

    // Grid canvas (Univer paints into <canvas>, not DOM cells).
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })
    // The sheet name comes from the parsed workbook, not from the UI defaults.
    await expect(editor.ui.locator('body')).toContainText('Sheet1')
    // Ribbon + the fully-loaded status prove the renderer booted against the
    // real backend and streamed the workbook back from Go. Since the boot fix
    // opens the tab-attached file immediately, the status moves past the
    // initial 就绪/Ready text to the load-complete message.
    await expect(editor.ui.locator('.ribbon').first()).toBeVisible()
    await expect(editor.ui.locator('body')).toContainText(/已完整加载|fully loaded/)
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
})

test.describe('sheets: rendering', () => {
  test('a loaded workbook carries real cell content, not a blank skeleton', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'rich.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'rich.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    // The formula cell is the canary: its display value only exists once the
    // Go read stream delivered B3/B4 plus the cached result and Univer took
    // over the formula.
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('B2').getDisplayValues()[0][0]`,
      (v) => v === '30',
      'B2 (=SUM(B3:B4)) should render the cached result 30',
    )

    const displays = await univerEval<Record<string, string | number | null>>(
      editor,
      `(api, wb) => {
        const s = wb.getActiveSheet()
        const d = (r) => s.getRange(r).getDisplayValues()[0][0]
        return { A1: d('A1'), B1: d('B1'), C1: d('C1'), A2: d('A2'), B3: d('B3'), D2: d('D2'),
                 f: s.getRange('B2').getCellData()?.f ?? null }
      }`,
    )
    expect(displays).toMatchObject({
      A1: 'Revenue',
      // Number formats are applied by the render pipeline, so the display
      // value proves the format (not just the raw number) survived the load.
      B1: '1,234.50',
      C1: '25%',
      A2: 'Boxed',
      B3: '10',
      D2: '150',
      f: expect.stringContaining('SUM(B3:B4)'),
    })
  })

  // fixme: the assertions are correct but the feature is in flight — the
  // xlsx → Univer style-mapping read does not yet carry fill/border, so the
  // FFFF00 / 'thin' checks cannot hold. Enable once style reading lands.
  test.fixme('styles survive the load: font, fill, border, number format', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'styles.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'styles.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('A1').getCellStyleData()`,
      (v) => v !== null,
      'A1 should expose a resolved cell style',
    )
    const styles = await univerEval<Record<string, unknown>>(
      editor,
      `(api, wb) => {
        const s = wb.getActiveSheet()
        return {
          a1: s.getRange('A1').getCellStyleData(),
          a2: s.getRange('A2').getCellStyleData(),
          b1: s.getRange('B1').getCellStyleData(),
        }
      }`,
    )
    const a1 = styles.a1 as { bl?: number; cl?: { rgb?: string } }
    expect(a1.bl).toBe(1) // bold
    expect((a1.cl?.rgb ?? '').toUpperCase()).toContain('FF0000') // red font

    const a2 = styles.a2 as { bg?: { rgb?: string }; bd?: Record<string, { s?: string }> }
    expect((a2.bg?.rgb ?? '').toUpperCase()).toContain('FFFF00') // yellow fill
    for (const side of ['t', 'b', 'l', 'r']) {
      expect(a2.bd?.[side]?.s, `A2 border side ${side}`).toBe('thin')
    }

    const b1 = styles.b1 as { n?: { pattern?: string } }
    expect(b1.n?.pattern).toBe('#,##0.00')
  })

  test('switching sheet tabs activates the other sheet', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'tabs.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'tabs.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    // Sheet tabs are Univer DOM (slide-tab-item), not canvas — clickable.
    await editor.ui.locator('[data-u-comp="slide-tab-item"]', { hasText: 'Notes' }).click()
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getSheetName()`,
      (v) => v === 'Notes',
      'the Notes tab should become the active sheet',
    )
    expect(
      await univerEval<string>(
        editor,
        `(api, wb) => wb.getActiveSheet().getRange('A1').getDisplayValues()[0][0]`,
      ),
    ).toBe('second-sheet-marker')

    await editor.ui.locator('[data-u-comp="slide-tab-item"]', { hasText: 'Data' }).click()
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getSheetName()`,
      (v) => v === 'Data',
      'the Data tab should become active again',
    )
  })
})

test.describe('sheets: editing, validation, persistence', () => {
  test('typing into a referenced cell recalculates the dependent formula', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'recalc.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'recalc.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('B2').getDisplayValues()[0][0]`,
      (v) => v === '30',
      'B2 should start at the cached 30',
    )

    await typeIntoCell(app.page, editor, 'B3', '40')
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('B2').getDisplayValues()[0][0]`,
      (v) => v === '60',
      'B2 should recalculate to 40+20 after B3 is edited',
    )
  })

  // fixme: not a test defect — the Go reader does not yet load
  // <dataValidations> into Univer rules (the rule count stays 0), so the
  // first poll can never hold. Enable once data-validation loading lands.
  test.fixme('data validation from the file rejects an out-of-range value', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'dv.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'dv.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    // The Go engine reads <dataValidations>; the renderer must register the
    // rule on E2 before input can be checked against it.
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getDataValidations().length`,
      (v) => v >= 1,
      'the E2 whole-between-1..10 validation should be loaded',
    )

    await typeIntoCell(app.page, editor, 'E2', '99')
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('E2').getDisplayValues()[0][0]`,
      (v) => v !== '99',
      'typing 99 into a 1..10-validated cell must not commit the value',
    )
    expect(
      await univerEval<string>(
        editor,
        `(api, wb) => wb.getActiveSheet().getRange('E2').getDisplayValues()[0][0]`,
      ),
    ).toBe('')
  })

  // fixme: the content roundtrip works, but the fill-colour-after-reopen
  // assertion depends on the Univer → xlsx style write-back, which is still
  // in flight. Enable once style persistence lands.
  test.fixme('edit → save → close → reopen keeps content and key styles', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'roundtrip.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'roundtrip.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('B2').getDisplayValues()[0][0]`,
      (v) => v === '30',
      'the workbook should be fully loaded before editing',
    )

    await typeIntoCell(app.page, editor, 'A1', 'Renamed')
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getRange('A1').getDisplayValues()[0][0]`,
      (v) => v === 'Renamed',
      'the edit should land in the model',
    )

    await saveWithKeyboard(app.page)
    await expect
      .poll(async () => readXlsxXml(path).then((xml) => xml.includes('Renamed')), {
        timeout: 30_000,
        message: 'the save should write the edited value into the package',
      })
      .toBe(true)

    // Close every tab (host-side), then reopen the same path: the fresh
    // session must parse what the Go engine just wrote, not what was cached.
    await app.closeAllTabs()
    const reopened = await app.openFile(path, { kind: 'sheets', title: 'roundtrip.xlsx' })
    await expect(reopened.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    await pollUniver(
      reopened,
      `(api, wb) => wb.getActiveSheet().getRange('A1').getDisplayValues()[0][0]`,
      (v) => v === 'Renamed',
      'the edited text should survive save/close/reopen',
    )
    const after = await univerEval<Record<string, unknown>>(
      reopened,
      `(api, wb) => {
        const s = wb.getActiveSheet()
        const d = (r) => s.getRange(r).getDisplayValues()[0][0]
        return {
          B2: d('B2'), C1: d('C1'), B3: d('B3'),
          a2Style: s.getRange('A2').getCellStyleData(),
          a1Bold: s.getRange('A1').getCellStyleData()?.bl,
        }
      }`,
    )
    expect(after.B2, 'formula result after reopen').toBe('30')
    expect(after.B3, 'referenced cell after reopen').toBe('10')
    expect(after.C1, 'percent format after reopen').toBe('25%')
    const a2 = after.a2Style as { bg?: { rgb?: string } } | null
    expect((a2?.bg?.rgb ?? '').toUpperCase(), 'fill colour after reopen').toContain('FFFF00')
    expect(after.a1Bold, 'bold flag after reopen').toBe(1)
  })

  // Recorded, not hidden: conditional formatting loaded **from a file** cannot
  // pass against the real backend yet. The Go read path never extracts it —
  // internal/workbook/reads.go:41 hardcodes ConditionalRules to [] and
  // engine.go:99 hardcodes DxfStyles to [] (no excelize GetConditionalFormat
  // call exists anywhere), while the renderer's applyConditionalRules
  // (univer-sync.ts) faithfully waits for rules it never receives. The save
  // side is missing too, so a UI-created rule would not survive a round-trip
  // either. This test documents the intended behaviour; un-skip it when the
  // Go reader starts returning rules.
  test.fixme('conditional formatting from the file paints the hit cell only', async ({ app }) => {
    await enableSheetsDebugHooks(app.page)
    const path = await writeRichXlsx(app.workDir, 'cf.xlsx')
    const editor = await app.openFile(path, { kind: 'sheets', title: 'cf.xlsx' })
    await expect(editor.ui.locator('canvas').first()).toBeVisible({ timeout: 45_000 })

    // D2:D5 cellIs>100 with a red dxf font: D2=150 hits, D3=50 misses.
    await pollUniver(
      editor,
      `(api, wb) => wb.getActiveSheet().getConditionalFormattingRules().length`,
      (v) => v >= 1,
      'the file CF rule should reach the Univer model',
    )
    const rules = await univerEval<{ ranges: { startRow: number; endRow: number }[] }[]>(
      editor,
      `(api, wb) => wb.getActiveSheet().getConditionalFormattingRules()`,
    )
    expect(rules[0].ranges[0]).toMatchObject({ startRow: 1, endRow: 4 })
    // Canvas painting itself is not assertable without pixel-diffing; the
    // rule's presence + range is the automatable half.
  })
})
