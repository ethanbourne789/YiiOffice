// ADAPTED FROM Electron e2e — slides-clipboard-image.spec.ts
// OS-level clipboard tests (Electron clipboard API, BrowserWindow creation) are skipped.
// Frontend-only tests (slidesApi clipboard API) are kept.
import { test, expect } from './fixture'
import { cp, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import JSZip from 'jszip'
import { launchShell, setupPageAfterLaunch, waitForRoute, closeAndSaveVideo } from './helpers'

async function zipDirectory(dir: string, output: string): Promise<void> {
  const zip = new JSZip()
  async function walk(currentDir: string, zipFolder: JSZip): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, zipFolder.folder(entry.name)!)
      } else {
        zipFolder.file(entry.name, await readFile(fullPath))
      }
    }
  }
  await walk(dir, zip)
  await writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }))
}

/**
 * OS-level clipboard tests are skipped in Wails browser mode:
 * - Electron clipboard.has() / clipboard.read() — native OS clipboard, not accessible in browser
 * - BrowserWindow creation for external paste — Electron-only API
 * 
 * The remaining frontend-only clipboard API tests are kept below.
 */
test('Slides OS clipboard copy provides image data', async () => {
  // SKIP: Electron clipboard API not available in browser mode.
  // The original test verified that Ctrl+C on a selection populated the OS
  // clipboard with an image/png entry, then validated the PNG pixel data.
  // In Wails browser mode, the OS clipboard is not directly readable by Playwright.
  test.skip(true, 'OS clipboard API not available in Wails browser mode')
})

test('Slides external paste into new deck creates OS image', async () => {
  // SKIP: Requires Electron BrowserWindow creation and webContents.paste()
  test.skip(true, 'Electron BrowserWindow / webContents.paste() not available in Wails browser mode')
})

test('Slides internal paste stays editable and stale captures are rejected', async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), 'yiioffice-clipboard-'))
  const fixture = join(dir, 'fixture')
  await cp(resolve('e2e/assets/font-manager-rubik'), fixture, { recursive: true })
  const xmlPath = join(fixture, 'ppt/slides/slide1.xml')
  await writeFile(xmlPath, (await readFile(xmlPath, 'utf8')).replaceAll('Rubik', 'Arial'))
  const pptx = join(dir, 'selection.pptx')
  await zipDirectory(fixture, pptx)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'slides-clipboard-internal',
    openFile: pptx,
  })
  await setupPageAfterLaunch(launched, page, context)
  try {
    await waitForRoute(page, '/slides')
    await expect(page.locator('.stage-wrap canvas').first()).toBeVisible()
    const canvas = page.locator('.stage-wrap').first()
    await canvas.click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')

    // Internal paste into a different deck — uses slidesApi, no OS clipboard
    const pasted = await page.evaluate(async () => {
      const api = (window as unknown as { slidesApi: any }).slidesApi
      const kind = await api.clipboardExternal()
      await api.newBlank(1280) // Paste into a different deck, with no source page.
      const result = await api.pasteElements({ slideIndex: 0, fitWidthPx: 1280 })
      return {
        kind,
        types: result?.slide.nodes
          .filter((n: any) => result.sourceIds.includes(n.sourceId))
          .map((n: any) => n.type),
        ids: result?.sourceIds,
      }
    })
    expect(pasted.kind).toEqual({ kind: 'internal' })
    expect(pasted.types?.length).toBeGreaterThan(0)
    expect(pasted.types).not.toContain('picture')

    // A later internal copy wins even if the older PNG completes last.
    // Generate a dummy PNG base64 for the stale capture test.
    const dummyPng = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 40
      canvas.height = 30
      const c = canvas.getContext('2d')!
      c.fillStyle = '#ff0000'
      c.fillRect(0, 0, 40, 30)
      return canvas.toDataURL('image/png').split(',')[1]
    })

    await page.evaluate(async (sourceIds: string[], png: string) => {
      const api = (window as unknown as { slidesApi: any }).slidesApi
      await api.copyElements({ slideIndex: 0, sourceIds, clipboardToken: 'old-copy' })
      await api.copyElements({ slideIndex: 0, sourceIds, clipboardToken: 'new-copy' })
    }, pasted.ids!, dummyPng)

    expect(
      await page.evaluate(
        async (png: string) =>
          (window as unknown as { slidesApi: any }).slidesApi.copyElementsImage('old-copy', png),
        dummyPng,
      ),
    ).toBe(false)
    expect(
      await page.evaluate(
        async (png: string) =>
          (window as unknown as { slidesApi: any }).slidesApi.copyElementsImage('new-copy', png),
        dummyPng,
      ),
    ).toBe(true)

    // Any ordinary external copy must supersede both the internal cache and a pending PNG.
    // In browser mode, we simulate by writing text to the clipboard via the execCommand fallback
    // or by directly calling the slidesApi.
    // SKIP: Electron clipboard.writeText() is a native API not available in browsers.
    // The test would need a Wails bridge to write OS clipboard text.
  } finally {
    await closeAndSaveVideo(launched, 'slides-clipboard-internal')
  }
})
