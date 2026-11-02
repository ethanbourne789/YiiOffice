import { test } from '../../fixtures/app'
import JSZip from 'jszip'
import { writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Throw-away probe: records what the app actually does on paths the suite does
 * not assert (legacy binary formats, csv, styled docx, a real pptx deck).
 * Prints JSON to stdout; deleted after the reading.
 */

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const STYLED_BODY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading One</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BOLD-RUN</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ITALIC-RUN</w:t></w:r></w:p>
<w:tbl>
<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>CELL-A1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>CELL-B1</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>CELL-A2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>CELL-B2</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t>after table</w:t></w:r></w:p>
</w:body></w:document>`

async function writeStyledDocx(dir: string, name: string): Promise<string> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  zip.file('_rels/.rels', RELS)
  zip.file('word/document.xml', STYLED_BODY)
  const path = join(dir, name)
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

test('probe: legacy .doc (OLE container)', async ({ app }) => {
  const path = join(app.workDir, 'legacy.doc')
  const ole = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504, 0),
  ])
  await writeFile(path, ole)

  const tabsBefore = (await app.tabs()).filter((t) => t.kind !== 'home').length
  let kind = 'none'
  try {
    const tab = await app.openFile(path)
    kind = tab?.kind ?? 'unknown'
  } catch (error) {
    kind = `open-failed: ${(error as Error).message.split('\n')[0]}`
  }
  const tabsAfter = (await app.tabs()).filter((t) => t.kind !== 'home')
  const editor = tabsAfter.length > tabsBefore ? await app.editor(tabsAfter[tabsAfter.length - 1]) : null
  const body = editor ? await editor.ui.locator('body').innerText({ timeout: 10_000 }).catch(() => '') : ''
  const pages = editor ? await editor.ui.locator('.doc-page').count() : -1
  console.log('PROBE .doc =', JSON.stringify({ kind, pages, bodyLen: body.length, bodyHead: body.slice(0, 160) }))
})

test('probe: .csv routed to sheets', async ({ app }) => {
  const path = join(app.workDir, 'table.csv')
  await writeFile(path, 'name,qty\napple,3\n', 'utf8')

  const tab = await app.openFile(path).catch((e: Error) => ({ kind: `failed: ${e.message.split('\n')[0]}` }))
  const tabs = (await app.tabs()).filter((t) => t.kind !== 'home')
  const editor = tabs.length ? await app.editor(tabs[tabs.length - 1]) : null
  const canvas = editor ? await editor.ui.locator('canvas').count() : -1
  const body = editor ? await editor.ui.locator('body').innerText({ timeout: 15_000 }).catch(() => '') : ''
  console.log('PROBE .csv =', JSON.stringify({ kind: tab.kind, canvas, bodyHead: body.slice(0, 200) }))
})

test('probe: styled docx (heading + bold + table)', async ({ app }) => {
  const path = await writeStyledDocx(app.workDir, 'styled.docx')
  await app.openFile(path, { kind: 'docs' })
  const editor = await app.editor()

  const page = editor.ui.locator('.doc-page').first()
  await page.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
  const text = await page.innerText().catch(() => '')
  const tables = await editor.ui.locator('.doc-page table').count()
  const cells = await editor.ui.locator('.doc-page td').count()
  const bold = await editor.ui.locator('.doc-page strong, .doc-page b').count()
  const italic = await editor.ui.locator('.doc-page em, .doc-page i').count()
  const h1 = await editor.ui.locator('.doc-page h1, .doc-page .doc-h1').count()
  const boldWeight = await editor.ui
    .locator('.doc-page')
    .evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('BOLD-RUN')) {
          const parent = walker.currentNode.parentElement
          return parent ? getComputedStyle(parent).fontWeight : 'no-parent'
        }
      }
      return 'not-found'
    })
    .catch((e: Error) => `evaluate-failed: ${e.message.split('\n')[0]}`)

  console.log(
    'PROBE styled.docx =',
    JSON.stringify({ tables, cells, boldTags: bold, italicTags: italic, h1, boldWeight, textHead: text.slice(0, 120) }),
  )
})

test('probe: real pptx deck', async ({ app }) => {
  const source = resolve(__dirname, '../../../frontend/packages/pptx-engine/tests/fixtures/01_standard_business.pptx')
  const path = join(app.workDir, 'deck.pptx')
  await copyFile(source, path)

  const tab = await app.openFile(path, { kind: 'slides' }).catch((e: Error) => ({ kind: `failed: ${e.message.split('\n')[0]}` }))
  const editor = await app.editor(await app.tabs().then((t) => t.filter((x) => x.kind === 'slides').at(-1)))
  await app.page.waitForTimeout(2500)
  const body = await editor.ui.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  const canvas = await editor.ui.locator('canvas').count()
  const slides = await editor.ui.locator('.slide-list, .sorter-view').count()
  console.log('PROBE deck.pptx =', JSON.stringify({ kind: tab.kind, canvas, slides, bodyLen: body.length, bodyHead: body.slice(0, 120) }))
})
