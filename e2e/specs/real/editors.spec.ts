import { test, expect } from '../../fixtures/app'
import { writeDocx, writePdf, writeText } from '../../fixtures/documents'
import { saveWithKeyboard } from '../../fixtures/editors'
import { readFile } from 'node:fs/promises'

/**
 * Markdown and PDF editors.
 *
 * Markdown is the cheapest full round-trip (plain text in, plain text out), so
 * it doubles as the control case for "the save path itself works". PDF covers
 * the renderer that depends on pdf.js: its worker and its cmaps/standard-fonts
 * assets are served from the renderer bundle, and a wrong URL there is invisible
 * to every test that does not actually render a page.
 */

test.describe('markdown: open, edit, save', () => {
  test('an edit is written back to the .md file', async ({ app }) => {
    const path = await writeText(app.workDir, 'note.md', '# Note\n\nfirst line\n')
    const editor = await app.openFile(path, { kind: 'markdown', title: 'note.md' })

    const surface = editor.ui.locator('[contenteditable="true"], .cm-content').first()
    await expect(surface).toBeVisible({ timeout: 30_000 })
    await expect(editor.ui.locator('body')).toContainText('first line')

    await surface.click()
    await app.page.keyboard.press('Control+End')
    await app.page.keyboard.type('E2E-MARKDOWN')
    await saveWithKeyboard(app.page)

    await expect
      .poll(async () => (await readFile(path, 'utf8')).includes('E2E-MARKDOWN'), {
        timeout: 20_000,
        message: 'markdown file should contain the typed line',
      })
      .toBe(true)
    // The original content survives the round trip.
    expect(await readFile(path, 'utf8')).toContain('first line')
  })

  test('a .md file is routed to the markdown editor, not to docs', async ({ app }) => {
    const path = await writeText(app.workDir, 'routing.md', '# routing\n')
    const editor = await app.openFile(path, { kind: 'markdown' })
    expect(editor.frame.url()).toContain('/markdown/index.html')
  })
})

test.describe('pdf: open and render', () => {
  test('a PDF page is rendered from the pdf.js worker', async ({ app }) => {
    const path = await writePdf(app.workDir, 'doc.pdf')
    const editor = await app.openFile(path, { kind: 'pdf', title: 'doc.pdf' })

    // A page only appears once the pdf.js worker resolved *and* the document
    // parsed. The worker URL comes from the renderer bundle (`?url` import), so
    // this fails if the asset is missing from the packaged output — which is
    // how "打开 PDF 显示文件打开失败" happened.
    await expect(editor.ui.locator('.pdf-page').first()).toBeVisible({ timeout: 45_000 })
    await expect(editor.ui.locator('.pdf-page canvas').first()).toBeVisible()

    const body = editor.ui.locator('body')
    await expect(body).toContainText(/共 1 页|1 \/ 1|第 1 页/)
    // The failure banner is a distinct, visible element: make sure it is absent
    // rather than trusting the body text alone.
    await expect(editor.ui.getByText(/文件打开失败|Failed to open/)).toHaveCount(0)
  })

  test('pdf set-up never falls back to a 404 worker or asset path', async ({ app }) => {
    // Capture the responses the pdf iframe requests; a 404 for pdfjs assets is
    // silent in the UI until text or images fail to render.
    const failures: string[] = []
    app.page.on('response', (response) => {
      const url = response.url()
      if (!url.includes('/pdf/')) return
      if (response.status() >= 400) failures.push(`${response.status()} ${url}`)
    })

    const path = await writePdf(app.workDir, 'assets.pdf')
    await app.openFile(path, { kind: 'pdf' })
    const editor = await app.editor()
    await expect(editor.ui.locator('.pdf-page').first()).toBeVisible({ timeout: 45_000 })

    expect(failures).toEqual([])
  })
})

test.describe('cross-editor: the shell binary contract', () => {
  test('opening a .docx and a .md keeps two independent tabs', async ({ app }) => {
    const docx = await writeDocx(app.workDir, 'two-tabs.docx', 'two tabs')
    await app.openFile(docx, { kind: 'docs' })
    const md = await writeText(app.workDir, 'two-tabs.md', '# two\n')
    await app.openFile(md, { kind: 'markdown' })

    const tabs = (await app.tabs()).filter((tab) => tab.kind !== 'home')
    expect(tabs).toHaveLength(2)
    expect(tabs.map((tab) => tab.kind).sort()).toEqual(['docs', 'markdown'])

    // Both iframes stay mounted; only the active one is visible.
    const docxTab = tabs.find((tab) => tab.kind === 'docs')!
    await expect(app.page.locator(`iframe[title="${docxTab.id}"]`)).toBeHidden()
  })
})
