// ADAPTED FROM Electron e2e — theme-visual.spec.ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './fixture'
import {
  launchShell,
  setupPageAfterLaunch,
  closeAndSaveVideo,
  waitForRoute,
  waitForDocumentReady,
  screenshotPath,
  triggerSave,
  mockDialogAccept,
  mockSaveDialog,
  triggerMenuAction,
} from './helpers'

/** Call window.aiOffice.setTheme(theme) from the frontend. */
function setTheme(
  page: import('@playwright/test').Page,
  theme: 'light' | 'dark' | 'system',
): Promise<void> {
  return page.evaluate(
    (t) => {
      const api = (window as unknown as { aiOffice: { setTheme(v: string): Promise<void> } }).aiOffice
      return api.setTheme(t)
    },
    theme,
  )
}

function bodyBg(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

/** relative luminance of a computed rgb()/rgba() string, 0 (black) – 255 (white) */
function luminance(rgb: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!m) throw new Error(`Unparseable color: ${rgb}`)
  return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])
}

test.describe('theme visual adoption', () => {
  test('source text editor surface follows dark theme', async ({ page, context }) => {
    // The HTML preview that used to host this CodeMirror surface is gone; a
    // .txt still opens in the same source pane, so it keeps the coverage.
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-theme-txt-'))
    const txtPath = join(dir, 'notes.txt')
    await writeFile(txtPath, 'first line\nsecond line\n')

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'theme-visual-txt',
      openFile: txtPath,
    })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Navigate to markdown editor route
      await page.goto('/markdown')
      await waitForRoute(page, '/markdown')
      await expect(page.locator('.source-editor .cm-content')).toBeVisible()

      const lightBg = await bodyBg(page)
      expect(luminance(lightBg)).toBeGreaterThan(180)

      await setTheme(page, 'dark')
      await expect.poll(async () => luminance(await bodyBg(page))).toBeLessThan(80)
      const textColor = await page
        .locator('.source-editor .cm-content')
        .evaluate((el) => getComputedStyle(el).color)
      expect(luminance(textColor)).toBeGreaterThan(180)
      await page.screenshot({ path: screenshotPath('theme-txt-dark') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-txt')
    }
  })

  test('markdown editor surface follows dark theme', async ({ page, context }) => {
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-theme-md-'))
    const mdPath = join(dir, 'doc.md')
    await writeFile(mdPath, '# Doc\n\nBody.\n')

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'theme-visual-md',
      openFile: mdPath,
    })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Navigate to markdown editor route
      await page.goto('/markdown')
      await waitForRoute(page, '/markdown')
      await expect(page.locator('.doc-editor')).toBeVisible()

      const lightBg = await bodyBg(page)
      expect(luminance(lightBg)).toBeGreaterThan(180)

      await setTheme(page, 'dark')
      await expect.poll(async () => luminance(await bodyBg(page))).toBeLessThan(80)
      // editor text is readable in dark
      const textColor = await page
        .locator('.doc-editor')
        .evaluate((el) => getComputedStyle(el).color)
      expect(luminance(textColor)).toBeGreaterThan(180)
      await page.screenshot({ path: screenshotPath('theme-markdown-dark') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-md')
    }
  })

  test('docs renders a dark page in dark theme; View ▸ Dark Mode switches back to white paper', async ({
    page,
    context,
  }) => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'theme-visual-docs' })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Navigate to docs via quick card click
      await page.locator('.quick-card', { hasText: 'Docs' }).click()
      await waitForRoute(page, '/docs')
      const docPage = page.locator('.doc-page').first()
      await expect(docPage).toBeVisible()
      const pageBg = () => docPage.evaluate((el) => getComputedStyle(el).backgroundColor)
      const pageInk = () => docPage.evaluate((el) => getComputedStyle(el).color)

      // light theme: white paper, dark ink
      expect(luminance(await pageBg())).toBeGreaterThan(180)
      expect(luminance(await pageInk())).toBeLessThan(60)

      await setTheme(page, 'dark')
      // ribbon and the canvas gutter around pages darken
      await expect
        .poll(async () =>
          luminance(
            await page
              .locator('.ribbon')
              .first()
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          ),
        )
        .toBeLessThan(80)
      expect(
        luminance(
          await page
            .locator('.workspace')
            .first()
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ),
      ).toBeLessThan(90)
      // Word-style dark page: the paper goes dark and the ink is remapped light
      await expect.poll(async () => luminance(await pageBg())).toBeLessThan(60)
      expect(luminance(await pageInk())).toBeGreaterThan(180)
      await page.screenshot({ path: screenshotPath('theme-docs-dark') })

      // View ▸ Dark Mode is Word's Switch Modes: back to white paper under the dark chrome
      await page.getByRole('button', { name: 'View', exact: true }).click()
      await page.getByRole('button', { name: 'Dark Mode', exact: true }).click()
      await expect.poll(async () => luminance(await pageBg())).toBeGreaterThan(180)
      expect(luminance(await pageInk())).toBeLessThan(60)
      await page.screenshot({ path: screenshotPath('theme-docs-dark-white-page') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-docs')
    }
  })

  test('sheets chrome and Univer grid follow dark theme', async ({ page, context }) => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'theme-visual-sheets' })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Navigate to sheets via quick card click
      await page.locator('.quick-card', { hasText: 'Sheets' }).click()
      await waitForRoute(page, '/sheets')
      await page.waitForSelector('canvas', { timeout: 20_000 })

      // Univer flags its dark repaint with a class on <html> (ThemeService.darkMode$)
      const univerDark = () =>
        page.evaluate(() => document.documentElement.classList.contains('univer-dark'))
      expect(await univerDark()).toBe(false)

      await setTheme(page, 'dark')
      // our chrome (the ribbon) darkens
      await expect
        .poll(async () =>
          luminance(
            await page
              .locator('.ribbon')
              .first()
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          ),
        )
        .toBeLessThan(80)
      // Univer switched its grid palette to dark (official darkMode flag)
      await expect.poll(univerDark).toBe(true)
      await page.screenshot({ path: screenshotPath('theme-sheets-dark') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-sheets')
    }
  })

  test('pdf chrome follows dark theme while the page stays paper-white', async ({
    page,
    context,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-theme-pdf-'))
    const pdfPath = join(dir, 'doc.pdf')
    // minimal single-page PDF, xref offsets computed so pdf.js parses it cleanly
    const objects = [
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
    ]
    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((obj, i) => {
      offsets.push(body.length)
      body += `${i + 1} 0 obj\n${obj}\nendobj\n`
    })
    const xrefStart = body.length
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
    body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`
    const { Buffer } = await import('node:buffer')
    await writeFile(pdfPath, Buffer.from(body, 'latin1'))

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'theme-visual-pdf',
      openFile: pdfPath,
    })
    await setupPageAfterLaunch(launched, page, context)

    try {
      await waitForRoute(page, '/pdf')
      await expect(page.locator('.pdf-page').first()).toBeVisible()

      await setTheme(page, 'dark')
      // chrome (the scroll gutter around pages) darkens
      await expect
        .poll(async () =>
          luminance(
            await page
              .locator('.pdf-scroll')
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          ),
        )
        .toBeLessThan(80)
      // the page itself stays paper-white and un-inverted (night mode is separate)
      const pdfPage = page.locator('.pdf-page').first()
      expect(
        luminance(await pdfPage.evaluate((el) => getComputedStyle(el).backgroundColor)),
      ).toBeGreaterThan(180)
      await page.screenshot({ path: screenshotPath('theme-pdf-dark') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-pdf')
    }
  })
})
