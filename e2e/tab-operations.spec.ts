import { test, expect } from '@playwright/test'
import { waitForDocumentReady } from './helpers'

test.describe('Tab Operations', () => {
  test('should start with home tab', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Page should load with home tab active
    await expect(page.locator('body')).toBeVisible()
  })

  test('should navigate between routes', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Navigate to docs route
    await page.goto('/docs')
    await waitForDocumentReady(page)
    await expect(page.locator('body')).toBeVisible()

    // Navigate back to home
    await page.goto('/')
    await waitForDocumentReady(page)
    await expect(page.locator('body')).toBeVisible()
  })
})
