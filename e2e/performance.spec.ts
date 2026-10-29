import { test, expect } from '@playwright/test'
import { waitForDocumentReady } from './helpers'

test.describe('Performance Benchmarks', () => {
  test('cold start should be within budget', async ({ page }) => {
    const start = Date.now()
    await page.goto('/')
    await waitForDocumentReady(page)
    const loadTime = Date.now() - start

    // Target: < 2.5s for cold start (may vary in CI)
    console.log(`Cold start: ${loadTime}ms`)
    expect(loadTime).toBeLessThan(5000) // 5s generous limit for CI
  })

  test('tab switch should be fast', async ({ page }) => {
    await page.goto('/')
    await waitForDocumentReady(page)

    const start = Date.now()
    await page.goto('/docs')
    await waitForDocumentReady(page)
    const switchTime = Date.now() - start

    // Target: < 200ms (generous limit for CI)
    console.log(`Tab switch: ${switchTime}ms`)
    expect(switchTime).toBeLessThan(3000)
  })

  test('page should not have console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/')
    await waitForDocumentReady(page)

    // Filter out expected warnings
    const unexpectedErrors = errors.filter(e =>
      !e.includes('ExperimentalWebPlatform') &&
      !e.includes('deprecated')
    )

    expect(unexpectedErrors).toHaveLength(0)
  })
})
