import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  findInkRuns,
  parseDocx,
  parseSourcesXml,
  saveDocx,
} from '../src/index'
import { buildDocx } from './helpers/build-docx'

/**
 * fast-xml-parser resolves the five named XML entities on its own, so text read off
 * the parse tree only needs numeric character references resolved on top of it.
 * Decoding the named entities a second time rewrites a document's own literal
 * "&lt;" / "&amp;" text into "<" / "&", and regenerating the paragraph then persists
 * that damage to word/document.xml.
 */
describe('entity decoding in run text', () => {
  // XML 1.0 stores literal entity text with the ampersand escaped; Word displays
  // this run as: Escape &amp; as &lt;b&gt; ok
  const STORED = 'Escape &amp;amp; as &amp;lt;b&amp;gt; ok'
  const DISPLAYED = 'Escape &amp; as &lt;b&gt; ok'

  it('keeps text that is literally an entity reference', async () => {
    const bytes = await buildDocx({
      bodyXml: `<w:p><w:r><w:t xml:space="preserve">${STORED}</w:t></w:r></w:p>`,
    })
    const doc = await parseDocx(bytes)
    expect(doc.blocks[0].runs!.map((r) => r.text).join('')).toBe(DISPLAYED)
  })

  it('still resolves a real numeric character reference beside literal entity text', async () => {
    const bytes = await buildDocx({
      bodyXml: '<w:p><w:r><w:t xml:space="preserve">&amp;lt; then &#x2713;</w:t></w:r></w:p>',
    })
    const doc = await parseDocx(bytes)
    expect(doc.blocks[0].runs!.map((r) => r.text).join('')).toBe('&lt; then ✓')
  })

  it('does not rewrite an untouched run when a sibling run is edited', async () => {
    const bytes = await buildDocx({
      bodyXml:
        `<w:p><w:r><w:t xml:space="preserve">${STORED} </w:t></w:r>` +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>tail</w:t></w:r></w:p>',
    })
    const doc = await parseDocx(bytes)
    const runs = doc.blocks[0].runs!.map((r) => (r.bold ? { ...r, text: 'edited' } : r))
    const saved = await saveDocx(doc, [{ kind: 'generated', block: { type: 'paragraph', runs } }])
    const zip = await JSZip.loadAsync(saved)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain(`${STORED} `)
    expect(xml).toContain('edited')
  })
})

/**
 * Every XML slice read outside the parse tree (bibliography fields, ink payloads,
 * raw attribute values) has to decode through the same function. Three sites used
 * to carry private copies that had drifted: two resolved only the five named
 * entities, so a numeric reference such as an em dash or a CJK ideograph survived
 * verbatim, and the third dropped the surrogate guard.
 */
describe('entity decoding outside the parse tree', () => {
  it('resolves numeric references and named entities in one pass', () => {
    expect(decodeEntities('a&#x2014;b&#8212;c&#x4E2D;d')).toBe('a—b—c中d')
    expect(decodeEntities('&lt;tag&gt; &amp; &quot;q&quot; &apos;s&apos;')).toBe(
      `<tag> & "q" 's'`,
    )
  })

  it('leaves a lone surrogate reference alone instead of emitting invalid UTF-16', () => {
    expect(decodeEntities('&#xD800; and &#x2713;')).toBe('&#xD800; and ✓')
  })

  it('does not decode named entities twice', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
  })

  it('decodes numeric references in bibliography source fields', () => {
    const xml =
      '<b:Sources><b:Source><b:Tag>ref1</b:Tag><b:SourceType>JournalArticle</b:SourceType>' +
      '<b:Title>Dash&#x2014;Title</b:Title><b:Year>2024</b:Year>' +
      '<b:Author><b:Author><b:NameList><b:Person>' +
      '<b:Last>&#x5F20;</b:Last><b:First>San</b:First>' +
      '</b:Person></b:NameList></b:Author></b:Author></b:Source></b:Sources>'
    const [source] = parseSourcesXml(xml)
    expect(source.title).toBe('Dash—Title')
    expect(source.author).toBe('张, San')
  })

  it('decodes numeric references in an ink payload attribute', () => {
    const paragraph =
      '<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="9525" cy="9525"/>' +
      '<wp:docPr id="7" name="aidocs-ink 7" descr="stroke&#x2713;&#x2014;end"/>' +
      '</wp:anchor></w:drawing></w:r></w:p>'
    const [ink] = findInkRuns(paragraph)
    expect(ink.payload).toBe('stroke✓—end')
  })
})
