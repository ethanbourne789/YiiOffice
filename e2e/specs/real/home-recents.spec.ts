import { test, expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer } from '../../fixtures/server'

/**
 * Real-backend regression for the recent-list cursor pagination.
 *
 * The host reads `recent.json` once at startup, so this spec launches its own
 * server (instead of the worker-shared one) and seeds >60 records into the
 * fresh `YIIOFFICE_USER_DATA` before the process starts. Everything after that
 * goes through the real Go `HomeService.Recents` cursor path — no stubs.
 */

const TOTAL = 80
const DOC_TOTAL = 40
const PAGE_SIZE = 50

/** Seed 80 records with distinct stems: 40 docx, 10 xlsx, 10 pdf, 20 md. */
async function seedRecents(dataDir: string): Promise<void> {
  const filesDir = join(dataDir, 'seeded-recents')
  await mkdir(filesDir, { recursive: true })
  const entries: { path: string; ts: number }[] = []
  const base = Date.now()
  for (let i = 0; i < TOTAL; i++) {
    const ext = i < 40 ? 'docx' : i < 50 ? 'xlsx' : i < 60 ? 'pdf' : 'md'
    const name = `seed-${String(i).padStart(3, '0')}.${ext}`
    const path = join(filesDir, name)
    // Empty files are enough: recents only stat them, no editor is opened.
    await writeFile(path, '')
    entries.push({ path, ts: base - i * 1000 })
  }
  await writeFile(join(dataDir, 'recent.json'), JSON.stringify(entries))
}

async function headingCount(page: Page): Promise<number> {
  const text = (await page.locator('.recents-heading .file-count').textContent()) ?? ''
  const match = text.match(/\d+/)
  if (!match) throw new Error(`file count heading has no number: ${JSON.stringify(text)}`)
  return Number(match[0])
}

async function rowNames(page: Page): Promise<string[]> {
  return page.locator('.recent-row .recent-name').allTextContents()
}

test('recent list cursor pagination: scroll to the end, count parity, no duplicates, filter resets the cursor', async ({
  browser,
}) => {
  const { server, stop } = await startServer({
    prepareDataDir: (dataDir) => seedRecents(dataDir),
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    await page.goto(server.baseURL + '/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('nav-recent')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('nav-recent').click()

    const rows = page.locator('.recent-row')
    // Page one only: the sentinel sits below the fold with 50 rows on screen.
    await expect(rows).toHaveCount(PAGE_SIZE, { timeout: 20_000 })
    expect(await headingCount(page)).toBe(TOTAL)

    // Scroll the sentinel into view; IntersectionObserver asks for the cursor's
    // next page and must land exactly on the remaining 30 records.
    await page.locator('.load-more').scrollIntoViewIfNeeded()
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(TOTAL)
    await expect(page.locator('.load-more')).toHaveCount(0)
    expect(await headingCount(page)).toBe(TOTAL)

    const names = await rowNames(page)
    expect(new Set(names).size).toBe(TOTAL) // cursor paging neither repeats nor skips
    expect(names[0]).toContain('seed-000')
    expect(names[names.length - 1]).toContain('seed-079')

    // Filter change must restart at cursor '', not continue the "all" cursor:
    // 40 docs fit one page, so a stale cursor would come back empty.
    await page.locator('.filter-pills').first().getByRole('button').nth(1).click()
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(DOC_TOTAL)
    expect(await headingCount(page)).toBe(DOC_TOTAL)
    const docNames = await rowNames(page)
    expect(new Set(docNames).size).toBe(DOC_TOTAL)
    expect(docNames.join(' ')).toContain('seed-039')
    expect(docNames.join(' ')).not.toContain('seed-040')
    expect(docNames.join(' ')).not.toContain('seed-079')

    // Back to All: the list restarts at page one (50), then paging again reaches 80.
    await page.locator('.filter-pills').first().getByRole('button').nth(0).click()
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(PAGE_SIZE)
    expect(await headingCount(page)).toBe(TOTAL)
    await page.locator('.load-more').scrollIntoViewIfNeeded()
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBe(TOTAL)
    expect(new Set(await rowNames(page)).size).toBe(TOTAL)
  } finally {
    await context.close()
    await stop()
  }
})
