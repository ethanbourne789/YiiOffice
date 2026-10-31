/**
 * Shared helpers for YiiOffice Wails V3 E2E tests.
 *
 * Runs against the real `wails3 dev` server (port 9245 by default), matching
 * the official Wails V3 E2E guide at https://v3.wails.io/guides/e2e-testing/.
 *
 * No bridge mocking is required — the Go backend handles all $Call.ByID
 * invocations.  Helpers focus on page navigation, temp directory management,
 * dialog handling, and keyboard shortcuts.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test } from './fixture'
import { mkdirSync } from 'node:fs'
import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the E2E artifacts directory (screenshots, videos, etc.). */
export const ARTIFACTS_DIR = resolve(__dirname, 'artifacts')

/** Base URL of the Wails dev server. */
const DEV_SERVER_URL = process.env.E2E_BASE_URL ?? 'http://localhost:9245'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for setting up a test context.
 */
export interface LaunchOptions {
  /** Pre-seed onboardingSeen=true to skip the onboarding flow. */
  onboardingSeen?: boolean
  /** Extra settings to write into the simulated app-settings.json. */
  settings?: Record<string, unknown>
  /** UI language override (injected as YIIOFFICE_LANG env var mock). */
  lang?: string
  /** Absolute file path to open on launch (passed to the app via file-chooser dialog). */
  openFile?: string
  /** Subdir under ARTIFACTS_DIR for this run's video recordings. */
  videoDir?: string
  /** Extra environment variable key-value pairs injected via addInitScript. */
  env?: Record<string, string>
}

/**
 * Handle returned by `launchShell()`.
 */
export interface LaunchedApp {
  /** The Playwright page (main browser tab). */
  page: Page
  /** The browser context the page belongs to. */
  context: BrowserContext
  /** Temp directory for file operations. */
  userDataDir: string
}

// ---------------------------------------------------------------------------
// launchShell
// ---------------------------------------------------------------------------

/**
 * Create a Playwright page backed by the real Wails dev server.
 *
 * In the old frontend-mock mode this spawned an Electron process.  Now it
 * simply creates a temp directory, injects env vars via addInitScript, and
 * navigates to the Wails dev server.
 */
export async function launchShell(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // 1. Create temp directory
  const userDataDir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-'))

  // 2. Seed app-settings.json if needed
  if (options.onboardingSeen || options.settings) {
    const settingsPath = join(userDataDir, 'app-settings.json')
    const settings: Record<string, unknown> = {
      ...(options.onboardingSeen ? { onboardingSeen: true } : {}),
      ...options.settings,
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(settingsPath, JSON.stringify(settings))
  }

  return {
    page: null as any, // set by setupPageAfterLaunch
    context: null as any,
    userDataDir,
  }
}

/**
 * Wire up the test's page/context: inject env vars and navigate to the
 * Wails dev server home page.
 */
export async function setupPageAfterLaunch(
  launched: LaunchedApp,
  page: Page,
  context: BrowserContext,
  options?: LaunchOptions,
): Promise<LaunchedApp> {
  launched.page = page
  launched.context = context

  // Inject environment variables so the frontend can read them via
  // window.__E2E_ENV or window.process.env.
  const envVars: Record<string, string> = {
    YIIOFFICE_USER_DATA: launched.userDataDir,
    YIIOFFICE_LANG: options?.lang ?? 'en',
    ...(options?.env ?? {}),
  }

  await context.addInitScript((vars) => {
    ;(window as any).__E2E_ENV = vars
    if (!(window as any).process) {
      ;(window as any).process = { env: {} }
    }
    Object.assign((window as any).process.env, vars)
  }, envVars)

  // Navigate to the home page served by the Wails dev server
  await page.goto(DEV_SERVER_URL)
  await waitForDocumentReady(page)

  return launched
}

// ---------------------------------------------------------------------------
// closeAndSaveVideo
// ---------------------------------------------------------------------------

/**
 * Close the browser context cleanly.  If a video was recorded, saves it
 * to the artifacts directory.
 */
export async function closeAndSaveVideo(
  launched: LaunchedApp,
  name: string,
): Promise<string | undefined> {
  const video = launched.page.video()

  await launched.context.close().catch(() => {})

  if (!video) return undefined

  const target = join(ARTIFACTS_DIR, 'videos', `${name}.webm`)
  try {
    await video.saveAs(target)
    return target
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// screenshotPath
// ---------------------------------------------------------------------------

/** Return the file path where a screenshot should be saved. */
export function screenshotPath(name: string): string {
  return join(ARTIFACTS_DIR, 'screenshots', `${name}.png`)
}

// ---------------------------------------------------------------------------
// waitForPageWithUrl
// ---------------------------------------------------------------------------

/**
 * Wait for the current page URL to contain `urlPart`.
 */
export async function waitForPageWithUrl(
  page: Page,
  urlPart: string,
  timeoutMs = 30_000,
): Promise<Page> {
  await page.waitForFunction(
    (part) => window.location.href.includes(part),
    urlPart,
    { timeout: timeoutMs },
  )
  return page
}

/**
 * Wait for the page to navigate to a route matching `routePart` and return the page.
 */
export async function waitForRoute(
  page: Page,
  routePart: string,
  timeoutMs = 30_000,
): Promise<Page> {
  await page.waitForFunction(
    (part) => window.location.pathname.includes(part),
    routePart,
    { timeout: timeoutMs },
  )
  return page
}

// ---------------------------------------------------------------------------
// waitForDocumentReady
// ---------------------------------------------------------------------------

/** Wait for the application to be ready. */
export async function waitForDocumentReady(
  page: Page,
  timeoutMs = 30_000,
): Promise<void> {
  await page.waitForFunction(
    () =>
      document.readyState !== 'loading' &&
      window.location.href !== 'about:blank'
        ? document.readyState
        : null,
    { timeout: timeoutMs },
  )
}

// ---------------------------------------------------------------------------
// createTempDir
// ---------------------------------------------------------------------------

/** Create a temporary directory with automatic cleanup. */
export async function createTempDir(): Promise<{
  path: string
  cleanup: () => Promise<void>
}> {
  const dir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-'))
  return {
    path: dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** Create a temp dir and return just the path (sync-compatible). */
export function createTempDirSync(): string {
  const dir = join(tmpdir(), 'yiioffice-e2e-', Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// navigateToApp
// ---------------------------------------------------------------------------

/** Navigate to a specific app route (e.g. 'docs', 'slides', 'sheets', 'pdf', 'markdown'). */
export async function navigateToApp(page: Page, app: string): Promise<void> {
  await page.goto(`/${app}`)
  await waitForDocumentReady(page)
}

// ---------------------------------------------------------------------------
// getTabBar
// ---------------------------------------------------------------------------

/** Return a locator for the tab bar element. */
export async function getTabBar(page: Page): Promise<ReturnType<typeof page.locator>> {
  return page.locator('[data-testid="tab-bar"], [class*="tab-bar"], [class*="tabs"]')
}

// ---------------------------------------------------------------------------
// homeTest
// ---------------------------------------------------------------------------

/**
 * Playwright test fixture that provides a temporary userData directory
 * with automatic cleanup after the test.
 */
export const homeTest = test.extend<{
  userDataDir: string
}>({
  userDataDir: async ({}, use) => {
    const { path, cleanup } = await createTempDir()
    await use(path)
    await cleanup()
  },
})

// ---------------------------------------------------------------------------
// Dialog mocking helpers
// ---------------------------------------------------------------------------

/** Automatically accept all browser dialogs (alert, confirm, prompt). */
export function mockDialogAccept(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
}

/** Dismiss all browser dialogs. */
export function mockDialogDismiss(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.dismiss()
  })
}

/**
 * Mock the save dialog by intercepting `showSaveFilePicker`, resolving with
 * a mock file handle pointing to `filePath`.
 */
export async function mockSaveDialog(
  page: Page,
  filePath: string,
): Promise<void> {
  await page.evaluate((path) => {
    // @ts-expect-error -- showSaveFilePicker may not be in the TS lib types
    window.showSaveFilePicker = async () => {
      const handle = {
        name: path.split('/').pop()?.split('\\').pop() ?? 'output',
        createWritable: async () => ({
          write: async () => {},
          close: async () => {},
        }),
      }
      return handle as any
    }
  }, filePath)
}

// ---------------------------------------------------------------------------
// Save / menu action triggers
// ---------------------------------------------------------------------------

/** Trigger a save action via keyboard shortcut (Ctrl+S). */
export async function triggerSave(page: Page): Promise<void> {
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${modKey}+S`)
}

/**
 * Trigger a menu action by keyboard shortcut or bridge API call.
 */
export async function triggerMenuAction(
  page: Page,
  action: string,
): Promise<void> {
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

  const shortcutMap: Record<string, string> = {
    save: `${modKey}+S`,
    newTab: `${modKey}+T`,
    closeTab: `${modKey}+W`,
    undo: `${modKey}+Z`,
    redo: `${modKey}+Shift+Z`,
    copy: `${modKey}+C`,
    paste: `${modKey}+V`,
    cut: `${modKey}+X`,
    selectAll: `${modKey}+A`,
  }

  if (action in shortcutMap) {
    await page.keyboard.press(shortcutMap[action])
    return
  }

  // Fall back to calling the bridge API
  await page.evaluate((actionName) => {
    const bridge = (window as any).aiOffice
    if (bridge && typeof bridge[actionName] === 'function') {
      return bridge[actionName]()
    }
    throw new Error(`No handler for menu action: ${actionName}`)
  }, action)
}

// ---------------------------------------------------------------------------
// Environment variable injection
// ---------------------------------------------------------------------------

/** Inject an environment variable into the page at runtime. */
export async function setEnvVar(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate((k, v) => {
    ;(window as any).__E2E_ENV = { ...((window as any).__E2E_ENV ?? {}), [k]: v }
    if (!(window as any).process) {
      ;(window as any).process = { env: {} }
    }
    ;(window as any).process.env[k] = v
  }, key, value)
}

/**
 * Batch-inject environment variables via `context.addInitScript()`.
 * Available from the first page load.
 */
export async function setEnvVarsOnInit(
  context: BrowserContext,
  vars: Record<string, string>,
): Promise<void> {
  await context.addInitScript((envVars) => {
    ;(window as any).__E2E_ENV = { ...((window as any).__E2E_ENV ?? {}), ...envVars }
    if (!(window as any).process) {
      ;(window as any).process = { env: {} }
    }
    Object.assign((window as any).process.env, envVars)
  }, vars)
}
