import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('Markdown Editor Smoke Test', () => {
  test('should load the markdown app', async ({ page }) => {
    await navigateToApp(page, 'markdown')
    await waitForDocumentReady(page)

    await expect(page.locator('body')).toBeVisible()
  })
})
