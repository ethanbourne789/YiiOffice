import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

test.describe('Sheets Editor Smoke Test', () => {
  test('should load the sheets app', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // App shell should render
    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
