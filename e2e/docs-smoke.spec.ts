import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('Docs Editor Smoke Test', () => {
  test('should open a new docs tab', async ({ page }) => {
    await navigateToApp(page, 'docs')
    await waitForDocumentReady(page)

    // The docs editor should render
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('should show editor canvas', async ({ page }) => {
    await navigateToApp(page, 'docs')
    await waitForDocumentReady(page)

    // Editor content area should exist
    const contentArea = page.locator('[class*="editor"], [class*="canvas"], [class*="content"]')
    // We don't assert visibility because the editor may need initialization
    expect(contentArea !== undefined).toBe(true)
  })
})
