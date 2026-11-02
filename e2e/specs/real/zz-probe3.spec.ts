import { test, expect } from '../../fixtures/app'
import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Decisive probe: does the sheet tab show the workbook's own sheet name? */

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

async function writeNamedSheet(dir: string, name: string, sheetName: string, a1: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  zip.file('_rels/.rels', RELS)
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>${a1}</t></is></c></row>
</sheetData></worksheet>`,
  )
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

test('probe: sheet tab name comes from workbook.xml', async ({ app }) => {
  const path = await writeNamedSheet(app.workDir, 'ledger.xlsx', 'Ledger', 'MARKER-CELL')
  await app.openFile(path, { kind: 'sheets' })
  const editor = await app.editor()
  await expect(editor.ui.locator('.ribbon').first()).toBeVisible({ timeout: 45_000 })
  await app.page.waitForTimeout(1500)

  const body = await editor.ui.locator('body').innerText().catch(() => '')
  const flat = body.replace(/\s+/g, ' ')
  console.log(
    'PROBE3 =',
    JSON.stringify({
      showsLedger: flat.includes('Ledger'),
      showsSheet1: flat.includes('Sheet1'),
      sheetTabText: await editor.ui
        .locator('[data-u-comp="sheet-bar"], .univer-sheet-bar, [class*="sheet-bar"]')
        .first()
        .innerText()
        .catch(() => 'n/a'),
    }),
  )
})
