import { test, expect, _electron as electron } from '@playwright/test'
import { cp, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { PNG } from 'pngjs'
import JSZip from 'jszip'
import type { SlidesApi } from '../apps/slides/src/shared/ipc'

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

test('Slides copy provides an OS image while internal paste stays editable and stale captures are rejected', async ({
  browserName: _browserName,
}, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'yiioffice-clipboard-'))
  const fixture = join(dir, 'fixture')
  await cp(resolve('e2e/assets/font-manager-rubik'), fixture, { recursive: true })
  const xmlPath = join(fixture, 'ppt/slides/slide1.xml')
  await writeFile(xmlPath, (await readFile(xmlPath, 'utf8')).replaceAll('Rubik', 'Arial'))
  const pptx = join(dir, 'selection.pptx')
  await zipDirectory(fixture, pptx)
  const require = createRequire(resolve('apps/slides/package.json'))
  const { ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [
      resolve('apps/slides'),
      pptx,
    ],
    env: { ...env, YIIOFFICE_USER_DATA: join(dir, 'user-data'), YIIOFFICE_LANG: 'en' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.stage-wrap canvas').first()).toBeVisible()
    const canvas = page.locator('.stage-wrap').first()
    await canvas.click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() => app.evaluate(async ({ clipboard }) => clipboard.has('image/png')))
      .toBe(true)
    // Electron 45 turned the clipboard into the async ClipboardItem API —
    // readImage()/toPNG() are gone, so pull the PNG blob out of the entry.
    const bytes = Buffer.from(
      await app.evaluate(async ({ clipboard }) => {
        for (const item of await clipboard.read()) {
          if (!item.types.includes('image/png')) continue
          const blob = await item.getType('image/png')
          return Buffer.from(await blob.arrayBuffer()).toString('base64')
        }
        return ''
      }),
      'base64',
    )
    const png = PNG.sync.read(bytes)
    expect(png.width).toBeGreaterThan(30)
    expect(png.height).toBeGreaterThan(20)
    expect([...png.data].some((n, i) => i % 4 === 3 && n === 0)).toBe(true)
    await info.attach('clipboard-selection.png', { body: bytes, contentType: 'image/png' })

    // A plain Chromium editor has no YiiOffice code or clipboard cache.
    const externalPagePromise = app.waitForEvent('window')
    const externalId = await app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false })
      await win.loadURL('data:text/html,<div id="target" contenteditable="true"></div>')
      return win.webContents.id
    })
    const externalPage = await externalPagePromise
    await externalPage.locator('#target').focus()
    await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.paste(), externalId)
    await expect(externalPage.locator('#target img')).toHaveCount(1)
    await expect
      .poll(() =>
        externalPage
          .locator('#target img')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    await app.evaluate(
      ({ BrowserWindow, webContents }, id) =>
        BrowserWindow.fromWebContents(webContents.fromId(id)!)!.destroy(),
      externalId,
    )

    const pasted = await page.evaluate(async () => {
      const api = (window as unknown as { slidesApi: SlidesApi }).slidesApi
      const kind = await api.clipboardExternal()
      await api.newBlank(1280) // Paste into a different deck, with no source page.
      const result = await api.pasteElements({ slideIndex: 0, fitWidthPx: 1280 })
      return {
        kind,
        types: result?.slide.nodes
          .filter((n) => result.sourceIds.includes(n.sourceId))
          .map((n) => n.type),
        ids: result?.sourceIds,
      }
    })
    expect(pasted.kind).toEqual({ kind: 'internal' })
    expect(pasted.types?.length).toBeGreaterThan(0)
    expect(pasted.types).not.toContain('picture')

    // A later internal copy wins even if the older PNG completes last.
    await page.evaluate(async (sourceIds) => {
      const api = (window as unknown as { slidesApi: SlidesApi }).slidesApi
      await api.copyElements({ slideIndex: 0, sourceIds, clipboardToken: 'old-copy' })
      await api.copyElements({ slideIndex: 0, sourceIds, clipboardToken: 'new-copy' })
    }, pasted.ids!)
    expect(
      await page.evaluate(
        async (png) =>
          (window as unknown as { slidesApi: SlidesApi }).slidesApi.copyElementsImage(
            'old-copy',
            png,
          ),
        bytes.toString('base64'),
      ),
    ).toBe(false)
    expect(
      await page.evaluate(
        async (png) =>
          (window as unknown as { slidesApi: SlidesApi }).slidesApi.copyElementsImage(
            'new-copy',
            png,
          ),
        bytes.toString('base64'),
      ),
    ).toBe(true)

    // Any ordinary external copy must supersede both the internal cache and a pending PNG.
    await app.evaluate(({ clipboard }) => clipboard.writeText('external text'))
    expect(
      await page.evaluate(
        async (png) =>
          (window as unknown as { slidesApi: SlidesApi }).slidesApi.copyElementsImage(
            'new-copy',
            png,
          ),
        bytes.toString('base64'),
      ),
    ).toBe(false)
    expect(
      await page.evaluate(() =>
        (window as unknown as { slidesApi: SlidesApi }).slidesApi.clipboardExternal(),
      ),
    ).toEqual({ kind: 'text', text: 'external text' })
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      })
      .catch(() => {})
    const child = app.process()
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    try {
      await app.close()
    } finally {
      clearTimeout(timer)
      await rm(dir, { recursive: true, force: true })
    }
  }
})
