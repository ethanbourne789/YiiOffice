import { test, expect } from '../../fixtures/app'
import { writePdf } from '../../fixtures/documents'

/**
 * PDF viewer: pages have to come out of pdf.js (not just an <embed>), the
 * navigation controls must move the current page, and zoom/fit must change the
 * rendered scale. All assertions are locale-independent.
 */

test.describe('pdf: render', () => {
  test('a three-page pdf lays out three pages and paints the first', async ({ app }) => {
    const path = await writePdf(app.workDir, 'three-pages.pdf', 3)
    const editor = await app.openFile(path, { kind: 'pdf', title: 'three-pages.pdf' })

    await expect(editor.ui.locator('.pdf-page')).toHaveCount(3)
    // Only the visible page gets a canvas (the rest are virtualised); a canvas
    // is the proof that pdf.js actually rasterised the page.
    await expect(editor.ui.locator('.pdf-page canvas').first()).toBeVisible()
    await expect(editor.ui.locator('.tb-page-input')).toHaveValue('1')
  })

  test('the thumbnail rail lists every page', async ({ app }) => {
    const path = await writePdf(app.workDir, 'thumbs.pdf', 3)
    const editor = await app.openFile(path, { kind: 'pdf' })

    await expect(editor.ui.locator('.pdf-page')).toHaveCount(3)
    await expect(editor.ui.locator('[data-idx="0"]').first()).toBeVisible()
    await expect(editor.ui.locator('[data-idx="2"]').first()).toBeVisible()
  })

  test('clicking a thumbnail moves the current page', async ({ app }) => {
    const path = await writePdf(app.workDir, 'thumb-nav.pdf', 3)
    const editor = await app.openFile(path, { kind: 'pdf' })

    const pageInput = editor.ui.locator('.tb-page-input')
    await expect(pageInput).toHaveValue('1')

    await editor.ui.locator('[data-idx="1"]').first().click()
    await expect(pageInput).toHaveValue('2')
  })
})

test.describe('pdf: page input', () => {
  test('typing a page number jumps to that page', async ({ app }) => {
    const path = await writePdf(app.workDir, 'page-input.pdf', 3)
    const editor = await app.openFile(path, { kind: 'pdf' })

    const pageInput = editor.ui.locator('.tb-page-input')
    await pageInput.fill('3')
    await pageInput.press('Enter')
    await expect(pageInput).toHaveValue('3')
    await expect(editor.ui.locator('.pdf-page[data-page="2"]')).toBeVisible()
  })
})

test.describe('pdf: zoom', () => {
  test('zoom in and out change the scale readout', async ({ app }) => {
    const path = await writePdf(app.workDir, 'zoom.pdf')
    const editor = await app.openFile(path, { kind: 'pdf' })

    const readout = editor.ui.locator('.tb-zoom')
    const initial = await readout.innerText()

    await editor.ui.locator('[data-cmd="zoomIn"]').click()
    await expect(readout).not.toHaveText(initial)

    const zoomed = await readout.innerText()
    await editor.ui.locator('[data-cmd="zoomOut"]').click()
    await expect(readout).not.toHaveText(zoomed)
  })

  test('fit width and fit page produce different scales', async ({ app }) => {
    const path = await writePdf(app.workDir, 'fit.pdf')
    const editor = await app.openFile(path, { kind: 'pdf' })

    const readout = editor.ui.locator('.tb-zoom')
    await editor.ui.locator('[data-cmd="fitWidth"]').click()
    const widthScale = Number((await readout.innerText()).replace('%', ''))

    await editor.ui.locator('[data-cmd="fitPage"]').click()
    const pageScale = Number((await readout.innerText()).replace('%', ''))

    // A portrait page fitted to width is always shown larger than fitted to the
    // page box, so a regression that ignores the requested mode shows up here.
    expect(widthScale).toBeGreaterThan(pageScale)
  })
})

test.describe('pdf: document identity', () => {
  test('every page element carries its zero-based page index', async ({ app }) => {
    const path = await writePdf(app.workDir, 'indexed.pdf', 3)
    const editor = await app.openFile(path, { kind: 'pdf' })

    await expect
      .poll(async () =>
        editor.ui.locator('.pdf-page').evaluateAll((pages) =>
          pages.map((page) => page.getAttribute('data-page')),
        ),
      )
      .toEqual(['0', '1', '2'])
  })

  test('the tab is named after the file', async ({ app }) => {
    const path = await writePdf(app.workDir, 'named-report.pdf')
    await app.openFile(path, { kind: 'pdf', title: 'named-report.pdf' })

    await expect(app.page.locator('.tab-item', { hasText: 'named-report.pdf' })).toBeVisible()
  })
})
