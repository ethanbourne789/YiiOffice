// Adapted from Electron; updated for wails3 dev server (real Go backend).
import { test, expect } from './fixture'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, screenshotPath, waitForDocumentReady } from './helpers'

test.describe('home screen', () => {
  test('renders home page with nav items', async ({ page, context }) => {
    const launched = await launchShell({
      onboardingSeen: true,
    })
    await setupPageAfterLaunch(launched, page, context, {
      onboardingSeen: true,
    })
    try {
      // Nav items should be present (the shell renders a sidebar with navigation)
      await expect(page.locator('.nav-item').first()).toBeVisible()
      await page.screenshot({ path: screenshotPath('home') })
    } finally {
      await closeAndSaveVideo(launched, 'home')
    }
  })

  test('switches language to Chinese and shows localized labels', async ({ page, context }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Use the real bridge API to switch to Chinese
    await page.evaluate(async () => {
      await (window as any).aiOffice.setLanguage('zh')
    })

    // After language change the frontend broadcasts a language-changed event
    // and re-renders.  Wait for the localized label to appear.
    await expect(page.locator('.nav-item .nav-label').first()).toHaveText('最近', {
      timeout: 15_000,
    })
  })
})
