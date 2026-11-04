import { test, expect } from '../../fixtures/app'
import { closeAllTabs, listTabs, waitForActiveEditor } from '../../fixtures/editors'
import { writeDocx, writeText } from '../../fixtures/documents'

/**
 * Shell behaviour: the tab strip, the home page and the journey that ties them
 * to the Go host. In the Electron suite each document was its own BrowserWindow
 * driven through `app.windows()`; here the shell owns one window and each
 * document is a tab in the Go TabHost, so these are the equivalent assertions.
 */

test.describe('shell: tabs', () => {
  test('opening a document creates a closable tab and mounts its editor', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'tab-lifecycle.docx', 'Tab lifecycle')

    // Home is the only tab a fresh host reports, and it is not closable.
    const initial = await listTabs(app.page)
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ kind: 'home', closable: false })

    const editor = await app.openFile(path, { kind: 'docs', title: 'tab-lifecycle.docx' })

    // The tab strip is rendered from `tabs:changed`, i.e. the event the Go host
    // emits when it mutates the TabHost.
    const tab = app.page.locator('.tab-item', { hasText: 'tab-lifecycle.docx' })
    await expect(tab).toBeVisible()
    await expect(tab.locator('.tab-close')).toBeVisible()

    // The editor iframe is mounted for that tab id and the document rendered.
    expect(editor.frame.url()).toContain(`/docs/index.html?tabId=${editor.tab.id}`)
    await expect(editor.ui.locator('.doc-page').first()).toBeVisible()
    await expect(editor.ui.locator('.doc-page').first()).toContainText('Tab lifecycle')
  })

  test('closing a tab removes it from the host and unmounts its iframe', async ({ app }) => {
    const first = await writeDocx(app.workDir, 'close-me.docx', 'close me')
    await app.openFile(first, { kind: 'docs' })
    const iframe = app.page.locator(`iframe[data-tab-id="${(await waitForActiveEditor(app.page)).id}"]`)
    await expect(iframe).toHaveCount(1)

    const editorTab = (await listTabs(app.page)).find((tab) => tab.kind === 'docs')!
    await app.page.evaluate((id) => window.aiOfficeTabs.close(id), editorTab.id)

    await expect
      .poll(async () => (await listTabs(app.page)).filter((tab) => tab.kind !== 'home').length)
      .toBe(0)
    await expect(iframe).toHaveCount(0)
  })

  test('switching back to home keeps the editor mounted but hidden', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'background.docx', 'background')
    await app.openFile(path, { kind: 'docs' })

    // The home tab is the shell's permanent first tab.
    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await expect(app.page.getByTestId('nav-recent')).toBeVisible()

    const docsTab = (await listTabs(app.page)).find((tab) => tab.kind === 'docs')!
    expect(docsTab.active).toBe(false)

    // Editors are kept alive (not unmounted) so unsaved state survives a switch.
    const iframe = app.page.locator(`iframe[data-tab-id="${docsTab.id}"]`)
    await expect(iframe).toHaveCount(1)
    await expect(iframe).toBeHidden()

    await app.page.evaluate((id) => window.aiOfficeTabs.activate(id), docsTab.id)
    await expect(iframe).toBeVisible()
  })

  test('the + button opens the new-file menu rendered by the shell', async ({ app }) => {
    // The Electron build asked the main process for a native popup menu; Wails
    // has no such API, so the shell draws the menu in the DOM. That regression
    // ("clicking + does nothing") is only observable end to end.
    await app.page.getByTestId('new-file').click()
    await expect(app.page.locator('.tab-menu').first()).toBeVisible()
    await expect(app.page.locator('.tab-menu .tab-menu-item').first()).toBeVisible()
  })
})

test.describe('shell: home', () => {
  test('a document opened from disk shows up in the recent list', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'recent-entry.docx', 'recent')
    await app.openFile(path, { kind: 'docs' })

    // Back to home: the list is served by Go's RecentManager (recent.json),
    // which the bridge only records after a successful open.
    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await app.page.getByTestId('nav-recent').click()

    const row = app.page.locator('.recent-row', { hasText: 'recent-entry.docx' })
    await expect(row.first()).toBeVisible({ timeout: 20_000 })
  })

  test('a markdown file opens into the markdown editor', async ({ app }) => {
    const path = await writeText(app.workDir, 'routed.md', '# routed\n')
    const editor = await app.openFile(path, { kind: 'markdown', title: 'routed.md' })
    await expect(editor.ui.locator('body')).toContainText('routed')
  })
})

test.describe('shell: new documents', () => {
  for (const [kind, label] of [
    ['docs', 'newDoc'],
    ['sheets', 'newSheet'],
    ['slides', 'newSlide'],
    ['markdown', 'newMarkdown'],
  ] as const) {
    test(`new ${kind} document opens a ${kind} tab`, async ({ app }) => {
      await closeAllTabs(app.page)
      await app.page.evaluate((fn) => window.aiOffice[fn](), label as 'newDoc')

      const tab = await waitForActiveEditor(app.page)
      expect(tab.kind).toBe(kind)
      expect(tab.closable).toBe(true)

      const editor = await app.editor(tab)
      // Every editor renders its ribbon once it boots; an empty #root is the
      // "new document does nothing" symptom this asserts against.
      await expect(editor.ui.locator('.ribbon').first()).toBeVisible({ timeout: 30_000 })
    })
  }
})
