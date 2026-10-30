// ADAPTED FROM Electron e2e — tab-tear-off-dock.spec.ts
import { test, expect } from './fixture'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchShell,
  setupPageAfterLaunch,
  closeAndSaveVideo,
  waitForRoute,
} from './helpers'

/**
 * The renderer-facing tab API behind the tear-off gesture: a tab leaves the
 * strip for a window that follows the pointer, and comes back as a tab when
 * the pointer returns — the live WebContentsView is reparented both ways, so
 * the document is never reloaded. Driven through the API because Playwright
 * cannot hold a pointer drag across two OS windows.
 *
 * ADAPTED: Tab tear-off and dock rely on Electron's BrowserWindow and
 * WebContentsView APIs — creating new native windows and reparenting
 * WebContentsView instances. Wails V3 browser mode runs in a single browser
 * tab/SPA with no multi-window capability. All tear-off/dock tests are skipped.
 */

test.describe('tab tear-off and dock', () => {
  test.skip('a torn-off markdown tab docks back without a reload; Open in New Window covers it too', async ({
    page,
    context,
  }) => {
    /**
     * Skipped: This test fundamentally depends on Electron APIs that are not
     * available in Wails browser mode:
     *
     * - BrowserWindow.getAllWindows() — no native window management in SPA mode
     * - WebContentsView reparenting — Wails uses SPA routing, not WebContentsView
     * - aiOfficeTabs.tearOff() / dockTornWindow() — these APIs operate on native
     *   BrowserWindow instances which do not exist in browser mode
     * - Multi-window tear-off/drag gesture — Playwright cannot operate across
     *   multiple native OS windows, and Wails SPA mode has only one window
     *
     * If Wails adds multi-window support in the future, this test should be
     * re-enabled with the appropriate Wails window APIs.
     */
  })
})
