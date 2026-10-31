// ADAPTED FROM Electron e2e — theme-visual-slides.spec.ts
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

function luminance(rgb: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!m) throw new Error(`Unparseable color: ${rgb}`)
  return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])
}

test('slides chrome darkens while the slide canvas stays paper-white', async ({ page, context }) => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'theme-visual-slides' })
  await setupPageAfterLaunch(launched, page, context)

  try {
    // Navigate to slides
    await page.goto('/slides')
    await waitForRoute(page, '/slides')
    await waitForDocumentReady(page)
    await page.waitForSelector('.stage-wrap canvas', { timeout: 20_000 })

    await page.evaluate(() =>
      (window as unknown as { aiOffice: { setTheme(v: string): Promise<void> } }).aiOffice.setTheme(
        'dark',
      ),
    )
    // ribbon and thumbnail rail darken
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
    // the Konva stage still paints the slide paper white: the slide-bg Rect is
    // canvas content, so assert via the stage screenshot's center pixel
    const shot = await page.locator('.stage-wrap').first().screenshot()
    // PNG: naive check via Playwright — decode through a data URL in the page
    const center = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data
      return `rgb(${d[0]}, ${d[1]}, ${d[2]})`
    }, shot.toString('base64'))
    expect(luminance(center)).toBeGreaterThan(180)
    await page.screenshot({ path: screenshotPath('theme-slides-dark') })
  } finally {
    await closeAndSaveVideo(launched, 'theme-visual-slides')
  }
})
