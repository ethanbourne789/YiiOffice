/**
 * Shared helpers for YiiOffice Wails V3 E2E tests.
 *
 * Adapted from the Electron E2E helpers. Key differences:
 *
 * - No `electron.launch()` -- we launch a Playwright Chromium browser and
 *   navigate to the Vite dev server (http://localhost:5173).
 * - No `app.evaluate()` -- we use `page.evaluate()` instead.
 * - No real Electron userData dir -- we create a temp dir for file
 *   operations and use `storageState` / `addInitScript` to seed settings.
 * - No native dialog stubbing needed -- Playwright's dialog handler takes
 *   care of it, or we mock via `page.evaluate()`.
 * - Each "page" (editor tab) is a route in the same SPA, so
 *   `waitForPageWithUrl()` waits for route changes instead of new windows.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixture'
import { mkdirSync, existsSync } from 'node:fs'
import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the E2E artifacts directory (screenshots, videos, etc.). */
export const ARTIFACTS_DIR = resolve(__dirname, 'artifacts')

/** Base URL of the Vite dev server in Wails dev mode. */
const DEV_SERVER_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5178'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for launching a test browser context.
 *
 * Mirrors the Electron `LaunchOptions` interface but adapted for browser
 * testing against a dev server.
 */
export interface LaunchOptions {
  /** Pre-seed onboardingSeen=true to skip the onboarding flow. */
  onboardingSeen?: boolean
  /** Extra settings to write into the simulated app-settings.json. */
  settings?: Record<string, unknown>
  /** UI language override (injected as YIIOFFICE_LANG env var mock). */
  lang?: string
  /** Absolute file path to open on launch (not supported in pure browser mode; logged as a warning). */
  openFile?: string
  /** Subdir under ARTIFACTS_DIR for this run's video recordings. */
  videoDir?: string
  /** Extra environment variable key-value pairs injected via addInitScript. */
  env?: Record<string, string>
}

/**
 * Handle returned by `launchShell()`.
 *
 * Adapted from the Electron version: `app` is now a `BrowserContext` instead
 * of an `ElectronApplication`, and we no longer have a real Electron process.
 */
export interface LaunchedApp {
  /** The Playwright page (main browser tab). */
  page: Page
  /** The browser context the page belongs to. */
  context: BrowserContext
  /** Temp directory for file operations (matches userDataDir in Electron version). */
  userDataDir: string
}

// ---------------------------------------------------------------------------
// launchShell
// ---------------------------------------------------------------------------

/**
 * Launch a Playwright browser context and navigate to the shell home page.
 *
 * Adapted from the Electron version of `launchShell()`. Instead of spawning
 * an Electron process, we:
 * 1. Create a temporary user-data directory.
 * 2. Seed app-settings.json if onboardingSeen / settings are provided.
 * 3. Create a browser context with optional video recording.
 * 4. Inject env vars and Wails bridge mocks via addInitScript.
 * 5. Navigate to the dev server home page.
 */
export async function launchShell(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // 1. Create temp directory (same pattern as Electron: mkdtemp)
  const userDataDir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-'))

  // 2. Seed app-settings.json if needed
  if (options.onboardingSeen || options.settings) {
    const settingsPath = join(userDataDir, 'app-settings.json')
    const settings: Record<string, unknown> = {
      ...(options.onboardingSeen ? { onboardingSeen: true } : {}),
      ...options.settings,
    }
    // Write via fs/promises
    const { writeFile } = await import('node:fs/promises')
    await writeFile(settingsPath, JSON.stringify(settings))
  }

  // 3. Log warning if openFile was passed (not actionable in pure browser mode)
  if (options.openFile) {
    console.warn(
      `[launchShell] openFile="${options.openFile}" is not supported in browser-mode E2E. ` +
        'The file will not be auto-opened on launch.',
    )
  }

  // 4. Build env var injection script
  const envVars = {
    YIIOFFICE_USER_DATA: userDataDir,
    YIIOFFICE_LANG: options.lang ?? 'en',
    ...(options.env ?? {}),
  }

  // 5. Create a fresh browser context via the Playwright fixture
  //    (we get the context from the test's `context` fixture, but for
  //     standalone use we create one with `browser.newContext()`).
  //    NOTE: When called from a test that already provides `page` / `context`,
  //    callers should use the fixture versions. This standalone path is for
  //    tests that need full control over context creation.

  // We cannot call `browser.newContext()` directly here because Playwright
  // manages the browser instance in its fixture system. Instead, we return
  // a LaunchedApp that the test can work with via the provided page/context.
  // The actual page setup is done via the helper below.

  return {
    page: null as any, // set by setupPageAfterLaunch
    context: null as any,
    userDataDir,
  }
}

/**
 * Set up the page and context after a launchShell() call when working within
 * a Playwright test fixture. This applies env var injection, navigates to the
 * home page, and waits for document ready.
 *
 * Call this after `launchShell()` to wire up the test's page/context.
 */
export async function setupPageAfterLaunch(
  launched: LaunchedApp,
  page: Page,
  context: BrowserContext,
  options?: LaunchOptions,
): Promise<LaunchedApp> {
  launched.page = page
  launched.context = context

  // Inject environment variables via addInitScript
  const envVars: Record<string, string> = {
    YIIOFFICE_USER_DATA: launched.userDataDir,
    YIIOFFICE_LANG: options?.lang ?? 'en',
    ...(options?.env ?? {}),
  }

  await context.addInitScript((vars) => {
    // Expose as process.env-like global for code that reads process.env
    ;(window as any).__E2E_ENV = vars
    // Also set on a fake process object if the app reads it
    if (!(window as any).process) {
      ;(window as any).process = { env: {} }
    }
    Object.assign((window as any).process.env, vars)
  }, envVars)

  // Mock Wails bridge globals if not already present (dev server may not have them)
  await context.addInitScript(() => {
    // Only mock if the real Wails bridge is not available
    if (!(window as any).aiOffice) {
      ;(window as any).aiOffice = {
        openPath: async () => {},
        setTheme: async () => {},
        getVersion: async () => 'e2e-mock',
      }
    }
    if (!(window as any).aiOfficeTabs) {
      ;(window as any).aiOfficeTabs = {
        createTab: async () => ({}),
        closeTab: async () => {},
        getTabs: async () => [],
      }
    }
    if (!(window as any).slidesApi) {
      ;(window as any).slidesApi = {}
    }
    if (!(window as any).pdfApi) {
      ;(window as any).pdfApi = {}
    }
    if (!(window as any).markdownApi) {
      ;(window as any).markdownApi = {}
    }
    if (!(window as any).desktop) {
      ;(window as any).desktop = {}
    }
    if (!(window as any).desktopApi) {
      ;(window as any).desktopApi = {}
    }
  })

  // Navigate to the home page
  await page.goto(DEV_SERVER_URL)
  await waitForDocumentReady(page)

  return launched
}

// ---------------------------------------------------------------------------
// closeAndSaveVideo
// ---------------------------------------------------------------------------

/**
 * Close the browser context cleanly.
 *
 * Adapted from the Electron version. In the Electron version, this stubbed
 * the native dialog and force-killed the process if close() hung. In browser
 * mode, we just close the context -- Playwright handles cleanup gracefully.
 *
 * If a video was recorded, saves it to the artifacts directory.
 */
export async function closeAndSaveVideo(
  launched: LaunchedApp,
  name: string,
): Promise<string | undefined> {
  const video = launched.page.video()

  // Close the context cleanly (no Electron dialog stubbing needed)
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

/**
 * Return the file path where a screenshot with the given name should be saved.
 * Matches the Electron version: artifacts/screenshots/{name}.png
 */
export function screenshotPath(name: string): string {
  return join(ARTIFACTS_DIR, 'screenshots', `${name}.png`)
}

// ---------------------------------------------------------------------------
// waitForPageWithUrl
// ---------------------------------------------------------------------------

/**
 * Wait for the current page URL to contain `urlPart`.
 *
 * Adapted from the Electron version. In Electron, each editor was a separate
 * BrowserWindow / WebContentsView, so we iterated over `app.windows()`.
 * In Wails (SPA mode), each "page" is a route, so we just wait for the
 * current page's URL to match the expected part.
 *
 * Returns the current page (same semantics as the Electron version returning
 * the matching Page).
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
 *
 * This is the SPA-friendly version of `waitForPageWithUrl`. Instead of waiting
 * for the full URL, it checks `window.location.pathname`.
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

/**
 * Wait for the application to be ready by checking for document ready state.
 *
 * Adapted from the Electron version which polled `page.evaluate()` because
 * Playwright could miss Electron's load lifecycle events. In browser mode,
 * `page.waitForFunction()` is reliable, but we still guard against
 * `about:blank` (the initial blank page before navigation).
 */
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

/**
 * Create a temporary directory for E2E isolation.
 *
 * Added async cleanup via the returned `cleanup` function.
 */
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

/**
 * Create a temp dir and return just the path (sync-compatible signature).
 * Use the full `createTempDir()` above when you need automatic cleanup.
 */
export function createTempDirSync(): string {
  const dir = join(tmpdir(), 'yiioffice-e2e-', Date.now().toString(36))
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// navigateToApp
// ---------------------------------------------------------------------------

/**
 * Navigate to a specific app route (e.g. 'docs', 'slides', 'sheets', 'pdf', 'markdown').
 */
export async function navigateToApp(page: Page, app: string): Promise<void> {
  await page.goto(`/${app}`)
  await waitForDocumentReady(page)
}

// ---------------------------------------------------------------------------
// getTabBar
// ---------------------------------------------------------------------------

/**
 * Return a locator for the tab bar element.
 */
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

/**
 * Set up the Playwright dialog handler to automatically accept all dialogs
 * (alert, confirm, prompt).
 *
 * In the Electron version, dialogs were stubbed via `app.evaluate(({ dialog }) => {
 *   dialog.showMessageBox = ...
 * })`. In browser mode, Playwright's `page.on('dialog')` handler is sufficient.
 */
export function mockDialogAccept(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
}

/**
 * Set up the Playwright dialog handler to dismiss all dialogs.
 */
export function mockDialogDismiss(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.dismiss()
  })
}

/**
 * Mock the save dialog by intercepting the `showSaveFilePicker` API via
 * page.evaluate, so that when the app triggers a save, it resolves with
 * a mock file handle pointing to `filePath`.
 */
export async function mockSaveDialog(
  page: Page,
  filePath: string,
): Promise<void> {
  await page.evaluate((path) => {
    // Mock the File System Access API's showSaveFilePicker
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

/**
 * Trigger a save action via keyboard shortcut (Ctrl+S / Cmd+S).
 *
 * In the Electron version, save was often triggered by invoking an IPC channel.
 * In Wails, the frontend handles keyboard shortcuts, so we simulate the keypress.
 */
export async function triggerSave(page: Page): Promise<void> {
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${modKey}+S`)
}

/**
 * Trigger a menu action by invoking the frontend API or keyboard shortcut.
 *
 * Adapted for Wails: menu actions are typically handled via keyboard shortcuts
 * or by calling the Wails bridge APIs. If `action` is a known shortcut,
 * we press it; otherwise we try calling `window.aiOffice[action]()`.
 *
 * Known actions:
 * - 'save' -> Ctrl+S
 * - 'newTab' -> Ctrl+T
 * - 'closeTab' -> Ctrl+W
 * - 'undo' -> Ctrl+Z
 * - 'redo' -> Ctrl+Shift+Z
 * - 'copy' -> Ctrl+C
 * - 'paste' -> Ctrl+V
 * - 'cut' -> Ctrl+X
 * - 'selectAll' -> Ctrl+A
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

  // Fall back to calling the Wails bridge API
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

/**
 * Inject an environment variable into the page via `page.evaluate()`.
 *
 * In the Electron version, env vars were set on the spawned process.
 * In browser mode, we inject them into `window.process.env` and
 * `window.__E2E_ENV` so the frontend code can read them.
 *
 * For vars that need to be available from page load, use `addInitScript`
 * on the context instead (see `setupPageAfterLaunch`).
 */
export async function setEnvVar(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate((k, v) => {
    // Inject into our E2E env global
    ;(window as any).__E2E_ENV = { ...((window as any).__E2E_ENV ?? {}), [k]: v }
    // Also set on the fake process.env
    if (!(window as any).process) {
      ;(window as any).process = { env: {} }
    }
    ;(window as any).process.env[k] = v
  }, key, value)
}

/**
 * Batch-inject environment variables via `context.addInitScript()`.
 * These are available from the very first page load.
 *
 * Use this instead of `setEnvVar` when the vars need to be present
 * before the app initializes (e.g. YIIOFFICE_LANG, YIIOFFICE_USER_DATA).
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
