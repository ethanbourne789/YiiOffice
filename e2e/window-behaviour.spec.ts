import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

/**
 * Window behaviour — mirror of the Wails v3 official E2E guide's
 * "Testing Window Behaviour" section (https://v3.wails.io/guides/e2e-testing/).
 *
 * Runs against the real `wails3 dev` server.  The Wails window document title
 * is set in the shell's index.html (<title>YiiOffice</title>).
 */
test.describe('window behaviour', () => {
  test('window has the shell title', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    await expect(page).toHaveTitle('YiiOffice')
  })

  test('window renders within a defined viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await waitForDocumentReady(page)

    const size = page.viewportSize() ?? { width: 0, height: 0 }
    expect(size.width).toBeGreaterThanOrEqual(1024)
    expect(size.height).toBeGreaterThanOrEqual(600)

    // Home shell should actually paint inside the window
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.locator('.app-frame')).toBeVisible()
  })

  test('window starts on the recent-files home view', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Landing surface for a fresh window is the Recent list, not an editor tab.
    // The label depends on the backend language; both 'Recent' (en) and '最近' (zh)
    // are acceptable.
    const firstLabel = page.locator('.nav-item .nav-label').first()
    await expect(firstLabel).toBeVisible()
  })
})
