import { test, expect } from '../../fixtures/app'
import { listTabs } from '../../fixtures/editors'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

/**
 * Contract of the harness itself.
 *
 * If these fail, the suite is no longer an end-to-end test: it either lost its
 * Go backend or started writing into the developer's real profile. Both have
 * happened to this project before (a stubbed bridge passed every assertion
 * while the app was broken underneath), so the harness asserts its own
 * preconditions instead of trusting the config.
 */

test.describe('E2E harness', () => {
  test('serves the app from its own Go backend', async ({ app }) => {
    // The mock harness returns [] from `aiOfficeTabs.list()`; the real
    // TabHost always reports the home tab it created at startup.
    const tabs = await listTabs(app.page)
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.filter((tab) => tab.kind === 'home')).toHaveLength(1)

    // A real binding round-trip: RPC over /wails/runtime, answered by Go.
    const version = await app.page.evaluate(() => window.aiOffice.getAppVersion())
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('runs on a throw-away user-data directory', async ({ app }) => {
    // The host only creates its state when it starts, so anything here proves
    // the profile is the temp dir and not %APPDATA%\YiiOffice.
    const entries = await readdir(app.server.dataDir)
    expect(entries).toContain('file-index.db')
    expect(app.server.dataDir).not.toMatch(/AppData[\\/]Roaming[\\/]YiiOffice$/i)
    expect(existsSync(app.server.dataDir)).toBe(true)
  })

  test('reports a healthy host endpoint', async ({ app }) => {
    const response = await fetch(`${app.server.baseURL}/health`)
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
