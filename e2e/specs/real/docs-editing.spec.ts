import { test, expect } from '../../fixtures/app'
import { readDocxText, writeDocx, writeDocxParagraphs } from '../../fixtures/documents'

/**
 * Docs editor: the ribbon/status-bar behaviours a user drives from the keyboard,
 * plus the disk proof that a formatting change survived the round trip.
 *
 * Selectors are class-based on purpose: the UI ships in several languages, so a
 * label like "替换全部" would make the suite locale-dependent.
 */

test.describe('docs: find and replace', () => {
  test('Ctrl+F counts every occurrence and steps through them', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'find-count.docx', 'alpha beta alpha')
    const editor = await app.openFile(path, { kind: 'docs', title: 'find-count.docx' })
    await editor.ui.locator('.doc-page').first().click()

    await app.page.keyboard.press('Control+f')
    const panel = editor.ui.locator('.find-panel')
    await expect(panel).toBeVisible()

    await editor.ui.locator('.find-input').first().fill('alpha')
    // "1/2": first of two matches — the count comes from the ProseMirror scan,
    // so it also proves the document was parsed rather than merely displayed.
    await expect(panel.locator('.find-count')).toHaveText('1/2')

    await panel.locator('.find-btn').last().click()
    await expect(panel.locator('.find-count')).toHaveText('2/2')
  })

  test('Escape closes the find panel', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'find-escape.docx', 'alpha')
    const editor = await app.openFile(path, { kind: 'docs' })
    await editor.ui.locator('.doc-page').first().click()

    await app.page.keyboard.press('Control+f')
    await expect(editor.ui.locator('.find-panel')).toBeVisible()
    await app.page.keyboard.press('Escape')
    await expect(editor.ui.locator('.find-panel')).toHaveCount(0)
  })

  test('replace one swaps a single match and keeps the rest', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'replace-one.docx', 'alpha beta alpha')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.doc-page').first().click()
    await app.page.keyboard.press('Control+h')
    const inputs = editor.ui.locator('.find-input')
    await inputs.nth(0).fill('alpha')
    await inputs.nth(1).fill('omega')
    await expect(editor.ui.locator('.find-count')).toHaveText('1/2')

    await editor.ui.locator('.find-action').first().click()
    await app.page.keyboard.press('Control+s')

    await expect
      .poll(async () => {
        const xml = await readDocxText(path)
        return {
          omega: (xml.match(/omega/g) ?? []).length,
          alpha: (xml.match(/alpha/g) ?? []).length,
        }
      })
      .toEqual({ omega: 1, alpha: 1 })
  })

  test('replace all rewrites every match on disk', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'replace-all.docx', 'alpha beta alpha')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.doc-page').first().click()
    await app.page.keyboard.press('Control+h')
    const inputs = editor.ui.locator('.find-input')
    await inputs.nth(0).fill('alpha')
    await inputs.nth(1).fill('omega')
    await expect(editor.ui.locator('.find-count')).toHaveText('1/2')

    await editor.ui.locator('.find-action').last().click()
    await app.page.keyboard.press('Control+s')

    await expect
      .poll(async () => {
        const xml = await readDocxText(path)
        return { hasAlpha: xml.includes('alpha'), hasOmega: xml.includes('omega beta omega') }
      })
      .toEqual({ hasAlpha: false, hasOmega: true })
  })
})

test.describe('docs: editing', () => {
  test('Ctrl+B marks the run bold in the saved file', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'bold.docx', 'bold me')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.doc-page').first().click()
    await app.page.keyboard.press('Control+a')
    await app.page.keyboard.press('Control+b')
    await app.page.keyboard.press('Control+s')

    // The UI could show a bold caret without writing anything: the assertion is
    // the `<w:b/>` run property in the OOXML part.
    await expect
      .poll(async () => /<w:b(\s|\/|>)/.test(await readDocxText(path)))
      .toBe(true)
  })

  test('Ctrl+Z undoes the typed text before it is saved', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'undo.docx', 'stable text')
    const editor = await app.openFile(path, { kind: 'docs' })

    const page = editor.ui.locator('.doc-page').first()
    await page.click()
    await app.page.keyboard.type('UNDO-ME')
    await expect(page).toContainText('UNDO-ME')

    await app.page.keyboard.press('Control+z')
    await expect(page).not.toContainText('UNDO-ME')
    await expect(page).toContainText('stable text')
  })

  test('the word count in the status bar follows the document', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'wordcount.docx', 'one two three')
    const editor = await app.openFile(path, { kind: 'docs' })

    const counter = editor.ui.locator('.status-wordcount')
    await expect(counter).toBeVisible()
    const readCount = async () => Number((await counter.innerText()).replace(/\D/g, ''))

    const before = await readCount()
    await editor.ui.locator('.doc-page').first().click()
    await app.page.keyboard.press('Control+End')
    await app.page.keyboard.type(' four')
    await expect.poll(readCount).toBeGreaterThan(before)
  })
})

test.describe('docs: layout and view', () => {
  test('a two-paragraph .docx renders both paragraphs', async ({ app }) => {
    const path = await writeDocxParagraphs(app.workDir, 'paragraphs.docx', [
      'first paragraph',
      'second paragraph',
    ])
    const editor = await app.openFile(path, { kind: 'docs' })

    const paragraphs = editor.ui.locator('.doc-page p')
    await expect(paragraphs).toHaveCount(2)
    await expect(editor.ui.locator('.doc-page')).toContainText('first paragraph')
    await expect(editor.ui.locator('.doc-page')).toContainText('second paragraph')
  })

  test('the zoom buttons change the zoom readout', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'zoom.docx', 'zoom')
    const editor = await app.openFile(path, { kind: 'docs' })

    const readout = editor.ui.locator('.zoom-value')
    const buttons = editor.ui.locator('.zoom-btn')
    await expect(readout).toHaveText('100%')

    await buttons.last().click()
    await expect(readout).toHaveText('110%')

    await buttons.first().click()
    await expect(readout).toHaveText('100%')
  })

  test('read mode swaps the ribbon for an exit control', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'read-mode.docx', 'read me')
    const editor = await app.openFile(path, { kind: 'docs' })

    // Fourth status-bar view button is read mode (print / web / outline / read).
    await editor.ui.locator('.status-view-btn').nth(3).click()
    const exit = editor.ui.locator('.read-exit')
    await expect(exit).toBeVisible()
    await expect(editor.ui.locator('.ribbon')).toBeHidden()

    await exit.click()
    await expect(editor.ui.locator('.ribbon').first()).toBeVisible()
  })
})

test.describe('docs: find options and go-to', () => {
  test('match-case narrows the hit count to the exact casing', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'match-case.docx', 'Alpha alpha')
    const editor = await app.openFile(path, { kind: 'docs' })
    await editor.ui.locator('.doc-page').first().click()

    await app.page.keyboard.press('Control+f')
    await editor.ui.locator('.find-input').first().fill('alpha')
    await expect(editor.ui.locator('.find-count')).toHaveText('1/2')

    // First option chip is Aa (match case).
    await editor.ui.locator('.find-opt').first().click()
    await expect(editor.ui.locator('.find-count')).toHaveText('1/1')
  })

  test('the page number in the status bar opens Go To', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'goto.docx', 'go to')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.status-page').click()
    await expect(editor.ui.locator('.find-panel')).toBeVisible()
    await expect(editor.ui.locator('.find-tab').nth(2)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('docs: document state', () => {
  test('the status bar reports the current page and the total', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'page-status.docx', 'one page')
    const editor = await app.openFile(path, { kind: 'docs' })

    const pageStatus = editor.ui.locator('.status-page')
    await expect(pageStatus).toBeVisible()
    await expect(pageStatus).toContainText('1')
  })

  test('typing at the end appends to the file instead of replacing it', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'append.docx', 'seed sentence')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.doc-page').first().click()
    await app.page.keyboard.press('Control+End')
    await app.page.keyboard.type(' appended')
    await app.page.keyboard.press('Control+s')

    await expect
      .poll(async () => {
        const xml = await readDocxText(path)
        return { seed: xml.includes('seed sentence'), appended: xml.includes('appended') }
      })
      .toEqual({ seed: true, appended: true })
  })

  test('two open documents keep their own content', async ({ app }) => {
    const first = await writeDocx(app.workDir, 'first.docx', 'first document body')
    const second = await writeDocx(app.workDir, 'second.docx', 'second document body')
    const firstEditor = await app.openFile(first, { kind: 'docs', title: 'first.docx' })
    const secondEditor = await app.openFile(second, { kind: 'docs', title: 'second.docx' })

    await expect(secondEditor.ui.locator('.doc-page').first()).toContainText('second document body')

    await app.page.evaluate((id) => window.aiOfficeTabs.activate(id), firstEditor.tab.id)
    await expect(firstEditor.ui.locator('.doc-page').first()).toContainText('first document body')
    await expect(firstEditor.ui.locator('.doc-page').first()).not.toContainText('second document body')
  })

  test('the web layout button becomes the active view', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'view-mode.docx', 'view')
    const editor = await app.openFile(path, { kind: 'docs' })

    const webButton = editor.ui.locator('.status-view-btn').nth(1)
    await webButton.click()
    await expect(webButton).toHaveClass(/on/)
    await expect(editor.ui.locator('.status-view-btn').first()).not.toHaveClass(/on/)
  })
})

test.describe('docs: find options', () => {
  test('whole-word matching drops matches inside longer words', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'whole-word.docx', 'cat concatenate cat')
    const editor = await app.openFile(path, { kind: 'docs' })
    await editor.ui.locator('.doc-page').first().click()

    await app.page.keyboard.press('Control+f')
    await editor.ui.locator('.find-input').first().fill('cat')
    await expect(editor.ui.locator('.find-count')).toHaveText('1/3')

    // Second chip is W (whole word).
    await editor.ui.locator('.find-opt').nth(1).click()
    await expect(editor.ui.locator('.find-count')).toHaveText('1/2')
  })
})

test.describe('docs: view modes', () => {
  test('outline view becomes the active status-bar view', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'outline-view.docx', 'outline')
    const editor = await app.openFile(path, { kind: 'docs' })

    const outlineButton = editor.ui.locator('.status-view-btn').nth(2)
    await outlineButton.click()
    await expect(outlineButton).toHaveClass(/on/)
  })
})
