import { test, expect, type App } from '../../fixtures/app'
import { writeDocx, writeText } from '../../fixtures/documents'
import { listTabs } from '../../fixtures/editors'

/**
 * Tab strip semantics. Each tab owns an iframe that stays mounted while hidden,
 * so "activating a tab" is observable as exactly one visible editor iframe —
 * the Wails equivalent of Electron's one-window-per-document model.
 */

async function openTwo(app: App) {
  const docx = await writeDocx(app.workDir, 'tab-a.docx', 'tab a')
  await app.openFile(docx, { kind: 'docs', title: 'tab-a.docx' })
  const md = await writeText(app.workDir, 'tab-b.md', '# tab b\n')
  await app.openFile(md, { kind: 'markdown', title: 'tab-b.md' })
  return { docx, md }
}

test.describe('tabs: activation', () => {
  test('clicking a tab strip item activates that editor and hides the other', async ({ app }) => {
    await openTwo(app)
    const tabs = (await listTabs(app.page)).filter((tab) => tab.kind !== 'home')
    expect(tabs).toHaveLength(2)

    const docsTab = tabs.find((tab) => tab.kind === 'docs')!
    const markdownTab = tabs.find((tab) => tab.kind === 'markdown')!

    await app.page.locator('.tab-item', { hasText: 'tab-a.docx' }).click()

    await expect(app.page.locator(`iframe[title="${docsTab.id}"]`)).toBeVisible()
    await expect(app.page.locator(`iframe[title="${markdownTab.id}"]`)).toBeHidden()
    const active = (await listTabs(app.page)).find((tab) => tab.active)
    expect(active?.id).toBe(docsTab.id)
  })

  test('closing the active tab hands the editor over to the remaining tab', async ({ app }) => {
    await openTwo(app)
    const tabs = (await listTabs(app.page)).filter((tab) => tab.kind !== 'home')
    const docsTab = tabs.find((tab) => tab.kind === 'docs')!
    const markdownTab = tabs.find((tab) => tab.kind === 'markdown')!

    await app.page.locator('.tab-item', { hasText: 'tab-b.md' }).click()
    await expect(app.page.locator(`iframe[title="${markdownTab.id}"]`)).toBeVisible()

    await app.page.locator('.tab-item', { hasText: 'tab-b.md' }).locator('.tab-close').click()

    await expect
      .poll(async () => (await listTabs(app.page)).find((tab) => tab.active)?.id)
      .toBe(docsTab.id)
    await expect(app.page.locator(`iframe[title="${docsTab.id}"]`)).toBeVisible()
  })

  test('closing a background tab leaves the active editor untouched', async ({ app }) => {
    await openTwo(app)
    const tabs = (await listTabs(app.page)).filter((tab) => tab.kind !== 'home')
    const docsTab = tabs.find((tab) => tab.kind === 'docs')!
    const markdownTab = tabs.find((tab) => tab.kind === 'markdown')!

    // tab-b.md was opened last, so it is active; close the background docs tab.
    await app.page.locator('.tab-item', { hasText: 'tab-a.docx' }).locator('.tab-close').click()

    await expect
      .poll(async () => (await listTabs(app.page)).map((tab) => tab.id))
      .toEqual(['home', markdownTab.id])
    await expect(app.page.locator(`iframe[title="${markdownTab.id}"]`)).toBeVisible()
    await expect(app.page.locator(`iframe[title="${docsTab.id}"]`)).toHaveCount(0)
  })
})
