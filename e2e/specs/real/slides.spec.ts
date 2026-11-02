import { test, expect } from '../../fixtures/app'
import { waitForActiveEditor } from '../../fixtures/editors'

/**
 * Slides editor.
 *
 * The blank-deck render currently throws inside App (`TypeError: Cannot read
 * properties of undefined (reading 'length')`) about 400 ms after the ribbon
 * paints, which unmounts `#root`. The tab-level assertion in `shell.spec.ts`
 * still sees the ribbon in that window, so it passes — this case is registered
 * as `fixme` to keep the crash visible instead of relying on that race.
 */

test.describe('slides: boot', () => {
  test.fixme('a new deck keeps its stage after the first paint', async ({ app }) => {
    await app.page.evaluate(() => window.aiOffice.newSlide())
    const tab = await waitForActiveEditor(app.page, { kind: 'slides' })
    const editor = await app.editor(tab)

    await expect(editor.ui.locator('.ribbon').first()).toBeVisible()
    // Give the deferred render a chance to settle, then require a stage.
    await app.page.waitForTimeout(1500)
    await expect(editor.ui.locator('.slide-list, .sorter-view, canvas').first()).toBeVisible()
  })
})
