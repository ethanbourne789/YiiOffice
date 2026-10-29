import { test, expect, Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * E2E helpers for YiiOffice Wails V3.
 *
 * The app is tested against the dev server (Vite on localhost:5173)
 * because Wails V3 does not expose a CDP endpoint in beta.
 */

/**
 * Waits for the application to be ready by checking for the root element.
 */
export async function waitForDocumentReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === 'complete', {
    timeout: 30_000,
  })
}

/**
 * Creates a temporary user data directory for E2E isolation.
 */
export async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), 'yiioffice-e2e-', Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Launches the YiiOffice shell binary and returns the process.
 * Note: This is for production E2E. In CI, the dev server is used.
 */
export function launchShell(options?: {
  userDataDir?: string
  lang?: string
}): ReturnType<typeof spawn> {
  const env: Record<string, string> = { ...process.env }
  if (options?.userDataDir) {
    env.YIIOFFICE_USER_DATA = options.userDataDir
  }
  if (options?.lang) {
    env.YIIOFFICE_LANG = options.lang
  }

  return spawn('..\\..\\build\\bin\\YiiOffice.exe', [], {
    env,
    detached: false,
  })
}

/**
 * Test suite for Home page.
 */
export const homeTest = test.extend<{
  userDataDir: string
}>({
  userDataDir: async ({}, use) => {
    await use(await createTempDir())
  },
})

/**
 * Helper to navigate to a specific app route.
 */
export async function navigateToApp(page: Page, app: string): Promise<void> {
  await page.goto(`/${app}`)
  await waitForDocumentReady(page)
}

/**
 * Helper to wait for and return the tab bar.
 */
export async function getTabBar(page: Page): Promise<ReturnType<typeof page.locator>> {
  return page.locator('[data-testid="tab-bar"], [class*="tab-bar"], [class*="tabs"]')
}
