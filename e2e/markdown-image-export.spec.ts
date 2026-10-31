// ADAPTED FROM Electron e2e — markdown-image-export.spec.ts
// Electron Menu/BrowserWindow menu actions replaced with keyboard shortcuts or DOM clicks.
// Dialog mocking rewritten: Electron dialog.showSaveDialog replaced with mockSaveDialog().
import { test, expect } from './fixture'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { PDFDocument } from 'pdf-lib'
import { launchShell, setupPageAfterLaunch, waitForRoute, mockSaveDialog, closeAndSaveVideo } from './helpers'

/**
 * Trigger an export menu action via the frontend.
 * In Electron, this used Menu.getApplicationMenu() + BrowserWindow.
 * In Wails browser mode, we try to trigger via keyboard shortcut or DOM button click.
 */
async function exportMenu(page: import('@playwright/test').Page, label: string): Promise<void> {
  // Try clicking the export button in the UI first
  const exportBtn = page.getByRole('button', { name: label, exact: true })
  if (await exportBtn.isVisible().catch(() => false)) {
    await exportBtn.click()
    return
  }

  // Fall back to calling the Wails bridge API if available
  await page.evaluate(async (label: string) => {
    const bridge = (window as any).markdownApi ?? (window as any).aiOffice
    if (bridge) {
      const key = label.replace('Export as Images…', 'exportImages')
        .replace('Export as PDF…', 'exportPdf')
      if (typeof bridge[key] === 'function') {
        return bridge[key]()
      }
    }
    // Last resort: dispatch a custom event that the app may listen for
    window.dispatchEvent(new CustomEvent('app:export', { detail: { label } }))
  }, label)
}

test('Markdown File menu exports paginated PNG files with formula and local image', async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-image-export-'))
  const source = join(dir, 'report.md')
  const image = new PNG({ width: 80, height: 50 })
  for (let p = 0; p < image.data.length; p += 4) {
    image.data[p] = 230
    image.data[p + 1] = 20
    image.data[p + 2] = 20
    image.data[p + 3] = 255
  }
  await writeFile(join(dir, 'red.png'), PNG.sync.write(image))
  await writeFile(
    source,
    '# Export test\n\n$E=mc^2$\n\n![red](red.png)\n\n' +
      Array.from(
        { length: 65 },
        (_, i) => `Paragraph ${i + 1}: pagination must preserve every line.`,
      ).join('\n\n'),
  )
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'markdown-image-export',
    openFile: source,
  })
  await setupPageAfterLaunch(launched, page, context)
  try {
    // Open the file in the real Wails backend (no auto-open in wails3 dev mode)
    await page.evaluate((p) => (window as any).aiOffice?.openPath(p), source)
    await waitForRoute(page, '/markdown')
    await expect(page.locator('.doc-editor h1')).toHaveText('Export test')
    await expect(page.locator('.doc-editor .katex')).toHaveCount(1)
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll<HTMLImageElement>(
          '.doc-editor img[src]:not(.ProseMirror-separator)',
        ),
      ].every((img) => img.complete && img.naturalWidth > 0),
    )

    // Mock save dialog for export — replaced Electron dialog.showSaveDialog
    // Electron version: app.evaluate(({ dialog, shell }, dir) => { dialog.showSaveDialog = ... })
    await mockSaveDialog(page, `${dir}/reference.pdf`)

    // Export as Images
    await exportMenu(page, 'Export as Images…')
    await expect(page.locator('.status-export')).toContainText(
      /Exported \d+ images|Image export failed/,
      { timeout: 45_000 },
    )
    await expect(page.locator('.status-export')).toContainText(/Exported \d+ images/)
    const folders = (await readdir(dir)).filter((name) => name.startsWith('report-images-'))
    expect(folders).toHaveLength(1)
    const output = join(dir, folders[0])
    const files = (await readdir(output)).sort()
    expect(files.length).toBeGreaterThan(1)
    for (const file of files) {
      const png = PNG.sync.read(await readFile(join(output, file)))
      expect(png.width).toBeGreaterThan(1500)
      expect(png.height).toBeGreaterThan(2200)
      // Every page has painted content, not just the correct PNG header.
      let ink = 0
      for (let i = 0; i < png.data.length; i += 4) if (png.data[i] < 200) ink++
      expect(ink).toBeGreaterThan(100)
    }
    const firstBytes = await readFile(join(output, files[0]))
    await test.info().attach('exported-page-01', { body: firstBytes, contentType: 'image/png' })
    const first = PNG.sync.read(firstBytes)
    let red = 0
    for (let i = 0; i < first.data.length; i += 4)
      if (first.data[i] > 180 && first.data[i + 1] < 70 && first.data[i + 2] < 70) red++
    expect(red).toBeGreaterThan(500)

    // Both outputs must use the same print pagination.
    // Export as PDF
    await mockSaveDialog(page, join(dir, 'reference.pdf'))
    await exportMenu(page, 'Export as PDF…')
    await expect.poll(async () => (await readdir(dir)).includes('reference.pdf')).toBe(true)
    const pdfBytes = await readFile(join(dir, 'reference.pdf'))
    expect(pdfBytes.toString('latin1')).toContain('KaTeX')
    const pdf = await PDFDocument.load(pdfBytes)
    expect(files.length).toBe(pdf.getPageCount())

    // Cancel case: dialog returns canceled, no export happens
    // In browser mode, mock a canceled picker
    await page.evaluate(() => {
      // @ts-expect-error -- overriding for test
      window.showSaveFilePicker = async () => {
        throw new DOMException('Cancelled by user', 'AbortError')
      }
    })
    // PDF export may open another tab; select the Markdown editor again.
    await waitForRoute(page, '/markdown')
    await exportMenu(page, 'Export as Images…')
    await expect(page.locator('.status-export')).toHaveCount(0)
    expect((await readdir(dir)).filter((name) => name.startsWith('report-images-'))).toEqual(
      folders,
    )
  } finally {
    await closeAndSaveVideo(launched, 'markdown-image-export')
    await rm(dir, { recursive: true, force: true })
  }
})
