import JSZip from 'jszip'
import { parseChartPartXml } from './chart'
import { findInkRuns, stripInkRuns } from './ink'
import { isMetafileMime, metafileToDataUrl } from './metafile'
import { ommlFragmentsOf, ommlToLatex, ommlToMathML } from './math'
import { splitXmlChildren } from './generate'
import { NOTE_PART_PATH, parseNotesXml } from './notes'
import { scanBody, type BodyElement } from './scan'
import { notePropsFromXml, sectionSettingsFromXml, xmlFlagOn } from './section'
import { findSourcesPart, parseSourcesXml } from './sources'
import { FONT_TABLE_PART_PATH, parseFontTable, readEmbeddedFonts } from './font-table'
import { DEFAULT_THEME_COLORS, THEME_PART_PATH, readThemeColors, readThemeFonts } from './theme'
import { assertZipWithinLimits, loadDocxZip } from './zip-load'
import { altChunkToDocx, hasAltChunkHtmlConverter } from './alt-chunk'
import type {
  Block,
  ChartDisplay,
  DiagramDisplay,
  DiagramShape,
  InkInfo,
  NoteInfo,
  NoteProps,
  NumberingDef,
  ParsedDoc,
  Run,
  SectionSettings,
  SourceInfo,
  StyleInfo,
  TableModel,
  TextboxDisplay,
  ThemeColors,
  ThemeFonts,
} from './types'
import {
  attrsOf,
  childrenOf,
  findChild,
  findChildren,
  nameOf,
  serializeXNode,
  textOf,
  xmlParser,
  type XNode,
} from './xml-utils'
import {
  applyBalancedDbcsSpacing,
  applyProtectedLeadingBreaks,
  bandWrappedBoxesBeforeTables,
  blockRunGroups,
  floatTableColumnSpan,
  normalizeImageZOrders,
} from './parse-block-passes'
import {
  directParaGeometry,
  applyTocEntryNumbers,
  fieldDisplayOf,
  fieldLabel,
  tagAttr,
  tocLevelOf,
} from './parse-fields'
import {
  EMU_PER_PX,
  decodeEntities,
  decodeNumericCharRefs,
  mathTokens,
  plainText,
  type RelInfo,
} from './parse-xml-text'
import {
  colorNodeHex,
  drawingAnchorMeta,
  gradFillApproxHex,
  topLevelDrawings,
} from './parse-drawing-geometry'
import {
  collectNodes,
  hostPageBreak,
  isInvisibleEmptyShape,
  isInvisibleVmlPict,
  isThinRule,
  onlyOleFields,
  onlyXeFields,
  partXmlSpacePreserve,
  ruleDisplayOf,
  stripTextboxes,
} from './parse-props'
import {
  parseComments,
  parseNumbering,
  parseProtection,
  parseRels,
  parseRemovePersonalInfo,
  parseWriteProtection,
  resolveMainDocumentPath,
  resolveRelationshipTargetPath,
} from './parse-package'
import { parseSdtBlock, sdtMeta, sdtTableXml, splitSdtParts } from './parse-sdt'
import { mathParaAlign, mathSizeHalfPoints, parseStyles } from './parse-styles'
import { VML_PICT_RID_RE, VML_WORDART_RE, vmlShapeTypeTable } from './parse-vml'
import type { BuildContext } from './parse-shared'
import {
  contentTypesOf,
  imagePartMime,
  inlineMediaDataUrl,
  mediaDataUrl,
  mediaPartDataUrl,
  relPartPath,
} from './parse-rels'

import { emuToPx } from './parse-shared'
import { imageMeta, rectFrac, vmlImageMeta } from './parse-images'

import {
  anchorLineOf,
  buildTextParagraph,
  fieldResultRuns,
  foldFieldCodeParagraphs,
  pictureBesideFloatTable,
  pictureOverhangsColumn,
  strayAnchorLine,
} from './parse-paragraph'

import {
  hfPartInfo,
  noteNumbersOf,
  parseAllHfParts,
  readHeaderFooterPart,
} from './parse-hf'

import {
  extractTextboxes,
  hasFloatingVmlGeometry,
  paragraphStrayBox,
  strayParaRuns,
  vmlPictsInlineOnly,
} from './parse-textboxes'

import { extractTable, tableSummary } from './parse-tables'
export { reconcileGridColumns } from './parse-tables'

export { resolveMainDocumentPath } from './parse-package'
export { styleRunFormat } from './parse-styles'

export { assertZipWithinLimits }

export interface ParseExtras {
  /** ranges of top-level body elements, aligned with docxIndex */
  elements: BodyElement[]
  opaqueRegions: Array<{ start: number; end: number }>
  /** original XML of chart parts referenced by chart blocks (partPath -> xml) */
  chartParts: Record<string, string>
  /** HTML/MHT altChunk parts skipped for want of a converter (a Worker parse):
   *  the host reparses on the UI thread, where one is installed */
  altChunksNeedConverter?: number
}

export interface ParseOptions {
  /** expand w:altChunk parts into display blocks (off inside the chunk's own parse) */
  expandAltChunks?: boolean
}

export async function parseDocx(
  bytes: Uint8Array,
  options: ParseOptions = {},
): Promise<ParsedDoc & { extras: ParseExtras }> {
  const zip = await loadDocxZip(bytes)
  assertZipWithinLimits(zip)
  const docPath = await resolveMainDocumentPath(zip)
  if (!docPath) {
    const mime = (await zip.file('mimetype')?.async('string'))?.trim()
    if (mime?.startsWith('application/vnd.oasis.opendocument'))
      throw new Error(`OpenDocument file (${mime}), not OOXML — save as .docx to open`)
    throw new Error('not a docx: missing word/document.xml')
  }
  const documentXml = await zip.file(docPath)!.async('string')

  const theme = await parseTheme(zip)
  const { styles, docDefaults } = await parseStyles(zip, theme.colors, theme.fonts)
  const headingStyleIds = new Map<number, string>()
  let listParagraphStyleId: string | undefined
  for (const info of styles.values()) {
    if (info.headingLevel && !headingStyleIds.has(info.headingLevel)) {
      headingStyleIds.set(info.headingLevel, info.styleId)
    }
    if (!listParagraphStyleId && /^listparagraph$/i.test(info.styleId)) {
      listParagraphStyleId = info.styleId
    }
  }

  const rels = await parseRels(zip, docPath.replace(/([^/]+)$/, '_rels/$1.rels'))
  const { formats: numFormats, defs: numbering, picBullets } = await parseNumbering(zip)
  await resolvePicBullets(zip, numbering, picBullets)
  const comments = await parseComments(zip)
  const protection = await parseProtection(zip)
  const writeProtection = await parseWriteProtection(zip)
  const removePersonalInfo = await parseRemovePersonalInfo(zip)
  const footnotes = await parseNotesPart(zip, 'footnote')
  const endnotes = await parseNotesPart(zip, 'endnote')
  const sources = await parseSources(zip)
  const fontTableFile = zip.file(FONT_TABLE_PART_PATH)
  const fontTable = fontTableFile ? parseFontTable(await fontTableFile.async('string')) : []
  const embeddedFonts = await readEmbeddedFonts(zip, fontTable)

  const { footnoteProps, endnoteProps } = await parseNoteProps(zip, documentXml)
  const noteNumbers = noteNumbersOf(documentXml, footnotes, endnotes, footnoteProps, endnoteProps)

  const rangedCommentIds = new Set(
    [...documentXml.matchAll(/<w:commentRangeStart\b[^>]*\bw:id\s*=\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    ),
  )
  const referenceOnlyComments = new Set(
    comments.map((c) => c.id).filter((id) => !rangedCommentIds.has(id)),
  )

  const scan = scanBody(documentXml)
  const mediaByRid = await tableBlipMedia(scan.elements, documentXml, zip, rels, docPath)
  const externalTxbxByRid = await externalTxbxParts(documentXml, zip, rels, docPath)
  // sections end at their w:sectPr: the one governing an offset is the first
  // sectPr at or after it (page/margin-anchored drawing placement)
  const sectSlices = [...documentXml.matchAll(/<w:sectPr[^>]*\/>|<w:sectPr[\s\S]*?<\/w:sectPr>/g)]
  const gutterAtTop = await parseSettingsFlag(zip, 'w:gutterAtTop')
  const sectCache = new Map<number, SectionSettings>()
  const sectionAt = (docOffset: number): SectionSettings => {
    let i = sectSlices.findIndex((m) => (m.index ?? 0) + m[0].length > docOffset)
    if (i === -1) i = sectSlices.length - 1
    let settings = sectCache.get(i)
    if (!settings) {
      settings = sectionSettingsFromXml(i >= 0 ? sectSlices[i][0] : '', { gutterAtTop })
      sectCache.set(i, settings)
    }
    return settings
  }
  const elements: BodyElement[] = []
  const blocks: Block[] = []
  const chartParts: Record<string, string> = {}
  const compatibilityMode = await parseCompatibilityMode(zip)
  const buildCtx: BuildContext = {
    zip,
    sourcePath: docPath,
    styles,
    rels,
    numFormats,
    numbering,
    chartParts,
    noteNumbers,
    compatibilityMode,
    themeColors: theme.colors,
    themeFonts: theme.fonts,
    mediaByRid,
    externalTxbxByRid,
    referenceOnlyComments,
    sectionAt,
    docDefaults,
    defaultParaStyle: [...styles.values()].find((s) => s.type === 'paragraph' && s.isDefault),
    xmlSpacePreserve: partXmlSpacePreserve(documentXml, 'w:document'),
    ...(documentXml.includes('<v:shapetype')
      ? { vmlShapeTypes: vmlShapeTypeTable(documentXml) }
      : {}),
    // explicit breaks in any attribute order, plus Word's rendered-page hint
    // (catches natural pages in single-section docs); a false positive only
    // turns page-pinning off, which is the conservative direction
    firstPageBreakAt: (() => {
      const br = documentXml.search(
        /<w:br [^>]*w:type="page"|<w:pageBreakBefore[^>]*\/>|<w:lastRenderedPageBreak[^>]*\/>/,
      )
      const sect = documentXml.indexOf('</w:sectPr>')
      const cands = [br, sect].filter((i) => i !== -1)
      return cands.length > 0 ? Math.min(...cands) : undefined
    })(),
  }
  let sdtGroupSeq = 0
  for (const el of scan.elements) {
    const xml = documentXml.slice(el.start, el.end)
    const sdtParts = el.name === 'w:sdt' ? splitSdtParts(xml) : null
    if (sdtParts) {
      const meta = sdtMeta(xml)
      const group = sdtGroupSeq++
      for (const part of sdtParts) {
        const i = elements.length
        elements.push({ name: part.name, start: el.start + part.start, end: el.start + part.end })
        const childXml = xml.slice(part.childStart, part.childEnd)
        // real document offsets (not 0): sectionAt resolves page geometry by them
        const block = await buildBlock(
          { name: part.name, start: el.start + part.childStart, end: el.start + part.childEnd },
          i,
          childXml,
          buildCtx,
        )
        block.originalXml = xml.slice(part.start, part.end)
        block.sdtShell = {
          ...meta,
          openXml: xml.slice(part.start, part.childStart),
          closeXml: xml.slice(part.childEnd, part.end),
          group,
        }
        if (!block.label) block.label = meta.alias || meta.tag || 'Content control'
        blocks.push(block)
        buildCtx.floatTableAhead = floatTableColumnSpan(block, sectionAt(el.start))
      }
      continue
    }
    if (el.name === 'w:altChunk' && options.expandAltChunks !== false) {
      const expanded = await expandAltChunk(xml, zip, rels, styles, numbering, docPath)
      if (expanded.length > 0) {
        // the chunk element keeps its bytes under the first block; the rest
        // anchor to empty ranges so an untouched save re-emits nothing for them
        expanded.forEach((block, k) => {
          const i = elements.length
          elements.push(k === 0 ? el : { name: el.name, start: el.end, end: el.end })
          blocks.push({ ...block, id: `b${i}`, docxIndex: i })
        })
        continue
      }
    }
    const i = elements.length
    elements.push(el)
    const block = await buildBlock(el, i, xml, buildCtx)
    blocks.push(block)
    buildCtx.floatTableAhead = floatTableColumnSpan(block, sectionAt(el.start))
  }
  foldFieldCodeParagraphs(blocks, buildCtx)
  applyTocEntryNumbers(blocks, numbering)
  bandWrappedBoxesBeforeTables(blocks)
  normalizeImageZOrders(blocks)
  applyProtectedLeadingBreaks(blocks)

  const readHf = (kind: 'header' | 'footer', hfType: 'default' | 'first' | 'even') =>
    readHeaderFooterPart(
      zip,
      documentXml,
      rels,
      kind,
      hfType,
      theme.colors,
      styles,
      compatibilityMode,
      theme.fonts,
      docDefaults,
      docPath,
    )
  const header = await readHf('header', 'default')
  const footer = await readHf('footer', 'default')
  const headerFirst = await readHf('header', 'first')
  const footerFirst = await readHf('footer', 'first')
  const headerEven = await readHf('header', 'even')
  const footerEven = await readHf('footer', 'even')
  const titlePg = xmlFlagOn(documentXml, 'w:titlePg')
  const evenAndOddHeaders = await parseSettingsFlag(zip, 'w:evenAndOddHeaders')
  const mirrorMargins = await parseSettingsFlag(zip, 'w:mirrorMargins')
  const layoutSettings = await parseLayoutSettings(zip)
  const hfParts = await parseAllHfParts(
    zip,
    rels,
    styles,
    theme.colors,
    compatibilityMode,
    theme.fonts,
    docDefaults,
    docPath,
  )
  if (layoutSettings.balanceDbcsSpacing) {
    const hfGroups: Array<Run[] | undefined> = []
    for (const part of [header, footer, headerFirst, footerFirst, headerEven, footerEven]) {
      for (const para of part?.paras ?? []) {
        hfGroups.push(para.runs)
        for (const cell of para.cells ?? []) hfGroups.push(...cell.paras)
      }
    }
    for (const part of Object.values(hfParts ?? {})) {
      for (const para of part.paras) {
        hfGroups.push(para.runs)
        for (const cell of para.cells ?? []) hfGroups.push(...cell.paras)
      }
    }
    applyBalancedDbcsSpacing([...blockRunGroups(blocks), ...hfGroups], docDefaults?.eastAsiaFont)
  }

  // ink annotations (freehand strokes): our own anchored floating pictures, restored
  // into an editable overlay layer instead of being shown as image blocks
  const inks: InkInfo[] = []
  for (const block of blocks) {
    if (block.docxIndex === null || !block.originalXml) continue
    for (const run of findInkRuns(block.originalXml)) {
      inks.push({
        anchorIndex: block.docxIndex,
        offsetXPx: run.offsetXPx,
        offsetYPx: run.offsetYPx,
        widthPx: run.widthPx,
        heightPx: run.heightPx,
        dataUrl: run.embedRId ? await mediaDataUrl(zip, rels, run.embedRId, docPath) : null,
        payload: run.payload,
      })
    }
  }

  return {
    blocks,
    comments,
    protection,
    writeProtection,
    removePersonalInfo,
    footnotes,
    endnotes,
    ...(footnoteProps ? { footnoteProps } : {}),
    ...(endnoteProps ? { endnoteProps } : {}),
    noteNumbers: Object.fromEntries(noteNumbers),
    sources,
    inks,
    themeFonts: theme.fonts,
    themeColors: theme.colors,
    ...(fontTable.length > 0 ? { fontTable } : {}),
    ...(embeddedFonts.length > 0 ? { embeddedFonts } : {}),
    watermarkText: header?.watermark ?? null,
    watermarkPicture: header?.watermarkPicture ?? null,
    headerText: header?.text ?? null,
    headerParas: header?.paras ?? null,
    footerParas: footer?.paras ?? null,
    headerImages: header?.images ?? null,
    footerImages: footer?.images ?? null,
    footerText: footer?.text ?? null,
    footerHasPageNumber: footer?.hasPageNumber ?? false,
    headerHasPageNumber: header?.hasPageNumber ?? false,
    titlePg,
    evenAndOddHeaders,
    ...(mirrorMargins ? { mirrorMargins } : {}),
    ...(gutterAtTop ? { gutterAtTop } : {}),
    compatibilityMode,
    ...layoutSettings,
    headerFirst: hfPartInfo(headerFirst),
    footerFirst: hfPartInfo(footerFirst),
    headerEven: hfPartInfo(headerEven),
    footerEven: hfPartInfo(footerEven),
    hfParts,
    styles,
    docDefaults,
    headingStyleIds,
    listParagraphStyleId,
    numbering,
    internal: {
      originalBytes: bytes,
      documentXml,
      bodyInnerStart: scan.innerStart,
      bodyInnerEnd: scan.innerEnd,
      bodyContentStart: scan.bodyContentStart,
      bodyContentEnd: scan.bodyContentEnd,
    },
    extras: {
      elements,
      opaqueRegions: scan.opaqueRegions,
      chartParts,
      ...(unconvertedChunksByZip.get(zip)
        ? { altChunksNeedConverter: unconvertedChunksByZip.get(zip) }
        : {}),
    },
  }
}

/** Range/marker elements that are invisible in Word when they land at body top level */
const INVISIBLE_BODY_MARKERS = new Set([
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:customXmlInsRangeStart',
  'w:customXmlInsRangeEnd',
  'w:customXmlDelRangeStart',
  'w:customXmlDelRangeEnd',
])

/**
 * Display blocks for a w:altChunk: the chunk becomes a docx (directly, or via
 * the host's HTML converter) and is parsed like a document of its own. Styles
 * and numbering it defines are adopted under ids the host does not use.
 */
async function expandAltChunk(
  xml: string,
  zip: JSZip,
  rels: Map<string, RelInfo>,
  styles: Map<string, StyleInfo>,
  numbering: Map<string, NumberingDef>,
  sourcePath = 'word/document.xml',
): Promise<Block[]> {
  const rId = /\br:id\s*=\s*["']([^"']+)["']/.exec(xml)?.[1]
  if (!rId) return []
  try {
    const bytes = await altChunkToDocx(
      zip,
      rels,
      rId,
      async (path) => {
        const { defaults, overrides } = await contentTypesOf(zip)
        return overrides.get(`/${path}`) ?? defaults.get(path.split('.').pop()?.toLowerCase() ?? '')
      },
      sourcePath,
    )
    if (!bytes) {
      // no converter here (a Worker parse): the host parses again where one is installed
      if (!hasAltChunkHtmlConverter()) {
        unconvertedChunksByZip.set(zip, (unconvertedChunksByZip.get(zip) ?? 0) + 1)
      }
      return []
    }
    const sub = await parseDocx(bytes, { expandAltChunks: false })
    for (const [id, info] of sub.styles) if (!styles.has(id)) styles.set(id, info)
    let nextNumId = 1
    for (const id of numbering.keys()) nextNumId = Math.max(nextNumId, (Number(id) || 0) + 1)
    // abstractNum ids are counter-sharing keys: keep chunk lists apart from host lists
    const abstractPrefix = `altChunk${nextNumId}:`
    const numIdMap = new Map<string, string>()
    const remap = <T extends { numId: string }>(list: T): T => {
      let mapped = numIdMap.get(list.numId)
      if (!mapped) {
        const def = sub.numbering.get(list.numId)
        mapped = String(nextNumId++)
        if (def) {
          numbering.set(mapped, {
            ...def,
            numId: mapped,
            abstractNumId: abstractPrefix + def.abstractNumId,
          })
        }
        numIdMap.set(list.numId, mapped)
      }
      return { ...list, numId: mapped }
    }
    const remapTable = (table: TableModel): void => {
      for (const row of table.rows) {
        for (const cell of row) {
          for (const para of cell.richParas ?? []) if (para.list) para.list = remap(para.list)
          for (const nested of cell.nestedTables ?? []) remapTable(nested)
        }
      }
    }
    const blocks = sub.blocks.filter((b) => !b.hidden)
    for (const block of blocks) {
      block.altChunk = true
      if (block.list) block.list = remap(block.list)
      if (block.table) remapTable(block.table)
    }
    return blocks
  } catch {
    return []
  }
}

async function buildBlock(
  el: BodyElement,
  index: number,
  xml: string,
  ctx: BuildContext,
): Promise<Block> {
  const base = { id: `b${index}`, docxIndex: index, originalXml: xml }

  if (el.name === 'w:ins' || el.name === 'w:del') {
    const openEnd = xml.indexOf('>') + 1
    const closeStart = xml.lastIndexOf(`</${el.name}>`)
    const child = splitXmlChildren(xml.slice(openEnd, closeStart)).find(
      (entry) => entry.name === 'w:p' || entry.name === 'w:tbl',
    )
    if (child) {
      // wrapper offsets keep sectionAt on the right section for the inner block
      const inner = await buildBlock(
        { name: child.name, start: el.start, end: el.end },
        index,
        child.xml,
        ctx,
      )
      let revisionAttrs: Record<string, string> = {}
      try {
        const parsed = xmlParser.parse(xml) as XNode[]
        const revisionNode = parsed.find((node) => nameOf(node) === el.name)
        if (revisionNode) revisionAttrs = attrsOf(revisionNode)
      } catch {
        /* malformed wrapper remains a protected passthrough */
      }
      inner.originalXml = xml
      inner.blockRevision = {
        kind: el.name === 'w:ins' ? 'ins' : 'del',
        author: revisionAttrs['w:author'] ?? '',
        ...(revisionAttrs['w:date'] ? { date: revisionAttrs['w:date'] } : {}),
        ...(revisionAttrs['w:id'] ? { id: revisionAttrs['w:id'] } : {}),
      }
      return inner
    }
  }

  if (el.name === 'w:sectPr') {
    return { ...base, type: 'passthrough', label: 'Section properties', hidden: true }
  }
  if (el.name === 'w:tbl') {
    return {
      ...base,
      type: 'table',
      ...tableSummary(xml),
      table: extractTable(xml, ctx, el.start),
    }
  }

  // --- SDT (structured document tag): extract sdtContent paragraph as editable ---
  if (el.name === 'w:sdt') {
    // sdtContent that starts with a table (research-report templates wrap whole
    // tables in content controls): display as a real table. Untouched
    // it saves byte-identical; cell-text edits patch inside the sdt shell.
    const tblXml = sdtTableXml(xml)
    if (tblXml) {
      return {
        ...base,
        type: 'table',
        ...tableSummary(tblXml),
        table: extractTable(tblXml, ctx, el.start),
      }
    }
    const sdtResult = parseSdtBlock(xml)
    if (sdtResult) {
      const { shell, pXml } = sdtResult
      // Build a synthetic BodyElement for the inner w:p; the sdt's own document
      // offsets keep sectionAt on the right section
      const syntheticEl: BodyElement = { name: 'w:p', start: el.start, end: el.end }
      // Build the block from the inner paragraph XML (keeps the sdt originalXml for passthrough)
      const innerBlock = await buildBlock(syntheticEl, index, pXml, ctx)
      // Attach the sdt shell and preserve the full sdt XML as the original
      innerBlock.originalXml = xml
      innerBlock.sdtShell = shell
      // Label the block with the alias for UI affordance
      if (!innerBlock.label) {
        const aliasLabel = shell.alias || shell.tag || 'Content control'
        innerBlock.label = aliasLabel
      }
      return innerBlock
    }
    // No usable paragraph found → passthrough; keep the text visible at least.
    // A content-less sdt (w:sdtPr only, or empty sdtContent) renders as nothing
    // in Word, so it must not produce a visible placeholder chip.
    const sdtPreview = plainText(xml)
    if (!sdtPreview.trim() && !xml.includes('<w:drawing') && !/<w:pict[\s>]/.test(xml)) {
      return { ...base, type: 'passthrough', label: 'Content control', invisibleMarker: true }
    }
    return { ...base, type: 'passthrough', label: 'Content control', previewText: sdtPreview }
  }
  if (INVISIBLE_BODY_MARKERS.has(el.name)) {
    return { ...base, type: 'passthrough', label: el.name, invisibleMarker: true }
  }
  if (el.name === 'w:br') {
    // Word honors a <w:br> sitting directly in the body: page-type turns the page
    if (/w:type="page"/.test(xml)) {
      return {
        ...base,
        type: 'passthrough',
        label: 'Page break',
        fieldDisplay: { kind: 'pageBreak' },
      }
    }
    return { ...base, type: 'passthrough', label: el.name, invisibleMarker: true }
  }
  if (el.name !== 'w:p') {
    return { ...base, type: 'passthrough', label: el.name, previewText: '' }
  }

  // Feature-detect on XML with mc:Fallback stripped: Word pairs every modern
  // DrawingML shape (mc:Choice) with a legacy VML twin (<mc:Fallback><w:pict>),
  // so matching the raw bytes would misclassify every decorated paragraph as an
  // embedded object. Only detection uses this; saving still passes through the
  // original bytes untouched.
  // aidocs-ink runs are parsed separately into ParsedDoc.inks and re-emitted
  // from the save options; hide them from detection so an annotated text
  // paragraph stays an editable paragraph instead of a protected drawing.
  const detect = stripInkRuns(
    xml.includes('<mc:Fallback')
      ? xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
      : xml,
  )

  // Paragraph: certain constructs are protected as whole passthrough blocks.
  // Regenerating them would silently drop structure (section breaks, fields,
  // footnote anchors...), which is exactly the kind of damage patch-save exists
  // to prevent.
  // Only a content-less section-break paragraph is protected: one with visible
  // text renders as a normal paragraph (Word shows its content on the section's
  // last page); its w:sectPr rides along in rawPPr, which mergePPrFormat keeps
  // verbatim on edits, so the section survives regeneration.
  if (detect.includes('<w:sectPr') && !plainText(detect).trim()) {
    // A picture is visible content too: full-bleed covers live in the very
    // paragraph that closes the cover section, and the chip dropped them.
    // Only a plain picture takes this route; charts, diagrams and shape text
    // need the display paths further down, which the sectPr chip still guards.
    if (!RICH_DRAWING_RE.test(detect) && (await hasResolvablePicture(detect, ctx)))
      return buildTextParagraph(base, xml, ctx, true, el.start)
    return {
      ...base,
      type: 'passthrough',
      label: 'Section break paragraph',
      previewText: '',
    }
  }
  // Field chars inside textbox content don't make the paragraph itself a field
  // paragraph: research-report sidebars are VML textboxes embedding PAGE/date
  // fields, and those paragraphs must reach the textbox display path below
  //. Textbox blocks are protected passthrough anyway.
  const fieldDetect = detect.includes('<w:txbxContent') ? stripTextboxes(detect) : detect
  const hasFields =
    fieldDetect.includes('<w:fldChar') ||
    fieldDetect.includes('<w:fldSimple') ||
    fieldDetect.includes('<w:instrText')
  // Field paragraphs whose visible result is a picture (e.g. INCLUDEPICTURE)
  // should still display the image; the block stays protected either way.
  // Only when the picture is the whole visible content — a paragraph that also
  // carries text falls through to the field passthrough, whose preview keeps
  // the text instead of silently dropping it behind an image block.
  // Non-field drawing paragraphs take the drawing branch below, which keeps
  // mixed text + inline-image paragraphs editable.
  if (
    hasFields &&
    detect.includes('<w:drawing') &&
    !detect.includes('<c:chart') &&
    !detect.includes('r:dm=') &&
    !detect.includes('<dgm:') &&
    plainText(stripTextboxes(detect)).trim() === ''
  ) {
    const image = await extractImage(detect, ctx)
    if (image) {
      return { ...base, type: 'image', label: 'Image', imageDataUrl: image, ...imageMeta(detect) }
    }
  }
  const fieldPassthrough = (): Block => {
    const pStyle = tagAttr(xml, 'w:pStyle', 'w:val')
    const fieldDisplay = fieldDisplayOf(xml, ctx.styles)
    if (fieldDisplay?.kind === 'text') {
      const runs = fieldResultRuns(xml, ctx, fieldDisplay.left ?? '')
      if (runs) fieldDisplay.runs = runs
    }
    return {
      ...base,
      type: 'passthrough',
      label: fieldLabel(xml),
      previewText: plainText(xml),
      fieldDisplay,
      ...(pStyle ? { styleId: pStyle } : {}),
    }
  }
  // a chart sharing its paragraph with a caption field (SEQ) takes the chart
  // branch below, which keeps the caption as the block's field display
  const hasChart = detect.includes('<c:chart') || detect.includes('<cx:chart')
  if (hasFields && !hasChart) {
    // Legacy field-form OLE ({ EMBED ... } / { LINK ... } around a w:object):
    // take the OLE display path so the packaged preview picture and its
    // declared size survive instead of a bare "Field (EMBED)" chip.
    if (detect.includes('<w:object') && onlyOleFields(fieldDetect)) {
      return {
        ...base,
        type: 'passthrough',
        label: 'Embedded object',
        previewText: plainText(detect),
        ...(await oleDisplay(detect, ctx)),
      }
    }
    // XE (index entry) fields are invisible markers; a paragraph whose only
    // fields are XE stays editable (extractRuns round-trips the markers).
    if (!onlyXeFields(detect)) return fieldPassthrough()
  }
  // TOC-styled paragraphs are part of a TOC field result even when they carry
  // no field chars themselves (entries with literal page numbers). Editing
  // them individually would corrupt the field, so they stay protected.
  // Word writes styleIds "TOC1".."TOC9"; Pages exports "TOC 1"/"TOC 2" (with
  // space); html2docx-style exports use opaque ids with the name "toc 1".
  const tocStyleId = tagAttr(xml, 'w:pStyle', 'w:val')
  if (tocStyleId && tocLevelOf(tocStyleId, ctx.styles) !== null) {
    return {
      ...base,
      type: 'passthrough',
      label: 'TOC entry',
      previewText: plainText(xml),
      fieldDisplay: fieldDisplayOf(xml, ctx.styles),
      styleId: tocStyleId,
    }
  }
  // footnote / endnote references are editable: extractRuns turns them into
  // Run.noteRef markers that regenerate as w:footnoteReference / w:endnoteReference
  // Run-level w:ins / w:del are parsed into Run.ins / Run.del (editable).
  // Paragraph-property revisions (pPrChange / numberingChange / paragraph-mark
  // ins/del) live in pPr and survive editing via Block.rawPPr passthrough.
  // moveFrom / moveTo are now parsed as editable with move-revision markers.
  // Only run-level revision constructs the run model cannot round-trip stay
  // protected: run-property changes, deleted field instructions, table-cell ins/del.
  if (/<w:(delInstrText|cellIns|cellDel)[ />]/.test(detect)) {
    return {
      ...base,
      type: 'passthrough',
      label: 'Revised paragraph',
      previewText: plainText(detect),
    }
  }
  // display equations (oMathPara / math-only paragraphs) stay protected as a
  // whole; paragraphs mixing math with plain text fall through to
  // buildTextParagraph, where each m:oMath becomes an atomic inline math run
  if (
    detect.includes('<m:oMath') &&
    (detect.includes('<m:oMathPara') || plainText(detect).trim() === '')
  ) {
    const tokens = mathTokens(detect)
    const omml = ommlFragmentsOf(detect).join('')
    // 2D MathML only for pure equations; an oMathPara paragraph that also has
    // plain runs keeps the flat token strip so the surrounding text stays visible
    const mathml = plainText(detect).trim() === '' ? ommlToMathML(omml) : ''
    const latex = omml ? ommlToLatex(omml) : null
    const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? ''
    const styleId = tagAttr(pPr, 'w:pStyle', 'w:val')
    const align = mathParaAlign(detect, pPr)
    return {
      ...base,
      type: 'passthrough',
      label: 'Equation',
      previewText: tokens.join(''),
      ...(styleId ? { styleId } : {}),
      formulaDisplay: {
        tokens,
        ...(mathml ? { mathml } : {}),
        ...(omml ? { omml } : {}),
        ...(latex ? { latex } : {}),
        sizeHalfPoints: mathSizeHalfPoints(omml, pPr, styleId, ctx),
        ...(align ? { align } : {}),
        ...directParaGeometry(pPr),
      },
    }
  }
  if (detect.includes('<w:object') || /<w:pict[\s>]/.test(detect)) {
    // Legacy VML textboxes (v:shape/v:textbox) and WordArt (v:textpath) in
    // w:pict: extract the structured display model instead of flattening every
    // nested paragraph and table into one unreadable run — or degrading the
    // whole paragraph to an opaque chip. w:object (OLE) keeps the plain preview.
    if (
      !detect.includes('<w:object') &&
      (detect.includes('<w:txbxContent') ||
        VML_WORDART_RE.test(detect) ||
        hasFloatingVmlGeometry(detect))
    ) {
      // DrawingML pictures anchored next to the VML shape: resolve their media
      // and open the pictures gate, or the photos silently vanish from the page.
      // Host-level XML only — a picture nested in the textbox's own content
      // must not be lifted into a page-level photo box.
      const hostXml = stripTextboxes(detect)
      const anchoredPics =
        hostXml.includes('<w:drawing') &&
        (hostXml.includes('<pic:pic') || hostXml.includes('<a:blip'))
      if (anchoredPics || VML_PICT_RID_RE.test(hostXml)) await resolveBlipMedia(detect, ctx)
      const textboxes = extractTextboxes(
        detect,
        ctx,
        anchoredPics
          ? {
              shapes: true,
              pictures: true,
              section: ctx.sectionAt?.(el.start),
              docOffset: el.start,
              firstPage:
                index > 0 &&
                (ctx.firstPageBreakAt === undefined || el.start < ctx.firstPageBreakAt),
            }
          : {
              docOffset: el.start,
              ...(hasFloatingVmlGeometry(detect) ? { shapes: true } : {}),
              // pure VML paragraphs resolve mso-position keywords against the
              // section; a DrawingML twin keeps the section-free legacy placement
              ...(hostXml.includes('<w:drawing') ? {} : { section: ctx.sectionAt?.(el.start) }),
            },
      )
      const strayText = plainText(stripTextboxes(detect)).trim()
      // paragraphs mixing an inline VML picture with real text stay on the
      // editable run-image path below; boxes would drop the picture. Only a
      // v:imagedata with an r:id is a picture — WPS stamps a bare
      // <v:imagedata o:title=""/> on plain textbox shapes.
      const keepForImages = strayText !== '' && VML_PICT_RID_RE.test(detect)
      if (textboxes.length > 0 && !keepForImages) {
        // text the paragraph carries next to the shape (canvas + hyperlinks):
        // shown as a display-only line so it stays visible. A numbered anchor
        // paragraph is still an item of its list in Word, so its text rides as
        // strayRuns (marker + list geometry) instead of an unnumbered box
        const stray =
          strayText !== ''
            ? strayParaRuns(detect.replace(/<w:pict>[\s\S]*?<\/w:pict>/g, ''), ctx)
            : null
        const listStray =
          stray?.list && stray.runs.length > 0 ? { ...stray, list: stray.list } : null
        if (strayText !== '' && !listStray) {
          const strayBox = paragraphStrayBox(detect, ctx)
          if (strayBox) textboxes.push(strayBox)
        }
        // host paragraph jc only — a jc inside nested txbxContent must not
        // decide the outer block alignment
        const jc = /<w:jc w:val="([^"]+)"/.exec(stripTextboxes(detect))?.[1]
        return {
          ...base,
          type: 'passthrough',
          label: 'Text box',
          // floating shapes leave the flow, but Word still lays the anchor
          // paragraph out as an empty line of its own style and spacing
          ...(el.name === 'w:p' ? { anchorLine: anchorLineOf(xml) } : {}),
          previewText: [
            ...(listStray ? [strayText] : []),
            ...textboxes.flatMap((t) => t.paras.map((p) => p.runs.map((r) => r.text).join(''))),
          ].join('\n'),
          textboxes,
          ...(hostPageBreak(detect) ? { fieldDisplay: { kind: 'pageBreak' as const } } : {}),
          ...(jc === 'center'
            ? { imageAlign: 'center' as const }
            : jc === 'right' || jc === 'end'
              ? { imageAlign: 'right' as const }
              : {}),
          ...(listStray
            ? {
                strayRuns: listStray.runs,
                ...(listStray.styleId ? { strayStyleId: listStray.styleId } : {}),
                ...(listStray.indent ? { strayIndent: listStray.indent } : {}),
                ...(listStray.align ? { strayAlign: listStray.align } : {}),
                strayList: listStray.list,
              }
            : {}),
        }
      }
    }
    // Plain VML picture (v:imagedata without OLE): stamps, watermark pictures,
    // Word-2003-era inline images. Render as a real image instead of an opaque
    // "Embedded object" chip (which loses both the picture and any run text).
    if (!detect.includes('<w:object') && VML_PICT_RID_RE.test(detect)) {
      if (plainText(stripTextboxes(detect)).trim() !== '') {
        // picture shares the paragraph with real text: keep the text editable
        // with run-level images (the pict fragment round-trips verbatim)
        await resolveBlipMedia(detect, ctx)
        return buildTextParagraph(base, xml, ctx, true, el.start)
      }
      const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(detect)?.[1]
      const image = rId
        ? await mediaDataUrl(ctx.zip, ctx.rels, rId, ctx.sourcePath ?? 'word/document.xml')
        : null
      if (image) {
        return {
          ...base,
          type: 'image',
          label: 'Image',
          imageDataUrl: image,
          ...vmlImageMeta(detect),
        }
      }
    }
    if (
      !detect.includes('<w:object') &&
      plainText(detect).trim() === '' &&
      isInvisibleVmlPict(detect)
    ) {
      return {
        ...base,
        type: 'passthrough',
        label: 'Drawing object',
        invisibleMarker: true,
        ...(el.name === 'w:p' ? { anchorLine: anchorLineOf(xml) } : {}),
      }
    }
    // inline VML geometry (diamonds, arrows between words) and picts with no
    // drawable shape at all: the paragraph stays text, the shapes ride as
    // run images (SVG) so the text next to them keeps flowing
    if (!detect.includes('<w:object') && vmlPictsInlineOnly(detect, ctx.vmlShapeTypes)) {
      return buildTextParagraph(base, xml, ctx, true, el.start)
    }
    // VML horizontal rule (<hr> import: <v:rect o:hr="t">): Word lays the rule
    // picture on a line of its own that is one line of the rule run's font
    // (alone in the paragraph or wrapped under the runs), plus the paragraph
    // spacing — so it stays a text paragraph and the rule rides as a run image.
    // A passthrough chip dropped both the line and the spacing (~1 line short
    // per rule, cumulative page drift)
    if (!detect.includes('<w:object') && /<v:rect\b[^>]*\bo:hr="t"[^>]*>/.test(detect)) {
      if (detect.includes('<a:blip')) await resolveBlipMedia(detect, ctx)
      return buildTextParagraph(base, xml, ctx, true, el.start)
    }
    // OLE embed sharing the paragraph with real text or another drawing: an
    // "Embedded object" block renders only the preview picture, silently
    // dropping the rest. Keep the paragraph on the run-image path (the
    // w:object fragment round-trips verbatim). Only when every object's
    // preview resolved — otherwise the passthrough below at least keeps the
    // object bytes safe.
    if (
      detect.includes('<w:object') &&
      (plainText(stripTextboxes(detect)).trim() !== '' || detect.includes('<w:drawing'))
    ) {
      await resolveBlipMedia(detect, ctx)
      const objects = detect.match(/<w:object[\s\S]*?<\/w:object>/g) ?? []
      const displayable = objects.every((o) => {
        const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(o)?.[1]
        return rId !== undefined && ctx.mediaByRid?.has(rId)
      })
      if (displayable && objects.length > 0)
        return buildTextParagraph(base, xml, ctx, true, el.start)
    }
    return {
      ...base,
      type: 'passthrough',
      label: 'Embedded object',
      previewText: plainText(detect),
      ...(await oleDisplay(detect, ctx)),
    }
  }
  if (detect.includes('<w:drawing')) {
    if (
      detect.includes('<c:chart') ||
      detect.includes('<cx:chart') ||
      detect.includes('r:dm=') ||
      detect.includes('<dgm:')
    ) {
      const isChart = detect.includes('<c:chart') || detect.includes('<cx:chart')
      // chartex (cx 2014 extension: sunburst/boxWhisker/waterfall…): Word pairs
      // the Choice with a pre-rendered picture fallback — exactly what other
      // renderers show. Prefer it; the data-model degrade only covers
      // fallback-less parts.
      if (isChart && !hasFields && detect.includes('/drawing/2014/chartex"')) {
        const fbImage = await extractImage(xml, ctx)
        if (fbImage) {
          return {
            ...base,
            type: 'image',
            label: 'Image',
            imageDataUrl: fbImage,
            ...imageMeta(xml),
          }
        }
      }
      const chartDisplay = isChart ? await extractChart(detect, ctx) : null
      // no drawable chart model (missing part, cache-less series): the caption
      // field paragraph renders as it did before charts took this branch
      if (isChart && !chartDisplay && hasFields) return fieldPassthrough()
      const caption =
        chartDisplay && plainText(stripTextboxes(detect)).trim() !== ''
          ? fieldDisplayOf(xml, ctx.styles)
          : undefined
      if (caption?.kind === 'text') {
        const runs = fieldResultRuns(xml, ctx, caption.left ?? '')
        if (runs) caption.runs = runs
      }
      const diagramText = isChart ? null : await extractDiagramText(detect, ctx)
      const diagramDisplay = isChart ? null : await extractDiagramDrawing(detect, ctx)
      // the diagram may share its paragraph with other anchored drawings
      // (photos, gallery shapes): extract those too, each at its own anchor,
      // instead of silently dropping everything but the diagram
      const frags = topLevelDrawings(detect)
      let siblingBoxes: TextboxDisplay[] = []
      if (!isChart && frags.length > 1) {
        if (diagramDisplay) {
          const dmFrag = frags.find((f) => f.includes('r:dm='))
          const meta = dmFrag ? drawingAnchorMeta(dmFrag) : {}
          if (meta.anchored) {
            diagramDisplay.offsetXEmu = meta.offsetXEmu
            diagramDisplay.offsetYEmu = meta.offsetYEmu
            diagramDisplay.floating = true
          }
        }
        await resolveBlipMedia(detect, ctx)
        siblingBoxes = extractTextboxes(detect, ctx, {
          shapes: true,
          pictures: true,
          section: ctx.sectionAt?.(el.start),
          docOffset: el.start,
        })
      }
      return {
        ...base,
        type: 'passthrough',
        label: isChart ? 'Chart' : 'SmartArt',
        ...(chartDisplay ? { chartDisplay, previewText: chartDisplay.title ?? '' } : {}),
        ...(caption?.kind === 'text' ? { fieldDisplay: caption } : {}),
        ...(diagramText ? { previewText: diagramText } : {}),
        ...(diagramDisplay ? { diagramDisplay } : {}),
        ...(siblingBoxes.length > 0 ? { textboxes: siblingBoxes } : {}),
      }
    }
    // drawing canvas (lockedCanvas): scaled child geometry + raw-size text
    if (detect.includes('<lc:lockedCanvas')) {
      await resolveBlipMedia(detect, ctx)
      const canvas = extractLockedCanvas(detect, ctx)
      if (canvas) {
        const frags = topLevelDrawings(detect)
        const meta = frags.length > 0 ? drawingAnchorMeta(frags[0]) : {}
        if (meta.anchored) {
          // horizontal anchor offset only: LO renders these canvases from the
          // anchor paragraph's top, dropping the vertical offset
          canvas.offsetXEmu = meta.offsetXEmu
          if (meta.noWrap) canvas.floating = true
        }
        return {
          ...base,
          type: 'passthrough',
          label: 'Drawing object',
          diagramDisplay: canvas,
          previewText: canvas.shapes.flatMap((s) => s.texts ?? []).join('\n'),
        }
      }
    }
    const image = await extractImage(detect, ctx)
    // wps shapes would vanish on the plain-paragraph and single-image paths:
    // paragraphs carrying them prefer the box-extraction route below
    const hasWsp = detect.includes('<wps:wsp')
    // text next to a row of side-wrapped pictures covering the column: no text
    // fits beside the row, so the pictures band (photo-box route) instead of
    // stacking as CSS floats that cannot share a line
    let spanningPhotoRow = false
    if (image) {
      // shapes carrying textbox content alongside a blip (photo-framed quote
      // boxes, image-filled shapes with captions): an image block would drop
      // the text, so fall through to the textbox display below instead
      const boxed = detect.includes('<w:txbxContent')
        ? extractTextboxes(detect, ctx).some((t) =>
            t.paras.some(
              (p) =>
                p.runs.some((r) => r.text.trim() !== '') ||
                p.cells?.some((c) => c.paras.some((rs) => rs.some((r) => r.text.trim() !== ''))),
            ),
          )
        : false
      if (!boxed) {
        // picture(s) sharing the paragraph with real text — or several inline
        // pictures in one paragraph: an image block keeps only the first blip
        // and drops every text run, so stay an editable paragraph with
        // run-level images. Anchored (floating) pictures keep their wp:anchor
        // geometry on Run.image and float in the editor like Word.
        const multiPic = (detect.match(/<a:blip[ />]/g) ?? []).length > 1
        const hasText = plainText(stripTextboxes(detect)).trim() !== ''
        const drawings = topLevelDrawings(detect)
        const anchoredDrawings = drawings.filter((f) => f.includes('<wp:anchor')).length
        // logo row (one floating + inline pictures): the image block would keep only the floating blip
        const inlineBesideAnchor =
          anchoredDrawings === 1 &&
          drawings.some((f) => !f.includes('<wp:anchor') && f.includes('<pic:pic'))
        if (
          (hasText && !hasWsp) ||
          (multiPic && (!detect.includes('<wp:anchor') || (inlineBesideAnchor && !hasWsp)))
        ) {
          await resolveBlipMedia(detect, ctx)
          // inline pictures must keep flowing: the photo-box route freezes the
          // paragraph into one unsplittable protected block, so a gallery of
          // inline photos spanning several pages would be clipped to one
          const inlinePics = drawings.filter(
            (f) => !f.includes('<wp:anchor') && f.includes('<pic:pic'),
          ).length
          spanningPhotoRow =
            hasText &&
            anchoredDrawings >= 2 &&
            inlinePics === 0 &&
            extractTextboxes(detect, ctx, {
              pictures: true,
              section: ctx.sectionAt?.(el.start),
              docOffset: el.start,
            }).some((b) => b.bandBottomPx !== undefined)
          if (!spanningPhotoRow) return buildTextParagraph(base, xml, ctx, true, el.start)
        }
        // several separately-anchored pictures in one paragraph (photo walls):
        // the single-image block keeps only the first blip and drops the other
        // photos with their anchor offsets, so take the photo-box route below
        if (!hasWsp && anchoredDrawings <= 1) {
          const meta = imageMeta(detect)
          const sect = ctx.sectionAt?.(el.start)
          if (
            (ctx.floatTableAhead &&
              pictureBesideFloatTable(meta, detect, ctx.floatTableAhead, sect)) ||
            pictureOverhangsColumn(meta, detect, sect)
          ) {
            meta.imageBand = true
          }
          const sideWrapped = /^(?:square|tight|through)-(?:left|right)$/.test(meta.imageWrap ?? '')
          return {
            ...base,
            type: 'image',
            label: 'Image',
            imageDataUrl: image,
            ...meta,
            ...(sideWrapped && !meta.imageBand ? { anchorLine: anchorLineOf(xml) } : {}),
          }
        }
      }
    }
    // picture fills inside shapes (a:blipFill) and sibling/grouped pic:pic
    // blips resolve from pre-fetched media
    if (detect.includes('<a:blip')) await resolveBlipMedia(detect, ctx)
    // shapes on: textless preset shapes (stars, triangles, block arrows,
    // anchored connectors) render instead of degrading to a chip; pictures on:
    // grouped/sibling pic:pic drawings render as photo boxes
    const textboxes = extractTextboxes(detect, ctx, {
      shapes: true,
      pictures: true,
      section: ctx.sectionAt?.(el.start),
      docOffset: el.start,
      // page-pinning needs content ABOVE the anchor paragraph to matter: a
      // first-block anchor is already exact under the paragraph-origin path
      // (and stays aligned with the body text around it)
      firstPage:
        index > 0 && (ctx.firstPageBreakAt === undefined || el.start < ctx.firstPageBreakAt),
    })
    const boxTexts = textboxes.flatMap((t) =>
      t.paras.map((p) => p.runs.map((r) => r.text).join('')),
    )
    const strayText = plainText(stripTextboxes(detect)).trim()
    // Anchored decorative shape (underline rule, background box...) in a
    // paragraph that also carries real text: parse it as a normal paragraph so
    // the text stays readable/editable. The shape lives in runs we do not
    // regenerate — the block still saves byte-identical while untouched, and
    // only loses the decoration if the user actually edits this paragraph.
    // Content-carrying textboxes are the exception: the plain-paragraph path
    // would silently drop their text, so the block stays a textbox passthrough
    // (the stray text joins the preview instead of vanishing). Same for
    // wps-shape paragraphs that extracted visible boxes: dropping them loses
    // real page furniture (cards, dividers), so the text rides along as
    // display-only strayRuns instead.
    if (
      strayText !== '' &&
      !spanningPhotoRow &&
      !boxTexts.some((t) => t.trim() !== '') &&
      !(hasWsp && textboxes.length > 0)
    ) {
      return buildTextParagraph(base, xml, ctx, true, el.start)
    }
    // Anchored textboxes (code boxes, callout cards): all visible text lives in
    // w:txbxContent. Extract a display-only model so content and box styling
    // render; the block stays protected and saves byte-identical. Text the
    // paragraph itself carries next to the boxes is kept as display-only runs
    // (strayRuns) so it doesn't vanish from the page.
    if (textboxes.length > 0) {
      // inline pictures sharing an anchored-drawing paragraph flow as stray run
      // images: a non-floating photo box would knock the whole block out of the
      // zero-height floating overlay (Word keeps them on the paragraph's line)
      const inlineRunPics =
        detect.includes('<wp:anchor') &&
        topLevelDrawings(detect).some(
          (f) =>
            !f.includes('<wp:anchor') && f.includes('<pic:pic') && !f.includes('<w:txbxContent'),
        )
      const stray =
        strayText !== '' || inlineRunPics ? strayParaRuns(detect, ctx, inlineRunPics) : null
      const meta = imageMeta(detect)
      // Word sizes the anchor paragraph's own line by its paragraph mark, so an
      // empty spacer paragraph (w:sz 2-6 carrying only a divider rule) keeps
      // its 1-3pt line instead of a default-size strut; a side-wrapped anchor
      // gets its line from the float path
      const anchorLine =
        stray?.runs.length || (el.name === 'w:p' && !/-(?:left|right)$/.test(meta.imageWrap ?? ''))
          ? strayAnchorLine(xml, ctx)
          : undefined
      return {
        ...base,
        type: 'passthrough',
        label: 'Text box',
        previewText: (strayText !== '' ? [strayText, ...boxTexts] : boxTexts).join('\n'),
        textboxes,
        ...(/^<w:p\b[^>]*>\s*<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:snapToGrid w:val="(?:0|false)"\s*\/>/.test(
          xml,
        )
          ? { anchorSnapToGrid: false as const }
          : {}),
        ...(hostPageBreak(detect) ? { fieldDisplay: { kind: 'pageBreak' as const } } : {}),
        // the line lays out with the anchor paragraph's spacing and line rule;
        // wp:positionV paragraph offsets count from the top of its
        // space-before (Word probe 2026-09-17)
        ...(anchorLine ? { anchorLine } : {}),
        ...(stray && stray.runs.length > 0
          ? {
              strayRuns: stray.runs,
              ...(stray.styleId ? { strayStyleId: stray.styleId } : {}),
              ...(stray.indent ? { strayIndent: stray.indent } : {}),
              ...(stray.align ? { strayAlign: stray.align } : {}),
              ...(stray.list ? { strayList: stray.list } : {}),
            }
          : {}),
        ...meta,
      }
    }
    // wps paragraph whose shapes all turned out invisible: fall back to the
    // plain image block the pre-shape path would have produced
    if (image) {
      return { ...base, type: 'image', label: 'Image', imageDataUrl: image, ...imageMeta(detect) }
    }
    // Picture whose media cannot be shown (rel missing / pointing at a
    // non-media part, or metafile conversion failed): empty frame at the
    // declared extent
    // instead of a bare chip. Bytes still pass through untouched.
    if (detect.includes('<a:blip') || detect.includes('<pic:pic')) {
      const docPr = /<wp:docPr [^>]*\/?>/.exec(detect)?.[0] ?? ''
      const alt = /\bdescr="([^"]+)"/.exec(docPr)?.[1] ?? /\bname="([^"]+)"/.exec(docPr)?.[1]
      return {
        ...base,
        type: 'passthrough',
        label: 'Image',
        brokenImage: true,
        ...(alt ? { previewText: decodeEntities(alt) } : {}),
        ...imageMeta(detect),
      }
    }
    if (isInvisibleEmptyShape(detect)) {
      return { ...base, type: 'passthrough', label: 'Drawing object', invisibleMarker: true }
    }
    const decorative = isThinRule(detect)
    return {
      ...base,
      type: 'passthrough',
      label: 'Drawing object',
      decorative,
      ...(decorative ? ruleDisplayOf(detect) : {}),
    }
  }

  return buildTextParagraph(base, xml, ctx, false, el.start)
}

/** settings.xml compatSetting compatibilityMode (0 when absent = legacy layout) */
async function parseCompatibilityMode(zip: JSZip): Promise<number> {
  const file = zip.file('word/settings.xml')
  if (!file) return 0
  const xml = await file.async('string')
  // attribute order is generator-specific (w:val may precede w:name)
  for (const tag of xml.match(/<w:compatSetting\b[^>]*>/g) ?? []) {
    if (!/\sw:name="compatibilityMode"/.test(tag)) continue
    const val = /\sw:val="(\d+)"/.exec(tag)
    if (val) return parseInt(val[1], 10)
  }
  return 0
}

/** settings.xml w:autoHyphenation + w:defaultTabStop (absent = Word's 720 twips) */
async function parseLayoutSettings(zip: JSZip): Promise<{
  autoHyphenation?: boolean
  defaultTabStopTwips?: number
  balanceDbcsSpacing?: boolean
  useFELayout?: boolean
  compressPunctuation?: boolean
  adjustLineHeightInTable?: boolean
  indentNotNumberingTabStop?: boolean
}> {
  const file = zip.file('word/settings.xml')
  if (!file) return {}
  const xml = await file.async('string')
  const tab = /<w:defaultTabStop[^>]*w:val="(-?\d+)"/.exec(xml)
  const csc = /<w:characterSpacingControl[^>]*w:val="(\w+)"/.exec(xml)
  return {
    ...(xmlFlagOn(xml, 'w:autoHyphenation') ? { autoHyphenation: true } : {}),
    ...(tab ? { defaultTabStopTwips: parseInt(tab[1], 10) } : {}),
    ...(xmlFlagOn(xml, 'w:balanceSingleByteDoubleByteWidth') ? { balanceDbcsSpacing: true } : {}),
    ...(xmlFlagOn(xml, 'w:useFELayout') ? { useFELayout: true } : {}),
    ...(csc && csc[1].startsWith('compressPunctuation') ? { compressPunctuation: true } : {}),
    ...(xmlFlagOn(xml, 'w:adjustLineHeightInTable') ? { adjustLineHeightInTable: true } : {}),
    ...(xmlFlagOn(xml, 'w:doNotUseIndentAsNumberingTabStop')
      ? { indentNotNumberingTabStop: true }
      : {}),
  }
}

/** effective document-wide footnotePr / endnotePr: settings.xml overlaid by the final body sectPr */
async function parseNoteProps(
  zip: JSZip,
  documentXml: string,
): Promise<{ footnoteProps?: NoteProps; endnoteProps?: NoteProps }> {
  const settingsXml = (await zip.file('word/settings.xml')?.async('string')) ?? ''
  // a tracked w:sectPrChange embeds the previous sectPr after the live one
  const bodyXml = documentXml.replace(/<w:sectPrChange\b[\s\S]*?<\/w:sectPrChange>/g, '')
  const at = bodyXml.lastIndexOf('<w:sectPr')
  const lastSectPr = at >= 0 ? bodyXml.slice(at) : ''
  const merged = (tag: 'w:footnotePr' | 'w:endnotePr'): NoteProps | undefined => {
    const base = notePropsFromXml(settingsXml, tag)
    const own = notePropsFromXml(lastSectPr, tag)
    return base || own ? { ...base, ...own } : undefined
  }
  const footnoteProps = merged('w:footnotePr')
  const endnoteProps = merged('w:endnotePr')
  return {
    ...(footnoteProps ? { footnoteProps } : {}),
    ...(endnoteProps ? { endnoteProps } : {}),
  }
}

/** settings.xml on/off flag such as <w:evenAndOddHeaders/> (w:val="0|false" counts as off) */
async function parseSettingsFlag(zip: JSZip, tag: string): Promise<boolean> {
  const file = zip.file('word/settings.xml')
  if (!file) return false
  return xmlFlagOn(await file.async('string'), tag)
}

async function parseNotesPart(zip: JSZip, kind: 'footnote' | 'endnote'): Promise<NoteInfo[]> {
  const file = zip.file(NOTE_PART_PATH[kind])
  if (!file) return []
  return parseNotesXml(await file.async('string'), kind)
}

async function parseSources(zip: JSZip): Promise<SourceInfo[]> {
  const path = await findSourcesPart(zip)
  if (!path) return []
  return parseSourcesXml(await zip.file(path)!.async('string'))
}

async function parseTheme(
  zip: JSZip,
): Promise<{ fonts: ThemeFonts | null; colors: ThemeColors | null }> {
  // no theme part: Word still resolves schemeClr/themeColor references
  // against the built-in Office palette, so a missing part must not null out
  // the color context (themeless docx4j/mc test docs, sample real_run2 09/10)
  const file = zip.file(THEME_PART_PATH)
  if (!file) return { fonts: null, colors: { ...DEFAULT_THEME_COLORS } }
  const xml = await file.async('string')
  const fonts = readThemeFonts(xml)
  if (fonts) {
    const { eaLang, bidiLang } = await readThemeFontLang(zip)
    if (eaLang) fonts.eaLang = eaLang
    if (bidiLang) fonts.bidiLang = bidiLang
  }
  return { fonts, colors: readThemeColors(xml) }
}

/** settings.xml w:themeFontLang w:eastAsia / w:bidi */
async function readThemeFontLang(zip: JSZip): Promise<{ eaLang?: string; bidiLang?: string }> {
  const file = zip.file('word/settings.xml')
  if (!file) return {}
  const tag = /<w:themeFontLang\b[^>]*>/.exec(await file.async('string'))?.[0]
  if (!tag) return {}
  return {
    eaLang: /\bw:eastAsia="([^"]+)"/.exec(tag)?.[1],
    bidiLang: /\bw:bidi="([^"]+)"/.exec(tag)?.[1],
  }
}

/** w:altChunk HTML/MHT parts left unexpanded because no converter is installed */
const unconvertedChunksByZip = new WeakMap<JSZip, number>()

/** attach the media data URL of each w:numPicBullet to the levels referencing it */
async function resolvePicBullets(
  zip: JSZip,
  numbering: Map<string, NumberingDef>,
  picBullets: Map<number, string>,
): Promise<void> {
  if (picBullets.size === 0) return
  const rels = await parseRels(zip, 'word/_rels/numbering.xml.rels')
  const srcById = new Map<number, string>()
  for (const [id, rId] of picBullets) {
    const src = await mediaDataUrl(zip, rels, rId, 'word/numbering.xml')
    if (src) srcById.set(id, src)
  }
  for (const def of numbering.values()) {
    for (const level of Object.values(def.levels)) {
      if (level.picBulletId === undefined || level.picBulletSrc) continue
      const src = srcById.get(level.picBulletId)
      if (src) level.picBulletSrc = src
    }
  }
}

/**
 * Pre-fetch external textbox parts referenced by `<wps:txbx r:txbx="…"/>`
 * (older Word builds store the w:p list in word/txbx*.xml instead of an
 * inline w:txbxContent; extractTextboxes is sync).
 */
async function externalTxbxParts(
  documentXml: string,
  zip: JSZip,
  rels: Map<string, RelInfo>,
  sourcePath = 'word/document.xml',
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const m of documentXml.matchAll(/<wps:txbx\b[^>]*\br:txbx="([^"]+)"/g)) {
    const rId = m[1]
    if (out.has(rId)) continue
    const rel = rels.get(rId)
    if (!rel || rel.targetMode === 'External') continue
    const path = resolveRelationshipTargetPath(sourcePath, rel.target)
    const file = path ? zip.file(path) : null
    if (file) out.set(rId, await file.async('string'))
  }
  return out
}

/**
 * Pre-resolve blip rIds found inside w:tbl (extractCell is sync, media reads
 * are async). Scoped to tables to bound memory.
 */
async function tableBlipMedia(
  elements: BodyElement[],
  documentXml: string,
  zip: JSZip,
  rels: Map<string, RelInfo>,
  sourcePath = 'word/document.xml',
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const rIds = new Set<string>()
  for (const el of elements) {
    if (el.name !== 'w:tbl' && el.name !== 'w:sdt') continue
    let slice = documentXml.slice(el.start, el.end)
    if (el.name === 'w:sdt') {
      const from = slice.indexOf('<w:tbl')
      if (from === -1) continue
      slice = slice.slice(from, slice.lastIndexOf('</w:tbl>') + '</w:tbl>'.length)
    }
    for (const m of slice.matchAll(/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/g))
      rIds.add(m[1])
    // legacy VML pictures and OLE previews inside cells (w:pict / w:object)
    for (const m of slice.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g)) rIds.add(m[1])
  }
  for (const rId of rIds) {
    const rel = rels.get(rId)
    if (!rel) continue
    if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
      out.set(rId, rel.target)
      continue
    }
    const dataUrl = await mediaDataUrl(zip, rels, rId, sourcePath)
    if (dataUrl) out.set(rId, dataUrl)
  }
  return out
}

/** drawing kinds that need a display path of their own rather than a run image */
const RICH_DRAWING_RE = /<c:chart|<cx:chart|<dgm:|r:dm=|<lc:lockedCanvas|<wps:wsp|<w:txbxContent/

/** true when the paragraph holds a picture whose media resolves (media is cached for extractRuns) */
async function hasResolvablePicture(xml: string, ctx: BuildContext): Promise<boolean> {
  if (!/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']|<v:imagedata[^>]*r:id\s*=\s*["']/.test(xml))
    return false
  await resolveBlipMedia(xml, ctx)
  const media = ctx.mediaByRid
  if (!media) return false
  for (const m of xml.matchAll(
    /<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']|<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g,
  )) {
    const rId = m[1] ?? m[2]
    if (rId && media.has(rId)) return true
  }
  return false
}

/** resolve a paragraph's blip/VML-imagedata rIds into ctx.mediaByRid so extractRuns (sync) can build image runs */
async function resolveBlipMedia(xml: string, ctx: BuildContext): Promise<void> {
  const media = ctx.mediaByRid
  if (!media) return
  // embed and link matched separately: on a blip carrying both, the greedy
  // combined pattern only captured the link and left the embedded part unresolved
  const refs = [
    ...xml.matchAll(/<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/g),
    ...xml.matchAll(/<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/g),
    ...xml.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g),
  ]
  for (const m of refs) {
    const rId = m[1]
    if (media.has(rId)) continue
    const rel = ctx.rels.get(rId)
    if (!rel) continue
    if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
      media.set(rId, rel.target)
      continue
    }
    const dataUrl = await mediaDataUrl(
      ctx.zip,
      ctx.rels,
      rId,
      ctx.sourcePath ?? 'word/document.xml',
    )
    if (dataUrl) media.set(rId, dataUrl)
  }
}

async function extractImage(xml: string, ctx: BuildContext): Promise<string | null> {
  // embedded (r:embed -> word/media/...) or linked (r:link -> external URL)
  const rId =
    /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(xml)?.[1] ??
    /<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/.exec(xml)?.[1]
  if (!rId) return null
  const rel = ctx.rels.get(rId)
  if (!rel) return null

  // linked pictures (Word downloads them on open; we let <img> do the same)
  if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
    return rel.target
  }

  const path = resolveRelationshipTargetPath(ctx.sourcePath ?? 'word/document.xml', rel.target)
  return path ? mediaPartDataUrl(ctx.zip, path) : null
}

/**
 * SmartArt degrade: the node texts from the diagram data part (r:dm)
 * become the preview, so the reader still sees the labels the diagram holds.
 * Texts are ordered by walking the diagram's parent-child connections
 * (dgm:cxn srcOrd) — the file order of dgm:pt nodes is arbitrary, while
 * renderers lay shapes out in tree order.
 */
async function extractDiagramText(xml: string, ctx: BuildContext): Promise<string | null> {
  const path = relPartPath(ctx, /r:dm\s*=\s*["']([^"']+)["']/.exec(xml)?.[1])
  const file = path ? ctx.zip.file(path) : null
  if (!file) return null
  const dataXml = await file.async('string')
  // node texts by modelId (pres/transition points carry no content text)
  const ptTexts = new Map<string, string>()
  for (const m of dataXml.matchAll(/<dgm:pt modelId="([^"]+)"([^>]*)>([\s\S]*?)<\/dgm:pt>/g)) {
    if (/type="(?:pres|parTrans|sibTrans)"/.test(m[2])) continue
    const s = (m[3].match(/<a:t>[^<]*<\/a:t>/g) ?? [])
      .map((t) => decodeEntities(t.slice(5, -6)))
      .join('')
      .trim()
    if (s) ptTexts.set(m[1], s)
  }
  // parent-child edges: cxns without an explicit type (default parOf); typed
  // cxns (presOf/presParOf...) are layout wiring, not the content tree
  const children = new Map<string, Array<{ ord: number; id: string }>>()
  const hasParent = new Set<string>()
  for (const m of dataXml.matchAll(/<dgm:cxn [^>]*\/?>/g)) {
    const tag = m[0]
    if (/type="(?!parOf")/.test(tag)) continue
    const src = /srcId="([^"]+)"/.exec(tag)?.[1]
    const dst = /destId="([^"]+)"/.exec(tag)?.[1]
    if (!src || !dst) continue
    const ord = parseInt(/srcOrd="(\d+)"/.exec(tag)?.[1] ?? '0', 10)
    if (!children.has(src)) children.set(src, [])
    children.get(src)!.push({ ord, id: dst })
    hasParent.add(dst)
  }
  const texts: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const t = ptTexts.get(id)
    if (t) texts.push(t)
    for (const c of (children.get(id) ?? []).sort((a, b) => a.ord - b.ord)) visit(c.id)
  }
  for (const root of children.keys()) if (!hasParent.has(root)) visit(root)
  // isolated points (no tree info) keep file order
  for (const [id, t] of ptTexts) if (!seen.has(id)) texts.push(t)
  return texts.length > 0 ? texts.join('\n') : null
}

/**
 * SmartArt visual degrade: Word saves the resolved layout in a companion
 * diagrams/drawingN.xml (dsp:sp shapes with absolute geometry, fills incl.
 * pictures, and text bodies). Rendering those shapes reproduces the diagram
 * without a layout engine. Returns null when the part is absent (then only
 * the text degrade shows).
 */
/**
 * Drawing canvas (a:graphicData lockedCanvas): children carry absolute EMU
 * geometry in the canvas child-coordinate space (grpSpPr chOff/chExt), mapped
 * onto the drawing's wp:extent. Geometry scales through that mapping; text
 * keeps its raw font size and overflows the scaled boxes (LO behavior — the
 * canvas is usually authored far larger than the extent it is placed at).
 */
function extractLockedCanvas(xml: string, ctx: BuildContext): DiagramDisplay | null {
  const ci = xml.indexOf('<lc:lockedCanvas')
  if (ci === -1) return null
  const end = xml.indexOf('</lc:lockedCanvas>', ci)
  if (end === -1) return null
  // display size: the nearest wp:extent before the canvas (its own inline/anchor)
  const extTags = [...xml.slice(0, ci).matchAll(/<wp:extent[^>]*\/?>/g)].map((m) => m[0])
  const extTag = extTags[extTags.length - 1] ?? ''
  const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extTag)?.[1] ?? '', 10)
  const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extTag)?.[1] ?? '', 10)
  if (!Number.isFinite(extCx) || !Number.isFinite(extCy) || extCx <= 0 || extCy <= 0) return null
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(xml.slice(ci, end + '</lc:lockedCanvas>'.length)) as XNode[]
  } catch {
    return null
  }
  const canvasNode = parsed.find((n) => nameOf(n) === 'lc:lockedCanvas')
  if (!canvasNode) return null
  const grpXfrm = findChild(findChild(canvasNode, 'a:grpSpPr') ?? {}, 'a:xfrm')
  const emuAttr = (node: XNode | undefined, name: string, fallback: number): number => {
    const v = parseInt(attrsOf(node ?? {})[name] ?? '', 10)
    return Number.isFinite(v) ? v : fallback
  }
  const chOffX = emuAttr(findChild(grpXfrm ?? {}, 'a:chOff'), 'x', 0)
  const chOffY = emuAttr(findChild(grpXfrm ?? {}, 'a:chOff'), 'y', 0)
  const chExtCx = emuAttr(findChild(grpXfrm ?? {}, 'a:chExt'), 'cx', extCx)
  const chExtCy = emuAttr(findChild(grpXfrm ?? {}, 'a:chExt'), 'cy', extCy)
  const scaleX = chExtCx > 0 ? extCx / chExtCx : 1
  const scaleY = chExtCy > 0 ? extCy / chExtCy : 1
  const shapes: DiagramShape[] = []
  for (const child of childrenOf(canvasNode)) {
    const name = nameOf(child)
    if (name !== 'a:sp' && name !== 'a:pic') continue
    const spPr = findChild(child, 'a:spPr')
    const xfrm = findChild(spPr ?? {}, 'a:xfrm')
    const off = findChild(xfrm ?? {}, 'a:off')
    const ext = findChild(xfrm ?? {}, 'a:ext')
    if (!off || !ext) continue
    const shape: DiagramShape = {
      xPx: Math.round(((emuAttr(off, 'x', 0) - chOffX) * scaleX) / EMU_PER_PX),
      yPx: Math.round(((emuAttr(off, 'y', 0) - chOffY) * scaleY) / EMU_PER_PX),
      wPx: Math.round((emuAttr(ext, 'cx', 0) * scaleX) / EMU_PER_PX),
      hPx: Math.round((emuAttr(ext, 'cy', 0) * scaleY) / EMU_PER_PX),
    }
    if (shape.wPx <= 0 || shape.hPx <= 0) continue
    const rot = parseInt(attrsOf(xfrm!)['rot'] ?? '', 10)
    if (Number.isFinite(rot) && rot !== 0) shape.rotDeg = Math.round(rot / 60000)
    const prst = attrsOf(findChild(spPr ?? {}, 'a:prstGeom') ?? {})['prst']
    if (prst && prst !== 'rect') shape.prst = prst
    if (name === 'a:pic') {
      const rId = attrsOf(findChild(findChild(child, 'a:blipFill') ?? {}, 'a:blip') ?? {})[
        'r:embed'
      ]
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : undefined
      if (dataUrl) shape.imageDataUrl = dataUrl
    } else if (spPr && !findChild(spPr, 'a:noFill')) {
      const fill =
        colorNodeHex(findChild(spPr, 'a:solidFill'), ctx.themeColors) ??
        gradFillApproxHex(spPr, ctx.themeColors)
      if (fill) shape.fillHex = fill
    }
    const body = findChild(findChild(child, 'a:txSp') ?? {}, 'a:txBody')
    if (body) {
      const texts: string[] = []
      let sizePt: number | undefined
      let color: string | undefined
      for (const p of findChildren(body, 'a:p')) {
        const parts: string[] = []
        for (const r of findChildren(p, 'a:r')) {
          const t = findChild(r, 'a:t')
          if (t) parts.push(decodeNumericCharRefs(textOf(t)))
          const rPr = findChild(r, 'a:rPr')
          if (rPr && sizePt === undefined) {
            const sz = parseInt(attrsOf(rPr)['sz'] ?? '', 10)
            // raw canvas font size (hundredths of a point), deliberately unscaled
            if (Number.isFinite(sz) && sz > 0) sizePt = Math.round(sz / 100)
            const c = colorNodeHex(findChild(rPr, 'a:solidFill'), ctx.themeColors)
            if (c) color = c
          }
        }
        if (parts.join('').trim() !== '') texts.push(parts.join(''))
      }
      if (texts.length > 0) {
        shape.texts = texts
        if (sizePt) shape.fontSizePt = sizePt
        if (color) shape.textColorHex = color
      }
    }
    shapes.push(shape)
  }
  if (shapes.length === 0) return null
  // LO parity for severely overflowing canvas text (the canvas is authored
  // several times larger than its placed extent, so raw-size text dwarfs the
  // scaled boxes): LO stacks the text shapes as columns, each next column
  // starting about halfway down the previous column's text run. Reproducing
  // that stacking keeps the glyph reading order identical to LO's render.
  const textShapes = shapes.filter((s) => s.texts?.length && s.fontSizePt)
  const colGeom = (s: DiagramShape): { lines: number; pitchPx: number } => {
    const fontPx = (s.fontSizePt! * 96) / 72
    const charsPerLine = Math.max(1, Math.floor(s.wPx / (fontPx * 0.72)))
    const chars = (s.texts ?? []).join('').length
    return { lines: Math.ceil(chars / charsPerLine), pitchPx: fontPx * 1.2 }
  }
  const overflowing = textShapes.filter((s) => {
    const g = colGeom(s)
    return g.lines * g.pitchPx > 2 * s.hPx
  })
  if (overflowing.length > 0) {
    // the first overflowing column anchors at the canvas top (LO ignores the
    // scaled box offset once the text no longer fits the box)
    overflowing[0].yPx = 0
    for (let i = 1; i < overflowing.length; i++) {
      const prev = overflowing[i - 1]
      const g = colGeom(prev)
      overflowing[i].yPx = Math.round(prev.yPx + Math.ceil(g.lines / 2) * g.pitchPx - 23)
    }
    // single-letter-per-line columns explode into per-letter shapes ordered
    // top-down: the exported PDF then emits glyphs in painter order like LO,
    // and text extraction reads the interleaved columns identically
    for (const s of overflowing) {
      const g = colGeom(s)
      const chars = [...(s.texts ?? []).join('')]
      if (g.lines < chars.length) continue // wraps more than one char per line
      const at = shapes.indexOf(s)
      if (at === -1) continue
      const letters: DiagramShape[] = chars.map((ch, i) => ({
        xPx: s.xPx,
        yPx: Math.round(s.yPx + i * g.pitchPx),
        wPx: s.wPx,
        hPx: Math.ceil(g.pitchPx),
        texts: [ch],
        ...(s.fontSizePt ? { fontSizePt: s.fontSizePt } : {}),
        ...(s.textColorHex ? { textColorHex: s.textColorHex } : {}),
      }))
      shapes.splice(at, 1, ...letters)
    }
    shapes.sort((a, b) => a.yPx - b.yPx)
  }
  return {
    widthPx: emuToPx(extCx),
    heightPx: emuToPx(extCy),
    shapes,
    canvas: true,
  }
}

async function extractDiagramDrawing(
  xml: string,
  ctx: BuildContext,
): Promise<DiagramDisplay | null> {
  const dmPath = relPartPath(ctx, /r:dm\s*=\s*["']([^"']+)["']/.exec(xml)?.[1])
  if (!dmPath) return null
  const drawingPath = dmPath.replace(/data(\d*)\.xml$/, 'drawing$1.xml')
  const file = drawingPath !== dmPath ? ctx.zip.file(drawingPath) : null
  if (!file) return null
  // the owning drawing's extent is the last one before its dgm:relIds (a
  // paragraph can hold several drawings)
  const dmAt = xml.search(/r:dm\s*=/)
  const extentTags = [
    ...(dmAt >= 0 ? xml.slice(0, dmAt) : xml).matchAll(/<wp:extent[^>]*\/?>/g),
  ].map((m) => m[0])
  const extentTag = extentTags[extentTags.length - 1] ?? ''
  const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
  const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
  const extent = Number.isFinite(extCx) && Number.isFinite(extCy) ? [extCx, extCy] : undefined
  const widthPx = extent ? Math.round(extent[0] / EMU_PER_PX) : 0
  const heightPx = extent ? Math.round(extent[1] / EMU_PER_PX) : 0
  if (!widthPx || !heightPx) return null
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(await file.async('string')) as XNode[]
  } catch {
    return null
  }
  // picture fills resolve through the drawing part's own rels (../media/...)
  const relsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const rels = await parseRels(ctx.zip, relsPath)
  const mediaOf = async (rId: string): Promise<string | null> => {
    const rel = rels.get(rId)
    if (!rel || rel.targetMode === 'External') return null
    const path = resolveRelationshipTargetPath(drawingPath, rel.target)
    if (!path) return null
    const f = ctx.zip.file(path)
    if (!f) return null
    const mime = await imagePartMime(ctx.zip, path)
    if (!mime) return null
    if (isMetafileMime(mime)) return metafileToDataUrl(await f.async('arraybuffer'), mime)
    return inlineMediaDataUrl(f, mime)
  }
  const sps: XNode[] = []
  collectNodes(parsed, 'dsp:sp', sps)
  const shapes: DiagramShape[] = []
  for (const sp of sps) {
    const spPr = findChild(sp, 'dsp:spPr')
    if (!spPr) continue
    const xfrm = findChild(spPr, 'a:xfrm')
    const off = xfrm ? findChild(xfrm, 'a:off') : undefined
    const ext = xfrm ? findChild(xfrm, 'a:ext') : undefined
    if (!off || !ext) continue
    const shape: DiagramShape = {
      xPx: Math.round(parseInt(attrsOf(off)['x'] ?? '0', 10) / EMU_PER_PX),
      yPx: Math.round(parseInt(attrsOf(off)['y'] ?? '0', 10) / EMU_PER_PX),
      wPx: Math.round(parseInt(attrsOf(ext)['cx'] ?? '0', 10) / EMU_PER_PX),
      hPx: Math.round(parseInt(attrsOf(ext)['cy'] ?? '0', 10) / EMU_PER_PX),
    }
    const prst = attrsOf(findChild(spPr, 'a:prstGeom') ?? {})['prst']
    if (prst) shape.prst = prst
    // connectors carry cy="0"/cx="0"; only they may be zero-extent
    const isLine = prst === 'line' || (prst?.includes('Connector') ?? false)
    if ((shape.wPx <= 0 || shape.hPx <= 0) && !(isLine && (shape.wPx > 0 || shape.hPx > 0)))
      continue
    const rot = parseInt(attrsOf(xfrm!)['rot'] ?? '', 10)
    if (Number.isFinite(rot) && rot !== 0) shape.rotDeg = Math.round(rot / 60000)
    const ln = findChild(spPr, 'a:ln')
    if (ln && !findChild(ln, 'a:noFill')) {
      const lnHex = colorNodeHex(findChild(ln, 'a:solidFill'), ctx.themeColors)
      if (lnHex) {
        shape.lnHex = lnHex
        const w = parseInt(attrsOf(ln)['w'] ?? '', 10)
        shape.lnWPx = Number.isFinite(w) && w > 0 ? Math.max(1, Math.round(w / EMU_PER_PX)) : 1
      }
    }
    const blipFill = findChild(spPr, 'a:blipFill')
    if (blipFill) {
      const rId = attrsOf(findChild(blipFill, 'a:blip') ?? {})['r:embed']
      const dataUrl = rId ? await mediaOf(rId) : null
      if (dataUrl) {
        shape.imageDataUrl = dataUrl
        const fr = /<a:fillRect\s[^>]*\/>/.exec(serializeXNode(blipFill))?.[0]
        if (fr) {
          const rect = {
            l: rectFrac(fr, 'l'),
            t: rectFrac(fr, 't'),
            r: rectFrac(fr, 'r'),
            b: rectFrac(fr, 'b'),
          }
          if (rect.l || rect.t || rect.r || rect.b) shape.fillRect = rect
        }
      }
    } else {
      const solid = findChild(spPr, 'a:solidFill')
      const srgb = solid ? attrsOf(findChild(solid, 'a:srgbClr') ?? {})['val'] : undefined
      const scheme = solid ? attrsOf(findChild(solid, 'a:schemeClr') ?? {})['val'] : undefined
      if (srgb) shape.fillHex = srgb
      else if (scheme) {
        const theme = ctx.themeColors as Record<string, string> | null | undefined
        shape.fillHex = (theme && theme[scheme]) || '9AB5E4'
      }
    }
    const body = findChild(sp, 'dsp:txBody')
    if (body) {
      const texts: string[] = []
      let sizePt: number | undefined
      let color: string | undefined
      for (const p of findChildren(body, 'a:p')) {
        const parts: string[] = []
        for (const r of findChildren(p, 'a:r')) {
          const t = findChild(r, 'a:t')
          if (t) parts.push(decodeNumericCharRefs(textOf(t)))
          const rPr = findChild(r, 'a:rPr')
          if (rPr && sizePt === undefined) {
            const sz = parseInt(attrsOf(rPr)['sz'] ?? '', 10)
            if (Number.isFinite(sz) && sz > 0) sizePt = Math.round(sz / 100)
            const fill = findChild(rPr, 'a:solidFill')
            const c = fill ? attrsOf(findChild(fill, 'a:srgbClr') ?? {})['val'] : undefined
            if (c) color = c
          }
        }
        if (parts.join('').trim() !== '') texts.push(parts.join(''))
      }
      if (texts.length > 0) {
        shape.texts = texts
        if (sizePt) shape.fontSizePt = sizePt
        if (color) shape.textColorHex = color
      }
    }
    shapes.push(shape)
  }
  return shapes.length > 0 ? { widthPx, heightPx, shapes } : null
}

/**
 * OLE embed degrade: the original packages a preview picture
 * (v:imagedata) and declares its kind (o:OLEObject ProgID) — surface both
 * instead of a bare type label.
 */
async function oleDisplay(
  xml: string,
  ctx: BuildContext,
): Promise<
  Pick<Block, 'imageDataUrl' | 'oleProgId' | 'imageWidthPx' | 'imageHeightPx' | 'imageAlign'>
> {
  const out: Pick<
    Block,
    'imageDataUrl' | 'oleProgId' | 'imageWidthPx' | 'imageHeightPx' | 'imageAlign'
  > = {}
  const progId = /<o:OLEObject[^>]*ProgID="([^"]+)"/.exec(xml)?.[1]
  if (progId) out.oleProgId = progId
  const path = relPartPath(ctx, /<v:imagedata[^>]*r:id="([^"]+)"/.exec(xml)?.[1])
  const file = path ? ctx.zip.file(path) : null
  if (file && path) {
    const mime = await imagePartMime(ctx.zip, path)
    if (isMetafileMime(mime)) {
      const converted = await metafileToDataUrl(await file.async('arraybuffer'), mime)
      if (converted) out.imageDataUrl = converted
    } else if (mime) {
      out.imageDataUrl = await inlineMediaDataUrl(file, mime)
    }
  }
  // Word draws the preview at the declared size — v:shape style (pt), falling
  // back to w:object dxaOrig/dyaOrig (twips). Without it the metafile preview's
  // intrinsic pixels (2x dpiScale) blow up to the full content width.
  const style = /<v:shape [^>]*style="([^"]*)"/.exec(xml)?.[1] ?? ''
  const wPt = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? '')
  const hPt = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? '')
  const objAttrs = /<w:object\b[^>]*>/.exec(xml)?.[0] ?? ''
  const wTw = parseInt(/w:dxaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? '', 10)
  const hTw = parseInt(/w:dyaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? '', 10)
  const w = wPt > 0 ? (wPt / 72) * 96 : wTw > 0 ? wTw / 15 : 0
  const h = hPt > 0 ? (hPt / 72) * 96 : hTw > 0 ? hTw / 15 : 0
  if (w > 0) out.imageWidthPx = Math.round(w)
  if (h > 0) out.imageHeightPx = Math.round(h)
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1]
  if (jc === 'center') out.imageAlign = 'center'
  else if (jc === 'right' || jc === 'end') out.imageAlign = 'right'
  return out
}

/**
 * Load and parse the chart part referenced by a chart drawing paragraph.
 * The part's original XML is kept in ctx.chartParts so data edits can be
 * patched into it at save time (the body paragraph itself never changes).
 */
async function extractChart(xml: string, ctx: BuildContext): Promise<ChartDisplay | null> {
  const rId = /<cx?:chart [^>]*r:id="([^"]+)"/.exec(xml)?.[1]
  const rel = rId ? ctx.rels.get(rId) : undefined
  if (!rel || rel.targetMode === 'External') return null
  const path = resolveRelationshipTargetPath(ctx.sourcePath ?? 'word/document.xml', rel.target)
  if (!path) return null
  const file = ctx.zip.file(path)
  if (!file) return null
  const partXml = await file.async('string')
  const display = parseChartPartXml(partXml, path, ctx.themeColors)
  if (display) {
    // chartex (cx:) parts are display-only degrades: the data-edit patcher
    // speaks classic c: syntax, so keeping them out makes edits no-ops
    // instead of corruption
    if (!partXml.includes('<cx:chartSpace')) ctx.chartParts[path] = partXml
    const extentTag = /<wp:extent[^>]*\/?>/.exec(xml)?.[0] ?? ''
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
    if (Number.isFinite(cx) && cx > 0) display.widthPx = Math.round(cx / EMU_PER_PX)
    if (Number.isFinite(cy) && cy > 0) display.heightPx = Math.round(cy / EMU_PER_PX)
  }
  return display
}
