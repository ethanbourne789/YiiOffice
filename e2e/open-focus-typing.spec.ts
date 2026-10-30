// ADAPTED FROM Electron e2e — open-focus-typing.spec.ts
import { test, expect } from './fixture'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import {
  launchShell,
  setupPageAfterLaunch,
  closeAndSaveVideo,
  waitForRoute,
} from './helpers'

const DOCX = resolve(__dirname, 'assets/justify-pagegap-fr.docx')
const XLSX = resolve(__dirname, '../apps/sheets/fixtures/generated/compatibility-basic.xlsx')

/**
 * A freshly opened document must own the keyboard. The regression had
 * two layers — the shell never handed webContents focus to a tab activated
 * from the Home list (the click sits on the chrome webContents), and the docs
 * editor never focused its body even in a focused view. Both are exercised by
 * the real flow: land on Home, open a file exactly like the Home list does,
 * then type without a single click into the document.
 *
 * ADAPTED: In Wails browser mode, there is no multi-webContents focus layer.
 * Focus is managed entirely by the DOM. We replace Electron-level focus checks
 * with DOM-based `document.activeElement` checks.
 */

/**
 * Open a file using the frontend API (simulating Home list click).
 * Replaces the Electron `openFromHome()` which also forced BrowserWindow focus.
 */
async function openFromHome(page: Page, file: string): Promise<void> {
  await page.evaluate(
    (p) =>
      (window as unknown as { aiOffice: { openPath(p: string): Promise<void> } }).aiOffice.openPath(
        p,
      ),
    file,
  )
}

/**
 * Wait for the document's editable surface to hold focus.
 * Replaces Electron-level focus checks with DOM-based checks.
 */
async function waitForEditableFocus(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.isContentEditable &&
      // A node detached from the document still reports isContentEditable as
      // true. A workbook loaded into an already-mounted view rebuilds the
      // editor DOM, and the stale node left under activeElement then passes
      // the two checks above while the typed text goes nowhere.
      document.activeElement.isConnected,
    null,
    { timeout: 30_000 },
  )
}

/**
 * Check that the editor's editable area has DOM focus.
 * Replaces `expectViewFocused()` which checked Electron webContents focus.
 */
async function expectEditorFocused(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement
        if (!(active instanceof HTMLElement)) return false
        return active.isContentEditable || active.closest('[contenteditable]') !== null
      }),
    )
    .toBe(true)
}

async function cellA1Value(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        __yiiofficeDebug: {
          univerAPI: {
            getActiveWorkbook(): {
              getActiveSheet(): { getRange(a: string): { getValue(): unknown } }
            }
          }
        }
      }
    ).__yiiofficeDebug.univerAPI
    return api.getActiveWorkbook()?.getActiveSheet()?.getRange('A1')?.getValue() ?? null
  })
}

/**
 * Every layer a typed character has to cross, captured as a snapshot.
 * Diagnostics only: it changes no assertion, so a failure still fails for the
 * same reason — it just says which layer dropped the text.
 */
type TypingState = {
  editorPresent: boolean
  editorText: string | null
  activeIsEditor: boolean
  activeIsConnected: boolean | null
  activeTag: string | null
  activeId: string | null
  activeClass: string | null
  activeRange: string | null
  ariaBusy: string | null
  canvasPresent: boolean
}

/** The cell Univer considers active, or null when the sheet has no selection. */
async function activeRangeNotation(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        __yiiofficeDebug?: {
          univerAPI?: {
            getActiveWorkbook?: () => {
              getActiveSheet?: () => {
                getActiveRange?: () => { getA1Notation?: () => string } | null
              } | null
            } | null
          }
        }
      }
    ).__yiiofficeDebug?.univerAPI
    return (
      api?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.()?.getA1Notation?.() ?? null
    )
  })
}

async function domState(page: Page): Promise<Omit<TypingState, 'activeRange'>> {
  return page.evaluate(() => {
    const editor = document.querySelector('#univer-container [contenteditable="true"]')
    const active = document.activeElement
    return {
      editorPresent: editor !== null,
      editorText: editor?.textContent ?? null,
      activeIsEditor: editor !== null && active === editor,
      activeIsConnected: active instanceof HTMLElement ? active.isConnected : null,
      activeTag: active?.tagName ?? null,
      activeId: active instanceof HTMLElement ? active.id || null : null,
      activeClass: active instanceof HTMLElement ? active.getAttribute('class') : null,
      ariaBusy: document.querySelector('main.app-shell')?.getAttribute('aria-busy') ?? null,
      canvasPresent: document.querySelector('#univer-container canvas') !== null,
    }
  })
}

test('docs: typing works immediately after opening a file from Home', async ({ page, context }) => {
  const scratch = await mkdtemp(join(tmpdir(), 'yiioffice-openfocus-e2e-'))
  const docx = join(scratch, 'open-focus.docx')
  await copyFile(DOCX, docx)

  const launched = await launchShell({ onboardingSeen: true, videoDir: 'open-focus-docs' })
  await setupPageAfterLaunch(launched, page, context)

  try {
    await openFromHome(page, docx)
    await waitForRoute(page, '/docs')
    await page.waitForSelector('.ProseMirror', { timeout: 30_000 })

    // Replaced: Electron expectViewFocused() -> DOM-based focus check
    await expectEditorFocused(page)
    await waitForEditableFocus(page)

    await page.keyboard.type('ROW226FOCUS')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? ''))
      .toContain('ROW226FOCUS')
  } finally {
    await closeAndSaveVideo(launched, 'open-focus-docs')
  }
})

/**
 * NOTE: Spare view test skipped in Wails browser mode.
 *
 * Electron used WebContentsView for hidden spare views that could be adopted
 * when opening a new workbook. Wails uses a different tab model — each tab
 * is a route in the SPA, not a separate WebContentsView. The prewarm/spare
 * pattern does not apply to the browser-based architecture.
 */
test.skip('sheets: typing works when a spare view opens the next workbook', async () => {
  // Skipped: Wails does not use Electron's WebContentsView spare view model.
  // Each tab is a SPA route, not a separate webContents instance.
  // The focus/typing test above covers the common DOM focus path.
})
