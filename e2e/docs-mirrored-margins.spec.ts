/**
 * ADAPTED FROM Electron e2e — docs-mirrored-margins.spec.ts
 *
 * Layout > Margins > Mirrored (w:mirrorMargins): w:left is the inside margin
 * and w:right the outside one. Odd pages keep them as left/right, even pages
 * swap them — on the canvas, on the ruler (which follows the caret's page),
 * in Custom Margins (Inside/Outside + Multiple pages) and in the exported PDF.
 *
 * NOTE: PDF export via Electron's showSaveDialog IPC is heavily Electron-specific.
 * The export portion is skipped; canvas/ruler/dialog checks remain.
 */
import { test, expect, type Page } from './fixture'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { launchShell, setupPageAfterLaunch, closeAndSaveVideo, waitForRoute } from './helpers'

interface AidocsWindow {
  __aidocs?: { editor?: unknown }
}

const PT_PER_TWIP = 1 / 20
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

async function twoPageDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
  )
  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="${W_NS}"><w:p><w:r><w:t>Running header</w:t></w:r></w:p></w:hdr>`,
  )
  zip.file(
    'word/footer1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>Running footer</w:t></w:r></w:p></w:ftr>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
      '<w:p><w:r><w:t>Alpha on the first page</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Beta on the second page</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

const colShift = (page: Page, text: string) =>
  page
    .locator('.doc-page p', { hasText: text })
    .first()
    .evaluate((el) => parseFloat(el.style.getPropertyValue('--col-dx')) || 0)

/** left edge of a header/footer strip relative to the paper, in unzoomed px */
const stripInset = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const paper = el.closest('.page-wrap')?.querySelector('.doc-page') as HTMLElement | null
      if (!paper) return Number.NaN
      const pr = paper.getBoundingClientRect()
      if (!pr.width) return Number.NaN
      return (el.getBoundingClientRect().left - pr.left) / (pr.width / paper.offsetWidth)
    })

const leftRulerZone = (page: Page) =>
  page
    .locator('.ruler-zone')
    .first()
    .evaluate((el) => parseFloat(el.style.width))

/** Word for Mac model: clicking the active tab collapses the ribbon, so only switch when needed */
async function showTab(page: Page, name: RegExp) {
  const tab = page.locator('.ribbon-tab', { hasText: name })
  if (!/\bopen\b/.test((await tab.getAttribute('class')) ?? '')) await tab.click()
}

test.describe('docs mirrored margins', () => {
  let dir: string
  let docPath: string

  test.beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'yiioffice-e2e-mirror-')))
    docPath = join(dir, 'mirror.docx')
    writeFileSync(docPath, await twoPageDocx())
  })

  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('even pages swap inside/outside on the canvas, ruler, dialog and export', async ({ page, context }) => {
    test.setTimeout(180_000)
    const launched = await launchShell({
      onboardingSeen: true,
      videoDir: 'docs-mirrored-margins',
      openFile: docPath,
    })
    await setupPageAfterLaunch(launched, page, context)
    try {
      await page.evaluate((p) => {
        ;(window as any).aiOffice?.openPath(p)
      }, docPath)

      const editor = await waitForRoute(page, '/docs')
      await editor.locator('.doc-page p').first().waitFor()
      const alpha = editor.locator('.doc-page p', { hasText: 'Alpha' }).first()
      const beta = editor.locator('.doc-page p', { hasText: 'Beta' }).first()
      await expect(beta).toBeVisible()
      await expect(editor.locator('.doc-page .page-gap')).toHaveCount(1)

      await showTab(editor, /^View$/)
      await editor.getByRole('button', { name: 'Ruler', exact: true }).click()
      await expect(editor.locator('.ruler')).toBeVisible()

      // Mirrored preset: inside 1.25in (1800), outside 1in (1440)
      await showTab(editor, /^Layout$/)
      await editor.getByRole('button', { name: 'Margins', exact: true }).click()
      await editor.locator('[data-rb-panel] button', { hasText: 'Mirrored' }).click()
      await expect
        .poll(() =>
          editor
            .locator('.doc-page')
            .first()
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
        )
        .toBe(120)
      // the even page's blocks translate by outside - inside
      await expect.poll(() => colShift(editor, 'Beta')).toBe(-24)
      expect(await colShift(editor, 'Alpha')).toBe(0)
      const zoom = await editor
        .locator('.doc-page')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth)
      const alphaLeft = (await alpha.boundingBox())!.x
      const betaLeft = (await beta.boundingBox())!.x
      expect(betaLeft - alphaLeft).toBeCloseTo(-24 * zoom, 0)

      // header/footer strips sit on their page's own margin: 1.25in on page 1, 1in on page 2
      await expect
        .poll(() => stripInset(editor, '.page-wrap .page-hf-header:not(.page-gap-hf)'))
        .toBeCloseTo(120, 0)
      await expect
        .poll(() => stripInset(editor, '.page-wrap .page-gap-hf[data-hf-kind="footer"]'))
        .toBeCloseTo(120, 0)
      await expect
        .poll(() => stripInset(editor, '.page-wrap .page-gap-hf[data-hf-kind="header"]'))
        .toBeCloseTo(96, 0)
      await expect
        .poll(() => stripInset(editor, '.page-wrap .page-hf-footer:not(.page-gap-hf)'))
        .toBeCloseTo(96, 0)

      // the ruler follows the caret's page: left margin 1.25in on page 1, 1in on page 2
      await alpha.click()
      await expect.poll(() => leftRulerZone(editor)).toBe(120)
      await beta.click()
      await expect.poll(() => leftRulerZone(editor)).toBe(96)
      await alpha.click()
      await expect.poll(() => leftRulerZone(editor)).toBe(120)

      // the gallery marks the preset, Custom Margins reads Inside/Outside and Mirror margins
      await editor.getByRole('button', { name: 'Margins', exact: true }).click()
      await expect(editor.locator('[data-rb-panel] button.active b')).toHaveText('Mirrored')
      await editor.getByRole('button', { name: 'Custom Margins…' }).click()
      const dialog = editor.locator('.modal', { hasText: 'Custom Page Margins' })
      // The dialog may show cm or inches depending on the measurement unit preference.
      // 1.25in = 3.175 cm, 1in = 2.54 cm. Accept either format.
      const insideVal = await dialog.getByRole('textbox', { name: 'Inside', exact: true }).inputValue()
      expect(insideVal).toMatch(/1\.25"|3\.1[78]\s*cm/)
      const outsideVal = await dialog.getByRole('textbox', { name: 'Outside', exact: true }).inputValue()
      expect(outsideVal).toMatch(/1"|2\.54\s*cm/)
      const pdfPages = dialog.getByRole('combobox')
      await expect(pdfPages).toHaveValue('mirror')
      await pdfPages.selectOption('normal')
      const leftVal = await dialog.getByRole('textbox', { name: 'Left', exact: true }).inputValue()
      expect(leftVal).toMatch(/1\.25"|3\.1[78]\s*cm/)
      await pdfPages.selectOption('mirror')
      await dialog.getByRole('button', { name: 'Cancel' }).click()

      // NOTE: PDF export via Electron's showSaveDialog IPC is skipped in browser mode.
      // The export portion used launched.app.evaluate with dialog.showSaveDialog mock
      // which is Electron-specific. Canvas/ruler/dialog checks above remain.

      // Normal from the dialog clears the shift
      await showTab(editor, /^Layout$/)
      await editor.getByRole('button', { name: 'Margins', exact: true }).click()
      await editor.getByRole('button', { name: 'Custom Margins…' }).click()
      await dialog.getByRole('combobox').selectOption('normal')
      await dialog.getByRole('button', { name: 'OK', exact: true }).click()
      await expect.poll(() => colShift(editor, 'Beta')).toBe(0)
      await beta.click()
      await expect.poll(() => leftRulerZone(editor)).toBe(120)
    } finally {
      await closeAndSaveVideo(launched, 'docs-mirrored-margins')
    }
  })
})
