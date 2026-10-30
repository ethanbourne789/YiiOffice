// ADAPTED FROM Electron e2e — tab-middle-click-close.spec.ts
import { test, expect } from './fixture'
import {
  launchShell,
  setupPageAfterLaunch,
  closeAndSaveVideo,
  waitForRoute,
} from './helpers'

test.describe('tab bar', () => {
  test('middle-clicking a tab closes it', async ({ page, context }) => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'tab-middle-click-close' })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Click a quick card to open an editor tab
      await page.locator('.quick-card').first().click()
      const editorTab = page.locator('.tab-bar .tab-item:not(.tab-home)')
      await expect(editorTab).toHaveCount(1)

      // NOTE: In Electron, `waitForPageWithUrl(app, '://docs/')` waited for a
      // separate webContents. In Wails SPA mode, we just check the route.
      await waitForRoute(page, '/docs')

      // Middle-click on home tab should not close the editor tab
      await page.locator('.tab-bar .tab-item.tab-home').click({ button: 'middle' })
      await expect(editorTab).toHaveCount(1)

      // Middle-click on the editor tab should close it
      await editorTab.click({ button: 'middle' })
      await expect(editorTab).toHaveCount(0)
      await expect(page.locator('.tab-bar .tab-item.tab-home')).toHaveClass(/active/)
    } finally {
      await closeAndSaveVideo(launched, 'tab-middle-click-close')
    }
  })
})
