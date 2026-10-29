import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('Slides Editor Smoke Test', () => {
  test('should load the slides app', async ({ page }) => {
    await navigateToApp(page, 'slides')
    await waitForDocumentReady(page)

    await expect(page.locator('body')).toBeVisible()
  })
})
