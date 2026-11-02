import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Fixture documents, generated rather than committed.
 *
 * The Electron suite kept a corpus of binary samples in the repo; these are
 * built from the smallest valid OOXML/PDF skeleton the app actually parses, so
 * a fixture is readable in the diff and its initial content is explicit. The
 * skeletons are asserted by the specs that use them (a generated .docx renders
 * its paragraph in the editor), so a skeleton that drifts out of spec fails
 * loudly instead of silently producing a blank document.
 */

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const docxBody = (paragraphs: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`

/** Write a one-paragraph .docx and return its path. */
export async function writeDocx(dir: string, name: string, text: string): Promise<string> {
  return writeDocxParagraphs(dir, name, [text])
}

/** Write a multi-paragraph .docx (one run per paragraph). */
export async function writeDocxParagraphs(
  dir: string,
  name: string,
  paragraphs: string[],
): Promise<string> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', DOCX_CONTENT_TYPES)
  zip.file('_rels/.rels', DOCX_RELS)
  zip.file('word/document.xml', docxBody(paragraphs))
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

/** Read back a .docx body part (used to prove a save reached the disk). */
export async function readDocxText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const zip = await JSZip.loadAsync(await readFile(path))
  const part = zip.file('word/document.xml')
  if (!part) throw new Error(`${path} has no word/document.xml — not a valid .docx`)
  return part.async('string')
}

const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const XLSX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const xlsxSheet = (a1: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${a1}</t></is></c></row></sheetData></worksheet>`

/** Write a one-cell .xlsx (A1 = a1) and return its path. */
export async function writeXlsx(dir: string, name: string, a1: string): Promise<string> {
  return writeXlsxSheets(dir, name, [{ name: 'Sheet1', a1 }])
}

/** Write a workbook with one A1 cell per sheet (sheet order is preserved). */
export async function writeXlsxSheets(
  dir: string,
  name: string,
  sheets: { name: string; a1: string }[],
): Promise<string> {
  const zip = new JSZip()
  // One Override per worksheet: a package that only declares sheet1 is often
  // read as a single-sheet workbook even though workbook.xml lists more.
  zip.file(
    '[Content_Types].xml',
    XLSX_CONTENT_TYPES.replace(
      '</Types>',
      `${sheets
        .map(
          (_sheet, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
  )
  zip.file('_rels/.rels', XLSX_RELS)
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
      .map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_sheet, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('')}
</Relationships>`,
  )
  sheets.forEach((sheet, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, xlsxSheet(sheet.a1))
  })
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

/** Read every XML part of a workbook; used to prove an edit was written back. */
export async function readXlsxXml(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const zip = await JSZip.loadAsync(await readFile(path))
  const parts: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      parts.push(await zip.file(name)!.async('string'))
    }
  }
  return parts.join('\n')
}

/** Write a PDF with `pages` blank pages and a correct xref table. */
export async function writePdf(dir: string, name: string, pages = 1): Promise<string> {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}]/Count ${pages}>>`,
    ...Array.from(
      { length: pages },
      () => '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>',
    ),
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`
  const path = join(dir, name)
  await writeFile(path, Buffer.from(body, 'latin1'))
  return path
}

/** Write a UTF-8 text file (markdown / csv / tsv). */
export async function writeText(
  dir: string,
  name: string,
  text: string,
  withBom = false,
): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, (withBom ? '\ufeff' : '') + text, 'utf8')
  return path
}
