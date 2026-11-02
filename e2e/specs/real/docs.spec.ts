import { test, expect } from '../../fixtures/app'
import { readDocxText, writeDocx } from '../../fixtures/documents'
import { saveWithKeyboard } from '../../fixtures/editors'
import { stat } from 'node:fs/promises'

/**
 * Docs editor: the complete document journey — open from disk, edit, save back.
 *
 * The Electron suite asserted the same journey by reading the bytes back from
 * Node; that is the assertion that actually proves a save happened, and it only
 * works against a real backend. Both halves of the Wails save path are covered
 * on purpose: the ArrayBuffer→base64 hop in `wails-bridge/binary.ts` and the
 * Go writer behind `DocsService.SaveDocx`, which is what broke when an opened
 * document reported "保存失败: cannot unmarshal object into Go value of type
 * string".
 */

test.describe('docs: open, edit, save', () => {
  test('typing into a document then Ctrl+S writes the change to the file', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'roundtrip.docx', 'Original paragraph')

    const editor = await app.openFile(path, { kind: 'docs', title: 'roundtrip.docx' })
    const page = editor.ui.locator('.doc-page[contenteditable="true"]').first()
    await expect(page).toBeVisible({ timeout: 30_000 })
    await expect(page).toContainText('Original paragraph')

    await page.click()
    await app.page.keyboard.press('Control+End')
    await app.page.keyboard.type('E2E-TYPED')
    await expect(page).toContainText('E2E-TYPED')

    await saveWithKeyboard(app.page)

    // The editor reports success in its own status bar…
    await expect(editor.ui.locator('.status-bar')).toContainText(/已保存|Saved/, {
      timeout: 20_000,
    })
    // …and the bytes on disk carry the edit (the check that matters).
    await expect
      .poll(async () => readDocxText(path).then((xml) => xml.includes('E2E-TYPED')), {
        timeout: 20_000,
        message: 'saved .docx should contain the typed text',
      })
      .toBe(true)

    const after = (await stat(path)).size
    // The app rewrites the whole package with its own zip writer, so the file
    // may shrink (our fixture skeleton carries parts the editor does not emit).
    // What matters is that a real, non-empty package replaced it.
    expect(after).toBeGreaterThan(0)
  })

  test('a save leaves a valid OOXML package, not a truncated file', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'atomic.docx', 'Atomic')
    const editor = await app.openFile(path, { kind: 'docs' })

    await editor.ui.locator('.doc-page[contenteditable="true"]').first().click()
    await app.page.keyboard.type('ATOMIC-CHECK')
    await saveWithKeyboard(app.page)

    // readDocxText unzips the package and requires word/document.xml: a
    // half-written file (crash during save) fails here rather than in Word.
    await expect
      .poll(async () => (await readDocxText(path)).includes('ATOMIC-CHECK'), {
        timeout: 20_000,
      })
      .toBe(true)
  })

  test('a 0-byte .docx opens as an editable blank document', async ({ app }) => {
    // Regression shape from the Electron suite: a 0-byte file (aborted
    // download) used to white-screen the tab. It must open as a usable blank
    // document that keeps its own tab title.
    const path = await writeDocx(app.workDir, 'seed.docx', 'seed')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, '')

    const editor = await app.openFile(path, { kind: 'docs', title: 'seed.docx' })
    const page = editor.ui.locator('.doc-page[contenteditable="true"]').first()
    await expect(page).toBeVisible({ timeout: 30_000 })

    await page.click()
    await app.page.keyboard.type('restored')
    await expect(page).toContainText('restored')
  })

  // Known defect, recorded rather than hidden: a document recovered from an
  // unparsable/empty file loses its path, so Ctrl+S falls through to "Save As"
  // and asks for a location instead of writing the file the user opened. In
  // server mode there is no native dialog at all ("file dialogs not available in
  // server mode"), which is how the harness surfaced it.
  test.fixme('a recovered blank document saves back to its own path', async ({ app }) => {
    const path = await writeDocx(app.workDir, 'resave.docx', 'seed')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, '')

    const editor = await app.openFile(path, { kind: 'docs', title: 'resave.docx' })
    await editor.ui.locator('.doc-page[contenteditable="true"]').first().click()
    await app.page.keyboard.type('restored')
    await saveWithKeyboard(app.page)

    await expect
      .poll(
        async () => {
          try {
            return (await readDocxText(path)).includes('restored')
          } catch {
            return false
          }
        },
        { timeout: 20_000, message: 'a blank document must save back to its own path' },
      )
      .toBe(true)
  })
})
