// ADAPTED FROM Electron e2e — slides-font-manager.spec.ts
import { test, expect } from './fixture'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
 * The fixture deck (one slide whose only run uses the catalog font Rubik) is
 * kept as plain-text OOXML parts under assets/font-manager-rubik/ so no binary
 * lives in the repo; zip them into a real .pptx at test time.
 */
async function buildRubikFixture(): Promise<string> {
  const out = join(
    await mkdtemp(join(tmpdir(), 'yiioffice-font-manager-')),
    'font-manager-rubik.pptx',
  )
  await zipDirectory(resolve(__dirname, 'assets/font-manager-rubik'), out)
  return out
}

/**
 * Font manager smoke: source builds without an injected font CDN hide download
 * prompts. Providing YIIOFFICE_FONT_CDN_URL enables the catalog/banner; the
 * actual network download runs only with E2E_FONT_CDN=1.
 */
test('font download UI follows CDN configuration', async ({ page, context }) => {
  test.setTimeout(180_000)
  const filePath = await buildRubikFixture()
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'slides-font-manager',
    openFile: filePath,
  })
  await setupPageAfterLaunch(launched, page, context)
  try {
    // Open the file in the real Wails backend (no auto-open in wails3 dev mode)
    await page.evaluate((p) => (window as any).aiOffice?.openPath(p), filePath)
    await waitForRoute(page, '/slides')
    await page.waitForSelector('.stage-wrap canvas', { timeout: 30_000 })

    const banner = page.locator('.font-missing-banner')
    const fontState = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          slidesApi: {
            fontCatalog(): Promise<Array<{ family: string; installed: boolean }>>
            fontMissing(): Promise<string[]>
          }
        }
      ).slidesApi
      return {
        catalog: await api.fontCatalog(),
        missing: await api.fontMissing(),
      }
    })
    // In browser mode, process.env is mocked via window.__E2E_ENV or window.process.env
    const configured = Boolean((window as any).__E2E_ENV?.YIIOFFICE_FONT_CDN_URL?.trim() ?? (window as any).process?.env?.YIIOFFICE_FONT_CDN_URL?.trim())
    if (!configured) {
      expect(fontState.catalog).toEqual([])
      expect(fontState.missing).toEqual([])
      await expect(banner).toHaveCount(0)
      return
    }

    expect(fontState.catalog.some((c: any) => c.family === 'Rubik' && !c.installed)).toBe(true)
    expect(fontState.missing).toContain('Rubik')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText('Rubik')

    if (process.env.E2E_FONT_CDN === '1') {
      await banner.locator('.fmb-download').click()
      await expect(banner).toBeHidden({ timeout: 60_000 })
      const installed = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            slidesApi: {
              fontCatalog(): Promise<Array<{ family: string; installed: boolean }>>
            }
          }
        ).slidesApi
        const cat = await api.fontCatalog()
        return cat.find((c: any) => c.family === 'Rubik')?.installed
      })
      expect(installed).toBe(true)
    }
  } finally {
    await closeAndSaveVideo(launched, 'slides-font-manager')
  }
})
