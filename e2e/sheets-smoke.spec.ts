import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('Sheets Editor Smoke Test', () => {
  test('should load the sheets app', async ({ page }) => {
    await navigateToApp(page, 'sheets')
    await waitForDocumentReady(page)

    // Basic check: page loads
    await expect(page.locator('body')).toBeVisible()
  })
})
