import { defineConfig } from '@playwright/test'

/**
 * E2E config — Playwright against the shell Vite dev server.
 *
 * The multi-app workspace layout (apps/shell, apps/docs, …) is not directly
 * supported by `wails3 dev` (which expects a single Vite root). The fixture
 * injects minimal startup stubs so the app boots without the Go backend.
 *
 * For a full real-backend E2E see the official guide:
 * https://v3.wails.io/guides/e2e-testing/
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false, // WebView2 instance parallelism issues
  workers: 1,           // single worker for deterministic runs
  timeout: 90_000,      // 90s timeout per test
  expect: {
    timeout: 10_000,
  },
  snapshotPathTemplate: '{testDir}/visual-baselines/{arg}{ext}',
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5178', // shell dev server
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
