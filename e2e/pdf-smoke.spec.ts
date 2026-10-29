import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('PDF Editor Smoke Test', () => {
  test('should load the pdf app', async ({ page }) => {
    await navigateToApp(page, 'pdf')
    await waitForDocumentReady(page)

    await expect(page.locator('body')).toBeVisible()
  })
})
