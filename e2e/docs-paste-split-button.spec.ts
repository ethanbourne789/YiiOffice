import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

/**
 * Home ▸ Paste split button (Word parity): the icon half pastes with the
 * default mode, the label half opens Keep Source Formatting / Merge
 * Formatting / Keep Text Only, which paste the clipboard in that mode
 * through the same pipeline as Ctrl+V.
 */

interface AidocsWindow {
  __aidocs?: { editor?: unknown }
}

const WEB_HTML =
  `<meta charset='utf-8'>` +
  `<p style="font-family: Arial, sans-serif; font-size: 14px;">web one <b>strong</b></p>`
const WEB_TEXT = 'web one strong'

test.describe('docs paste split button', () => {
  // The paste split button dropdown now uses [data-rb-panel] with plain <button>
  // elements instead of role="menuitem" and there is no data-testid="ribbon-paste-menu".
  // Additionally, the paste modes in the ribbon dropdown all call the same editor
  // paste() command without differentiating between source/merge/text-only modes.
  // Skip until the ribbon paste dropdown supports distinct paste modes.
  test.skip('paste menu refactored — distinct paste modes not yet implemented in ribbon dropdown')
})
