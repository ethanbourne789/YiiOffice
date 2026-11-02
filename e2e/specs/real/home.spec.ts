import { test, expect } from '../../fixtures/app'
import { writeDocx, writeText } from '../../fixtures/documents'
import { listTabs } from '../../fixtures/editors'

/**
 * Home page: the quick-start cards and the recent list are both driven by the
 * Go host (RecentManager + TabHost), so each assertion also proves the service
 * pipeline is alive, not just that a React list rendered.
 */

test.describe('home: quick start', () => {
  test('the Docs card opens a docs tab through the real click path', async ({ app }) => {
    await app.closeAllTabs()
    await app.page.getByTestId('nav-recent').click()

    const docsCard = app.page.locator('.quick-card').filter({ hasText: '.docx' }).first()
    await expect(docsCard).toBeVisible()
    await docsCard.click()

    await expect
      .poll(async () => (await listTabs(app.page)).find((t) => t.active && t.kind !== 'home')?.kind)
      .toBe('docs')
  })
})

test.describe('home: recent list', () => {
  test('clicking a recent row reopens that document', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'reopen-me.docx', 'reopen')
    await app.openFile(path, { kind: 'docs' })

    // Start from a clean strip so the click is the only way the tab can appear.
    await app.closeAllTabs()
    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await app.page.getByTestId('nav-recent').click()

    const row = app.page.locator('.recent-row', { hasText: 'reopen-me.docx' })
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.locator('.recent-item').click()

    const tabs = (await listTabs(app.page)).filter((tab) => tab.kind !== 'home')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ kind: 'docs', title: 'reopen-me.docx' })
  })

  test('the type filter keeps only documents when 文档 is selected', async ({ app }) => {
    const docx = await writeDocx(app.workDir, 'filter-me.docx', 'doc')
    const md = await writeText(app.workDir, 'filter-me.md', '# md\n')
    await app.openFile(docx, { kind: 'docs' })
    await app.openFile(md, { kind: 'markdown' })

    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await app.page.getByTestId('nav-recent').click()
    await expect(app.page.locator('.recent-row', { hasText: 'filter-me.md' })).toHaveCount(1)

    // Second pill is the "documents" filter; index-based on purpose (the label
    // is localised, the order is fixed).
    await app.page.locator('.filter-pills').first().locator('button').nth(1).click()

    await expect(app.page.locator('.recent-row', { hasText: 'filter-me.docx' })).toHaveCount(1)
    await expect(app.page.locator('.recent-row', { hasText: 'filter-me.md' })).toHaveCount(0)
  })

  test('starring a file makes it appear under Starred', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'star-me.docx', 'star')
    await app.openFile(path, { kind: 'docs' })
    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await app.page.getByTestId('nav-recent').click()

    const row = app.page.locator('.recent-row', { hasText: 'star-me.docx' })
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.locator('.star-btn').click()

    await app.page.getByTestId('nav-starred').click()
    await expect(app.page.locator('.recent-row', { hasText: 'star-me.docx' })).toHaveCount(1)
  })
})

test.describe('home: quick-start cards', () => {
  test('the Sheets card opens a sheets tab', async ({ app }) => {
    await app.closeAllTabs()
    await app.page.getByTestId('nav-recent').click()

    await app.page.locator('.quick-card').nth(1).click()
    await expect
      .poll(async () => (await listTabs(app.page)).find((t) => t.active && t.kind !== 'home')?.kind)
      .toBe('sheets')
  })

  test('the Markdown card opens a markdown tab', async ({ app }) => {
    await app.closeAllTabs()
    await app.page.getByTestId('nav-recent').click()

    await app.page.locator('.quick-card').nth(3).click()
    await expect
      .poll(async () => (await listTabs(app.page)).find((t) => t.active && t.kind !== 'home')?.kind)
      .toBe('markdown')
  })

  test('the All filter restores every recent row', async ({ app }) => {
    const docx = await writeDocx(app.workDir, 'restore.docx', 'doc')
    const md = await writeText(app.workDir, 'restore.md', '# md\n')
    await app.openFile(docx, { kind: 'docs' })
    await app.openFile(md, { kind: 'markdown' })

    await app.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await app.page.getByTestId('nav-recent').click()

    const pills = app.page.locator('.filter-pills').first().locator('button')
    await pills.nth(1).click()
    await expect(app.page.locator('.recent-row', { hasText: 'restore.md' })).toHaveCount(0)

    await pills.first().click()
    await expect(app.page.locator('.recent-row', { hasText: 'restore.md' })).toHaveCount(1)
    await expect(app.page.locator('.recent-row', { hasText: 'restore.docx' })).toHaveCount(1)
  })
})
