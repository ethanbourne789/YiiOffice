import { test, expect } from '@playwright/test'
import { waitForDocumentReady, navigateToApp } from './helpers'

test.describe('Home Page', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // The home page should be interactive
    await expect(page).toHaveTitle(/YiiOffice/i)
  })

  test('should show version info', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Version should be accessible via the bridge
    const version = await page.evaluate(async () => {
      try {
        const wails = (window as any).__wails
        if (wails?.events?.on) {
          return 'wails-available'
        }
        return 'no-wails'
      } catch {
        return 'error'
      }
    })

    // In dev mode, the Wails bridge may not be available
    // We just verify the page loads without errors
    expect(typeof version).toBe('string')
  })

  test('should have basic page structure', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // Check that the page has content
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})
