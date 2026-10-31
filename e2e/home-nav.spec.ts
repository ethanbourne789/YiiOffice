import { test, expect } from './fixture'
import { waitForDocumentReady } from './helpers'

/**
 * Shell home navigation, exercised through the semantic data-testid hooks the
 * app exposes (Wails v3 E2E best practice — keep tests off brittle class
 * names and target stable test ids).
 */
test.describe('home navigation', () => {
  test('Recent and Starred views switch via the sidebar', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    const recent = page.getByTestId('nav-recent')
    const starred = page.getByTestId('nav-starred')

    await expect(recent).toBeVisible()
    await expect(starred).toBeVisible()

    // starts on Recent
    await expect(recent).toHaveAttribute('class', /active/)

    // switch to Starred and back
    await starred.click()
    await expect(starred).toHaveAttribute('class', /active/)
    await recent.click()
    await expect(recent).toHaveAttribute('class', /active/)
  })

  test('New file menu is reachable from the tab bar', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    const newBtn = page.getByTestId('new-file')
    await expect(newBtn).toBeEnabled()
  })
})