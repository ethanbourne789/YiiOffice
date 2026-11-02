import { test as base, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startServer, type TestServer } from './server'
import {
  closeAllTabs,
  editorFor,
  listTabs,
  openDocument,
  waitForActiveEditor,
  type EditorHandle,
  type Tab,
} from './editors'

/**
 * Real-backend fixture.
 *
 * Deliberately does **not** import `../fixture` — the legacy suite stubs
 * `window.aiOffice` and friends so the shell can boot without a backend, which
 * means it never exercises the Go services. Here the app boots against its own
 * server build, and the helper below fails the test if the bridge looks stubbed,
 * so the two harnesses can never be confused with each other.
 */

export interface App {
  page: Page
  server: TestServer
  /** Fresh scratch directory for this test's documents. */
  workDir: string
  tabs(): Promise<Tab[]>
  open(): Promise<EditorHandle>
  openFile(path: string, expected?: { kind?: Tab['kind']; title?: string }): Promise<EditorHandle>
  /** Mark the test's page as "an editor is open" and return its iframe handle. */
  editor(tab?: Tab): Promise<EditorHandle>
  closeAllTabs(): Promise<void>
}

export const test = base.extend<{ app: App; workDir: string }, { server: TestServer }>({
  // One server build per worker: own port, own YIIOFFICE_USER_DATA. Wails'
  // TabHost is process-wide, so sharing a host across parallel tests would leak
  // tabs between them.
  server: [
    async ({}, use, workerInfo) => {
      const { server, stop } = await startServer()
      if (workerInfo.project.name) {
        console.log(`[e2e] ${workerInfo.project.name} host on ${server.baseURL}`)
      }
      await use(server)
      await stop()
    },
    { scope: 'worker' },
  ],

  page: async ({ page, server }, use, testInfo) => {
    await page.goto(server.baseURL + '/', { waitUntil: 'domcontentloaded' })
    // The home tab's sidebar only renders once Go answered getLanguage/getTheme
    // and TabService.List returned the host's tabs — i.e. the backend is live.
    await expect(page.getByTestId('nav-recent')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await listTabs(page)).length, {
        timeout: 20_000,
        message: 'TabService.List should report the host home tab',
      })
      .toBeGreaterThan(0)

    // A crash or timeout in the previous test can leave its tab behind (the
    // teardown runs on a best-effort basis), so each test starts from a clean
    // strip: only the shell's home tab.
    await closeAllTabs(page)

    await use(page)

    // Tabs live in the Go host, so a test that leaves one open changes the
    // starting state of the next one.
    await closeAllTabs(page).catch(() => undefined)
    if (testInfo.status !== testInfo.expectedStatus) {
      const log = server.logs()
      if (log) {
        await writeFile(join(testInfo.outputDir, 'server.log'), log).catch(() => undefined)
      }
    }
  },

  workDir: async ({ server }, use) => {
    const dir = await mkdtemp(join(server.dataDir, 'work-'))
    await use(dir)
    if (process.env.E2E_KEEP_DATA !== '1') {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  },

  app: async ({ page, server, workDir }, use) => {
    const app: App = {
      page,
      server,
      workDir,
      tabs: () => listTabs(page),
      open: async () => editorFor(page, await waitForActiveEditor(page)),
      openFile: (path, expected) => openDocument(page, path, expected),
      editor: async (tab) => editorFor(page, tab ?? (await waitForActiveEditor(page))),
      closeAllTabs: () => closeAllTabs(page),
    }
    await use(app)
  },
})

export { expect }
