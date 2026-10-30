// ADAPTED FROM Electron e2e — text-source.spec.ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test, expect } from './fixture'
import {
  launchShell,
  setupPageAfterLaunch,
  closeAndSaveVideo,
  waitForRoute,
  triggerSave,
} from './helpers'

/**
 * A `.txt` / `.json` file has no document model behind it, so the shell route
 * used to refuse it: the open dialog and the Home list both offered the file,
 * and picking it fell through to the unsupported-file notice. These two tests
 * cover the two ways in, and pin the byte-level round-trip the source editor
 * promises on the way back out.
 */

/** BOM + CRLF + no trailing newline: the three things a naive writer normalises. */
const BOM = '\uFEFF'
const ORIGINAL_TEXT = `${BOM}first line\r\nsecond line`

test.describe('source text files', () => {
  test('a .txt picked on Home opens as source and saves back byte-identical', async ({
    page,
    context,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-txt-home-'))
    const txtPath = join(dir, 'notes.txt')
    await writeFile(txtPath, Buffer.from(ORIGINAL_TEXT, 'utf8'))

    const launched = await launchShell({
      onboardingSeen: true,
      settings: { defaultSaveDir: dir },
      videoDir: 'txt-open-from-home',
    })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Open the file via the frontend API instead of clicking the Home list
      await page.evaluate((filePath) => {
        return (window as any).aiOffice?.openPath(filePath)
      }, txtPath)

      // Wait for the markdown/source editor route
      await waitForRoute(page, '/markdown')

      // Verify file name shown in tab
      await expect(page.locator('.tab-bar .tab-item:not(.tab-home)')).toContainText(
        basename(txtPath),
      )

      // the source surface, not the block editor: a .txt has no blocks to edit
      await expect(page.locator('.source-editor')).toBeVisible()
      await expect(page.locator('.source-editor .cm-content')).toContainText('first line')
      await expect(page.locator('.source-editor .cm-content')).toContainText('second line')
      await expect(page.locator('.doc-editor')).toHaveCount(0)

      // save without editing: the file must come back exactly as it went in
      await page.locator('.source-editor .cm-content').click()
      await triggerSave(page)
      await expect(page.locator('.status-save')).toHaveText(/Saved/)

      expect(await readFile(txtPath)).toEqual(Buffer.from(ORIGINAL_TEXT, 'utf8'))
    } finally {
      await closeAndSaveVideo(launched, 'txt-open-from-home')
    }
  })

  test('editing a BOM + CRLF .txt keeps the BOM, the CRLF and the missing trailing newline', async ({
    page,
    context,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-txt-roundtrip-'))
    const txtPath = join(dir, 'notes.txt')
    await writeFile(txtPath, Buffer.from(ORIGINAL_TEXT, 'utf8'))

    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'txt-roundtrip',
      openFile: txtPath,
    })
    await setupPageAfterLaunch(launched, page, context)

    try {
      // Open the file via the frontend API
      await page.evaluate((filePath) => {
        return (window as any).aiOffice?.openPath(filePath)
      }, txtPath)

      await waitForRoute(page, '/markdown')
      const content = page.locator('.source-editor .cm-content')
      await expect(content).toBeVisible()
      await expect(content).toContainText('first line')
      await expect(content).toContainText('second line')

      await content.click()
      await page.keyboard.press('ControlOrMeta+End')
      await page.keyboard.type('!')
      await triggerSave(page)
      await expect(page.locator('.status-save')).toHaveText(/Saved/)

      // one character appended, and nothing else touched: same BOM, same CRLF,
      // and still no trailing newline (a writer that "helpfully" added one would
      // show up here as an extra byte)
      const expected = `${BOM}first line\r\nsecond line!`
      expect(await readFile(txtPath)).toEqual(Buffer.from(expected, 'utf8'))
    } finally {
      await closeAndSaveVideo(launched, 'txt-roundtrip')
    }
  })
})
