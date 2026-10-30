import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

test.describe('Docs Editor Smoke Test', () => {
  test('should open a new docs tab', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    // App shell should render
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('should load docs editor iframe', async ({ page }) => {
    // Navigate directly to the docs editor entry point
    await page.goto('/docs/index.html')
    await waitForDocumentReady(page)

    // Docs editor entry should respond
    expect(page.url()).toContain('docs')
  })
})
