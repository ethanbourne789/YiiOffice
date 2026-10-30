// ADAPTED FROM Electron
import { test, expect } from './fixture'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, screenshotPath } from './helpers'

test.describe('home screen', () => {
  test('renders localized UI when YIIOFFICE_LANG=zh-CN', async ({ page, context }) => {
    const launched = await launchShell({
      onboardingSeen: true,
      lang: 'zh-CN',
      videoDir: 'home-zh-cn',
    })
    await setupPageAfterLaunch(launched, page, context, {
      onboardingSeen: true,
      lang: 'zh-CN',
      videoDir: 'home-zh-cn',
    })
    try {
      await expect(page.locator('.nav-item .nav-label').first()).toHaveText('最近')
      await page.screenshot({ path: screenshotPath('home-zh-cn') })
    } finally {
      await closeAndSaveVideo(launched, 'home-zh-cn')
    }
  })
})
