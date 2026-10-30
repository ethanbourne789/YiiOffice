import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

test.describe('PDF Editor Smoke Test', () => {
  test('should load the pdf app', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
