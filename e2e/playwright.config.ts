import { defineConfig } from '@playwright/test'

/**
 * E2E configuration — one suite, one target.
 *
 * Every test drives a **server build** of the app (`-tags server`) with the real
 * Go services, per the official Wails v3 guide
 * (https://v3.wails.io/guides/e2e-testing/): same renderer bundles, same
 * services, same bindings, only the native window is gone.
 *
 * The host is spawned by `fixtures/server.ts` (one per worker, on a free port,
 * with a throw-away YIIOFFICE_USER_DATA), which is why there is no `webServer`
 * block: the guide's `webServer` is per-run, and it also asks for "one isolated
 * host per test job" — the Wails TabHost is process-wide state, so a host shared
 * by every test would leak open tabs between them. `WAILS_SERVER_HOST` /
 * `WAILS_SERVER_PORT` (documented in Server Build) point each host at its port.
 */

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  // One worker: the server build keeps tab/recents state per process, and one
  // host per worker is cheaper and more deterministic than one per test.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'real', testMatch: 'specs/real/*.spec.ts' }],
})
