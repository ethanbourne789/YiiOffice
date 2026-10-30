import { defineConfig } from '@playwright/test'

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
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5178', // shell dev server port
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
