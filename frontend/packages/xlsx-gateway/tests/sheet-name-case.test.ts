import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { createBufferEntrySource, planCellEditsToXlsx } from '../src/gateway/xlsx-gateway'
import { SheetEditError, type SheetEditPlan } from '../src/gateway/xlsx-sheets'

const CONTENT_TYPES_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const CONTENT_TYPES_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Extra" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`

const WORKBOOK_RELS_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

const WORKBOOK_RELS_TWO = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`

const WORKSHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:A3"/>
  <sheetData>
    <row r="1"><c r="A1"><v>3</v></c></row>
    <row r="2"><c r="A2"><v>1</v></c></row>
    <row r="3"><c r="A3"><v>2</v></c></row>
  </sheetData>
</worksheet>`

async function fixture(oneSheet: boolean): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', oneSheet ? CONTENT_TYPES_ONE : CONTENT_TYPES_TWO)
  zip.file('_rels/.rels', PACKAGE_RELS)
  zip.file('xl/workbook.xml', oneSheet ? WORKBOOK_ONE : WORKBOOK_TWO)
  zip.file('xl/_rels/workbook.xml.rels', oneSheet ? WORKBOOK_RELS_ONE : WORKBOOK_RELS_TWO)
  zip.file('xl/worksheets/sheet1.xml', WORKSHEET)
  if (!oneSheet) zip.file('xl/worksheets/sheet2.xml', WORKSHEET)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/// A trivial cell write so the planner runs its full pipeline; the assertions
/// below are all about the sheet plan, not the edit.
const TOUCH = [
  { sheetName: 'Data', row: 0, column: 0, writeValue: true, cell: { value: 1 } },
] as const

async function planWith(oneSheet: boolean, sheetPlan: SheetEditPlan) {
  const source = await createBufferEntrySource(await fixture(oneSheet))
  return planCellEditsToXlsx(source, [...TOUCH], [], [], sheetPlan)
}

describe('sheet name uniqueness is case-insensitive', () => {
  it('rejects renaming a sheet onto a case-variant of another sheet', async () => {
    await expect(
      planWith(false, {
        renames: [{ sheetName: 'Extra', newName: 'data' }],
        additions: [],
        removals: [],
        order: ['Data', 'data'],
      }),
    ).rejects.toThrow(SheetEditError)
    await expect(
      planWith(false, {
        renames: [{ sheetName: 'Extra', newName: 'data' }],
        additions: [],
        removals: [],
        order: ['Data', 'data'],
      }),
    ).rejects.toThrow(/same name/)
  })

  it('rejects an addition whose name case-collides with an existing sheet', async () => {
    await expect(
      planWith(true, {
        renames: [],
        additions: [{ name: 'data' }],
        removals: [],
        order: ['Data', 'data'],
      }),
    ).rejects.toThrow(/same name/)
  })

  it('rejects an exact duplicate name as well', async () => {
    await expect(
      planWith(false, {
        renames: [{ sheetName: 'Extra', newName: 'Data' }],
        additions: [],
        removals: [],
        order: ['Data', 'Data'],
      }),
    ).rejects.toThrow(/same name/)
  })

  it('still allows renaming a sheet to a case-variant of itself', async () => {
    const plan = await planWith(true, {
      renames: [{ sheetName: 'Data', newName: 'data' }],
      additions: [],
      removals: [],
      order: ['data'],
    })
    const workbook = plan.replaced.get('xl/workbook.xml')
    expect(workbook).toBeDefined()
    expect(workbook).toContain('name="data"')
    expect(workbook).not.toContain('name="Data"')
  })

  it('still allows a case-changing rename that collides with nothing', async () => {
    const plan = await planWith(false, {
      renames: [{ sheetName: 'Extra', newName: 'EXTRA' }],
      additions: [],
      removals: [],
      order: ['Data', 'EXTRA'],
    })
    const workbook = plan.replaced.get('xl/workbook.xml')
    expect(workbook).toContain('name="EXTRA"')
    expect(workbook).toContain('name="Data"')
  })
})
