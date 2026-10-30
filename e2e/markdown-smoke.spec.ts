import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

test.describe('Markdown Editor Smoke Test', () => {
  test('should load the markdown app', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
