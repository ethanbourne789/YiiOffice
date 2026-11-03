import { expect, type Page } from '@playwright/test'
import type { EditorHandle } from './editors'

/**
 * Univer driving helpers for the real-backend sheets specs.
 *
 * The grid is a canvas, so there are no DOM cells to assert against. The app
 * ships an opt-in e2e hook (frontend/apps/sheets/src/renderer/App.tsx: it
 * exposes the Univer Facade on `window.__yiiofficeDebug.univerAPI` only when
 * `window.__yiiofficeDebugHooks === true` before boot). Enabling that flag via
 * `addInitScript` is the sanctioned driver surface: assertions read the same
 * model the canvas paints from, and edits go through the same Facade commands
 * the ribbon dispatches.
 */

/** Enable the app's debug hooks for every frame loaded after this call. */
export function enableSheetsDebugHooks(page: Page): Promise<void> {
  return page.addInitScript(() => {
    ;(window as unknown as Record<string, unknown>).__yiiofficeDebugHooks = true
  })
}

/**
 * Deterministically wait until the app has assigned the Univer facade to
 * `window.__yiiofficeDebug.univerAPI`. The init-script flag is set before the
 * frame loads, but the assignment only happens once Univer finishes booting;
 * evaluating in that window used to race the first poll of each test.
 */
async function waitForUniverHook(editor: EditorHandle, timeout = 30_000): Promise<void> {
  await editor.frame.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __yiiofficeDebug?: { univerAPI?: unknown } }).__yiiofficeDebug
          ?.univerAPI,
      ),
    undefined,
    { timeout },
  )
}

/**
 * Evaluate a `(api, wb) => …` expression against the Univer Facade inside the
 * editor frame. `api` is FUniver, `wb` the active FWorkbook. The source is a
 * string so it survives the frame boundary; async sources resolve before the
 * promise returns to the test.
 */
export async function univerEval<T>(editor: EditorHandle, source: string): Promise<T> {
  await waitForUniverHook(editor)
  return editor.frame.evaluate(
    ([src]) => {
      const w = window as unknown as {
        __yiiofficeDebug?: { univerAPI?: { getActiveWorkbook(): unknown } }
      }
      const api = w.__yiiofficeDebug?.univerAPI
      if (!api) throw new Error('__yiiofficeDebug.univerAPI missing — hooks not enabled before open')
      const wb = api.getActiveWorkbook()
      if (!wb) throw new Error('Univer reports no active workbook')
      // eslint-disable-next-line no-new-func
      return new Function('api', 'wb', `return (${src})(api, wb)`)(api, wb)
    },
    [source],
  )
}

/** Poll a facade expression until the predicate holds (no fixed sleeps). */
export function pollUniver<T>(
  editor: EditorHandle,
  source: string,
  predicate: (value: T) => boolean,
  message: string,
  timeout = 30_000,
): Promise<void> {
  return expect
    .poll(async () => predicate(await univerEval<T>(editor, source)), { timeout, message })
    .toBe(true)
}

/**
 * Move the grid selection with the name box (the keyboard alternative to
 * pixel-clicking a canvas cell), then type a value and commit it with Enter.
 */
export async function typeIntoCell(
  page: Page,
  editor: EditorHandle,
  ref: string,
  text: string,
): Promise<void> {
  const nameBox = editor.ui.locator('[data-u-comp="defined-name"] input')
  await nameBox.click()
  await nameBox.fill(ref)
  await nameBox.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
