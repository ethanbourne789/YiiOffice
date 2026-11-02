import { test, expect } from '../../fixtures/app'
import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Second probe round: csv, multi-sheet xlsx, numbers/formulas. */

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

async function writeTwoSheets(dir: string, name: string): Promise<string> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  zip.file('_rels/.rels', RELS)
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Alpha" sheetId="1" r:id="rId1"/><sheet name="Beta" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`,
  )
  // A1 text, A2 number, B2 formula adding them.
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>ALPHA-A1</t></is></c></row>
<row r="2"><c r="A2"><v>41</v></c><c r="B2"><f>SUM(A2,1)</f><v>42</v></c></row>
</sheetData></worksheet>`,
  )
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>BETA-A1</t></is></c></row>
</sheetData></worksheet>`,
  )
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

test('probe: csv import', async ({ app }) => {
  const path = join(app.workDir, 'table.csv')
  await writeFile(path, 'name,qty\napple,3\n', 'utf8')

  await app.openFile(path, { kind: 'sheets' })
  const editor = await app.editor()
  // Wait for the renderer to settle instead of sampling immediately.
  await expect(editor.ui.locator('.ribbon').first()).toBeVisible({ timeout: 45_000 })
  await app.page.waitForTimeout(1500)

  const canvas = await editor.ui.locator('canvas').count()
  const body = await editor.ui.locator('body').innerText().catch(() => '')
  const nameBox = await editor.ui.locator('[data-u-comp="defined-name"] input').inputValue().catch(() => 'n/a')
  console.log('PROBE2 csv =', JSON.stringify({ canvas, nameBox, bodyHead: body.replace(/\s+/g, ' ').slice(0, 200) }))
})

test('probe: two-sheet xlsx with number and formula', async ({ app }) => {
  const path = await writeTwoSheets(app.workDir, 'two.xlsx')
  await app.openFile(path, { kind: 'sheets' })
  const editor = await app.editor()
  await expect(editor.ui.locator('.ribbon').first()).toBeVisible({ timeout: 45_000 })
  await app.page.waitForTimeout(1500)

  const body = await editor.ui.locator('body').innerText().catch(() => '')
  const flat = body.replace(/\s+/g, ' ')
  const canvas = await editor.ui.locator('canvas').count()
  console.log(
    'PROBE2 two-sheet =',
    JSON.stringify({
      canvas,
      hasAlpha: flat.includes('Alpha'),
      hasBeta: flat.includes('Beta'),
      hasSheet1: flat.includes('Sheet1'),
      bodyHead: flat.slice(0, 200),
    }),
  )
})
