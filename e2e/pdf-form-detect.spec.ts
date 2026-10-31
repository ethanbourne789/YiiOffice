// ADAPTED FROM Electron e2e — pdf-form-detect.spec.ts
import { test, expect } from './fixture'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { launchShell, setupPageAfterLaunch, waitForRoute, closeAndSaveVideo } from './helpers'

test('Form Design auto-detects blanks, boxes and label gaps as fields', async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), 'yiioffice-pdf-formdetect-'))
  const pdfPath = join(dir, 'form.pdf')
  const doc = await PDFDocument.create()
  const pdfPage = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const text = (s: string, x: number, y: number) => pdfPage.drawText(s, { x, y, size: 11, font })
  text('Full name: ______________________', 72, 700)
  text('Date:', 72, 660)
  text('Signature:', 72, 560)
  pdfPage.drawLine({ start: { x: 135, y: 556 }, end: { x: 330, y: 556 }, thickness: 0.8 })
  text('Country', 300, 625)
  pdfPage.drawRectangle({
    x: 300,
    y: 595,
    width: 200,
    height: 22,
    borderWidth: 1,
    borderColor: rgb(0, 0, 0),
  })
  text('[ ] I agree to the terms', 72, 500)
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'pdf-form-detect',
    openFile: pdfPath,
  })
  await setupPageAfterLaunch(launched, page, context)
  try {
    // Open the file in the real Wails backend (no auto-open in wails3 dev mode)
    await page.evaluate((p) => (window as any).aiOffice?.openPath(p), pdfPath)
    await waitForRoute(page, '/pdf')
    const editorPage = page.locator('.pdf-page').first()
    await expect(editorPage).toBeVisible()
    await page.getByRole('button', { name: 'Form Design', exact: true }).click()
    await page.getByRole('button', { name: 'Auto detect', exact: true }).click()

    const layer = editorPage.locator('.pdf-formdesign-layer')
    await expect(layer.locator('.pdf-formdesign-field')).toHaveCount(5)
    await expect(layer.getByTitle('full_name')).toBeVisible()
    await expect(layer.getByTitle('date')).toBeVisible()
    await expect(layer.getByTitle('signature')).toHaveClass(/is-signature/)
    await expect(layer.getByTitle('country')).toBeVisible()
    await expect(layer.getByTitle('i_agree_to_the')).toHaveClass(/is-checkbox/)
    // Everything detected is selected for review
    await expect(layer.locator('.pdf-formdesign-field.is-selected')).toHaveCount(5)
    await page.screenshot({ path: join(dir, 'form-detect.png') })

    await page.keyboard.press('ControlOrMeta+s')
    await expect(editorPage.locator('.pdf-form-layer .pdf-form-checkbox')).toHaveCount(1)
    await expect(layer.locator('.pdf-formdesign-field.is-existing')).toHaveCount(5)
    const saved = await PDFDocument.load(await readFile(pdfPath))
    expect(
      saved
        .getForm()
        .getFields()
        .map((f) => f.getName())
        .sort(),
    ).toEqual(['country', 'date', 'full_name', 'i_agree_to_the', 'signature'])
    console.log(`screenshot: ${join(dir, 'form-detect.png')}`)
  } finally {
    await closeAndSaveVideo(launched, 'pdf-form-detect')
  }
})
