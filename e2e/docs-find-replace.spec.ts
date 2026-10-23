/**
 * Find & Replace panel: highlight-all with a live count, Word wildcards,
 * regex Replace All with groups, the Go To tab, and the Home ▸ Editing group.
 */
import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

const POLL = { timeout: 15_000, intervals: [250, 500, 1000] }

test('find, wildcards, regex replace, go to and the Editing group', async () => {
  test.setTimeout(120_000)
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'docs-find-replace' })
  const { app, page } = launched
  try {
    await page.locator('.quick-card').first().click()
    const editor = await waitForPageWithUrl(app, '://docs/')
    const docPage = editor.locator('.doc-page[contenteditable="true"]')
    await docPage.waitFor()
    await docPage.click()
    await editor.keyboard.type('Alpha beta gamma.', { delay: 10 })
    // first line becomes a heading: the Go To target below
    await editor.keyboard.press('Control+Alt+1')
    await editor.keyboard.press('Enter')
    await editor.keyboard.type('Beta again, beta twice.', { delay: 10 })
    await editor.keyboard.press('Enter')
    await editor.keyboard.type('Numbers 12 and 345.', { delay: 10 })
    await expect(docPage.locator('h1')).toContainText('Alpha beta gamma.')

    // ---- Find: highlight all + count ----
    await editor.keyboard.press('ControlOrMeta+f')
    const panel = editor.locator('.find-panel')
    await panel.waitFor()
    const findInput = panel.locator('.find-input').first()
    await findInput.fill('beta')
    await expect(panel.locator('.find-count')).toHaveText('1/3', POLL)
    await expect(docPage.locator('.search-hit')).toHaveCount(3)
    await expect(docPage.locator('.search-hit-active')).toHaveCount(1)
    await findInput.press('Enter')
    await expect(panel.locator('.find-count')).toHaveText('2/3')

    // ---- wildcards: ^# digit code inside a Word wildcard pattern ----
    const chips = panel.locator('.find-options .find-opt')
    await chips.nth(2).click() // *?
    await findInput.fill('Numbers ^#^#')
    await expect(panel.locator('.find-count')).toHaveText('1/1', POLL)
    await panel.locator('.find-results-toggle').click()
    await expect(panel.locator('.find-result')).toHaveCount(1)
    await expect(panel.locator('.find-result mark')).toHaveText('Numbers 12')
    // an invalid pattern reports instead of throwing
    await findInput.fill('(abc')
    await expect(panel.locator('.find-error')).toBeVisible()

    // ---- regex Replace All with groups ----
    await panel.locator('.find-tab').nth(1).click()
    await chips.nth(3).click() // .*  (turns wildcards off)
    await findInput.fill('(\\d+) and (\\d+)')
    await expect(panel.locator('.find-count')).toHaveText('1/1', POLL)
    await panel.locator('.find-input').nth(1).fill('$2-$1')
    await panel.locator('.find-action', { hasText: 'Replace All' }).click()
    await expect
      .poll(() => docPage.evaluate((el) => el.textContent ?? ''), POLL)
      .toContain('Numbers 345-12.')
    await expect(panel.locator('.find-count')).toContainText('No results')

    // ---- Go To ----
    await editor.keyboard.press('Control+g')
    await expect(panel.locator('.find-tab.on')).toHaveText('Go To')
    await panel.locator('.find-select').first().selectOption('heading')
    await panel.locator('.find-goto-input').fill('1')
    await panel.locator('.find-action-primary').click()
    // the caret block, read from the editor state (the panel keeps DOM focus)
    const caretBlock = () =>
      editor.evaluate(() => {
        const ed = (window as unknown as { __aidocs: { editor: import('@tiptap/core').Editor } })
          .__aidocs.editor
        const $p = ed.state.doc.resolve(ed.state.selection.from)
        return `${$p.parent.type.name}:${$p.parent.textContent}`
      })
    await expect.poll(caretBlock, POLL).toBe('docHeading:Alpha beta gamma.')
    // page 1 of 1: resolves without complaint
    await docPage.locator('p').last().click()
    await panel.locator('.find-select').first().selectOption('page')
    await panel.locator('.find-goto-input').fill('1')
    await panel.locator('.find-action-primary').click()
    await expect(panel.locator('.find-hint-miss')).toHaveCount(0)
    await expect.poll(caretBlock, POLL).toBe('docHeading:Alpha beta gamma.')
    await editor.screenshot({ path: test.info().outputPath('find-goto.png') })

    // ---- Home ▸ Editing group reopens the panel ----
    // The .rb-editing group was removed; Find/Replace are now qa-btn on the ribbon bar.
    await panel.locator('.find-close').click()
    await expect(panel).toHaveCount(0)
    // Find button (qa-btn with search icon) reopens the panel on Find tab
    await editor.getByRole('button', { name: /find/i, exact: true }).first().click()
    await expect(editor.locator('.find-panel')).toBeVisible()
    await expect(editor.locator('.find-panel .find-tab.on')).toHaveText('Find')
    // Replace button (qa-btn with replace icon) switches to Replace tab
    await editor.getByRole('button', { name: /replace/i, exact: true }).first().click()
    await expect(editor.locator('.find-panel .find-tab.on')).toHaveText('Replace')
  } finally {
    await closeAndSaveVideo(launched, 'docs-find-replace')
  }
})
