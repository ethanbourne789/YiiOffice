// Paragraph/run construction: the editable run model (extractRuns/buildRun),
// paragraph format + frames, character indents, field-result folding and the
// buildTextParagraph entry used by buildBlock.

import { ommlFragmentsOf } from './math'
import { decodeSymbolText, symbolGlyph } from './symbol-fonts'
import {
  type Block,
  type FieldRun,
  type ParaFormat,
  type ParaFrame,
  type ParaFrameBox,
  type RevisionInfo,
  type Run,
  type SectionSettings,
  type StyleInfo,
  type ThemeColors,
  type ThemeFonts,
} from './types'
import {
  attrsOf,
  boolProp,
  childrenOf,
  findChild,
  nameOf,
  serializeXNode,
  textOf,
  textHasComplexScript,
  underlineProp,
  xmlParser,
  type XNode,
} from './xml-utils'
import { eqFieldToOmml } from './eq-field'
import {
  fieldDisplayOf,
  fieldLabel,
  fieldStackAfter,
  markInsideFieldCode,
  tagAttr,
} from './parse-fields'
import {
  EMU_PER_PX,
  autoColorOf,
  colorFrom,
  decodeNumericCharRefs,
  lineTwipsOf,
  mathTokens,
  onOffOf,
  plainText,
  stripHash,
} from './parse-xml-text'
import {
  EMU_PER_TWIP,
  MIN_WRAP_SLIVER_EMU,
  w14GlowOf,
  w14TextFillHex,
  w14TextOutlineOf,
} from './parse-drawing-geometry'
import {
  IMAGE_RUN_CHILDREN,
  JC_ALIGN,
  SIMPLE_INLINE_FIELD_RE,
  activeCharIndents,
  autoSpaceOf,
  bookmarkNamesOf,
  charIndentsOf,
  checkboxStateOf,
  convertibleHyperlink,
  crossParaCommentMarkers,
  emptyParaMarkFont,
  emptyParaSizeHalfPoints,
  hasLayoutRunContent,
  spaceOnlyRuns,
  breakOnlyRuns,
  LAYOUT_RUN_CONTENT_BESIDES_BREAKS,
  indentTwipsOf,
  mergeCharIndents,
  mergeRuns,
  paraBorderSidesOf,
  paraBordersOf,
  ptabDisplayStops,
  rawPPrOf,
  resolveCharIndents,
  type CharUnits,
  rubyFragmentsOf,
  rubyPartText,
  shdDisplayFill,
  splitImageRun,
  splitSymRun,
  staysVanished,
  stripTextboxes,
  tabStopsOf,
  themedRFonts,
} from './parse-props'
import { sdtCheckboxControl } from './checkbox-control'
import {
  defaultParaVanish,
  headingLevelOf,
  inheritStyleBreakFlags,
  inheritStyleTabStops,
  inheritedCsFont,
  normalSizeHalfPoints,
  outlineOnlyHeading,
  paraTextSizeHalfPoints,
  runBorderOf,
} from './parse-styles'
import { vmlRotationDeg, vmlShapeSvg } from './parse-vml'
import { type BuildContext, emuToPx } from './parse-shared'
import { listKindOf, listRefOf } from './parse-numbering'
import {
  imageMeta,
  picBorderOf,
  picTransformOf,
  type ImageMeta,
} from './parse-images'


/** w:br w:type → run-text control char (\f page, \v column; else soft \n) */
const BREAK_CHAR: Record<string, string> = { page: '\f', column: '\v' }

/** a w:br that clears floats (Word's Text Wrapping break) travels as \u001e */
function breakCharOf(attrs: Record<string, string | undefined>): string {
  if (attrs['w:clear']) return '\u001e'
  return BREAK_CHAR[attrs['w:type'] ?? ''] ?? '\n'
}

function charUnitsOf(
  ctx: BuildContext,
  runs: Run[],
  pNode: XNode,
  pPr: XNode | undefined,
  styleId: string | undefined,
  docOffset: number | undefined,
): CharUnits {
  const grid = docOffset !== undefined ? ctx.sectionAt?.(docOffset).docGrid : undefined
  const gridDelta =
    grid?.type === 'linesAndChars' && grid.charSpace ? (grid.charSpace / 4096) * 20 : 0
  const normal = normalSizeHalfPoints(ctx)
  const first = runs.find((r) => r.text !== '')
  const run = paraTextSizeHalfPoints(ctx, runs, pNode, pPr, styleId)
  return {
    run: run * 10 + (first?.charSpacingTwips ?? 0) + gridDelta,
    normal: normal * 10 + gridDelta,
  }
}

/**
 * Fold a paragraph's character-unit indents (the ones its style chain declares,
 * layered under the direct w:ind *Chars attributes) into the format's twips
 * fields. Only a *Chars attribute — an explicit zero included — replaces a
 * style's character indent; a direct twips w:firstLine / w:left leaves it in
 * force (probed: Word lays a style firstLineChars paragraph with a direct
 * w:firstLine="420" at two characters). Style character indents stay off list
 * items, like the style-indent CSS: numbering owns their indent.
 */
export function withCharIndents(
  format: ParaFormat | undefined,
  ctx: BuildContext,
  pNode: XNode,
  pPr: XNode | undefined,
  styleId: string | undefined,
  runs: Run[],
  opts: { list: boolean; docOffset?: number },
): ParaFormat | undefined {
  const direct = charIndentsOf(pPr ? findChild(pPr, 'w:ind') : undefined)
  const style = opts.list
    ? undefined
    : (styleId ? ctx.styles.get(styleId) : ctx.defaultParaStyle)?.display?.indentChars
  const chars = activeCharIndents(mergeCharIndents(style, direct))
  if (!chars) return format
  return {
    ...resolveCharIndents(
      format,
      chars,
      charUnitsOf(ctx, runs, pNode, pPr, styleId, opts.docOffset),
    ),
    // the save path cancels these when it rebuilds w:ind in twips
    charIndents: chars,
    // the editor's direct-formatting mirror: only what the paragraph's own
    // w:ind declares (an indent the style chain provides must not become
    // direct formatting on a round trip)
    ...(direct ? { directCharIndents: direct } : {}),
  }
}

/**
 * Side-wrapped picture sharing its anchor paragraph's column with a floating
 * table: when the widest remaining gap is a sliver no text fits beside them,
 * so Word resumes the text below both instead of stacking the picture under
 * the table (which is where a CSS float that cannot sit beside it would land).
 */
/** column-relative X extent (EMU) of a side-wrapped anchored picture in a single-column section */
function pictureColumnGeom(
  meta: ImageMeta,
  xml: string,
  sect: SectionSettings | undefined,
): { x: number; right: number; distL: number; distR: number; colWEmu: number } | null {
  if (!sect || sect.columns > 1) return null
  if (!/^(?:square|tight|through)-/.test(meta.imageWrap ?? '')) return null
  if (meta.imageOffsetXEmu === undefined || !meta.imageWidthPx) return null
  const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP
  const fromPage = /<wp:positionH[^>]*relativeFrom="page"/.test(xml)
  const x = meta.imageOffsetXEmu - (fromPage ? sect.marginLeft * EMU_PER_TWIP : 0)
  return {
    x,
    right: x + meta.imageWidthPx * EMU_PER_PX,
    distL: meta.imageWrapDistLeftEmu ?? 0,
    distR: meta.imageWrapDistRightEmu ?? 0,
    colWEmu,
  }
}

export function pictureBesideFloatTable(
  meta: ImageMeta,
  xml: string,
  table: { leftTwips: number; rightTwips: number },
  sect: SectionSettings | undefined,
): boolean {
  const geo = pictureColumnGeom(meta, xml, sect)
  if (!geo) return false
  const colWEmu = geo.colWEmu
  const picture: [number, number] = [geo.x - geo.distL, geo.right + geo.distR]
  const tbl: [number, number] = [table.leftTwips * EMU_PER_TWIP, table.rightTwips * EMU_PER_TWIP]
  const spans = [tbl, picture].sort((a, b) => a[0] - b[0])
  let gap = 0
  let cursor = 0
  for (const [a, b] of spans) {
    gap = Math.max(gap, a - cursor)
    cursor = Math.max(cursor, b)
  }
  return Math.max(gap, colWEmu - cursor) < MIN_WRAP_SLIVER_EMU
}

/** picture reaching past a column edge with no text room left beside it (cover
 *  art pinned to the paper): a CSS float would cap it at the column, so it takes
 *  the band route and keeps its extent */
export function pictureOverhangsColumn(
  meta: ImageMeta,
  xml: string,
  sect: SectionSettings | undefined,
): boolean {
  const geo = pictureColumnGeom(meta, xml, sect)
  if (!geo || (geo.x >= 0 && geo.right <= geo.colWEmu)) return false
  return Math.max(geo.x - geo.distL, geo.colWEmu - geo.right - geo.distR) < MIN_WRAP_SLIVER_EMU
}

/** stroke of a VML horizontal rule (<v:rect o:hr="t"> opening tag) */
function vmlHrRule(hrRect: string): NonNullable<NonNullable<Run['image']>['rule']> {
  const fill = /fillcolor="#?([0-9A-Fa-f]{6})"/.exec(hrRect)?.[1]
  const hPt = parseFloat(/height:([\d.]+)pt/.exec(hrRect)?.[1] ?? '')
  // width:0 means "fill the available width"
  const wPt = parseFloat(/width:([\d.]+)pt/.exec(hrRect)?.[1] ?? '')
  const align = /o:hralign="(center|right)"/.exec(hrRect)?.[1] as 'center' | 'right' | undefined
  return {
    ...(fill ? { colorHex: fill.toUpperCase() } : {}),
    ...(hPt > 0 ? { thicknessPx: Math.max(1, Math.round((hPt / 72) * 96)) } : {}),
    ...(wPt > 0 ? { widthPx: Math.round((wPt / 72) * 96) } : {}),
    ...(wPt > 0 && align ? { align } : {}),
  }
}

export function buildTextParagraph(
  base: Pick<Block, 'id' | 'docxIndex' | 'originalXml'>,
  xml: string,
  ctx: BuildContext,
  withImages = false,
  docOffset?: number,
): Block {
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(xml) as XNode[]
  } catch {
    // unparseable paragraph (e.g. pathological nesting): keep the original bytes
    return { ...base, type: 'passthrough', label: 'Paragraph', previewText: plainText(xml) }
  }
  const pNode = parsed.find((n) => nameOf(n) === 'w:p')
  if (!pNode) {
    return { ...base, type: 'passthrough', label: 'Unknown paragraph', previewText: plainText(xml) }
  }

  const pPr = findChild(pNode, 'w:pPr')
  const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
  // whole paragraph hidden by style-level w:vanish (z-TopofForm/z-BottomofForm HTML
  // form markers): Word shows nothing; keep the original bytes at their body position
  if (styleId && ctx.styles.get(styleId)?.display?.vanish === true && staysVanished(xml)) {
    return { ...base, type: 'passthrough', label: 'Hidden paragraph', invisibleMarker: true }
  }
  // style-less paragraph under a vanish-carrying default paragraph style: the
  // mark inherits hidden, so Word gives the line no height (real_run2/93's
  // trailing paragraph pushed a phantom second page)
  if (!styleId && defaultParaVanish(ctx.styles) === true && staysVanished(xml)) {
    return { ...base, type: 'passthrough', label: 'Hidden paragraph', invisibleMarker: true }
  }
  // empty paragraph whose mark is hidden by direct w:vanish (label/card
  // templates end on one): Word gives it no height — rendering it as a normal
  // empty line can push a trailing blank page
  const markRPr = pPr ? findChild(pPr, 'w:rPr') : undefined
  if (
    markRPr &&
    onOffOf(markRPr, 'w:vanish') === true &&
    onOffOf(markRPr, 'w:specVanish') !== true &&
    plainText(xml).trim() === '' &&
    staysVanished(xml) &&
    !hasLayoutRunContent(pNode)
  ) {
    return { ...base, type: 'passthrough', label: 'Hidden paragraph', invisibleMarker: true }
  }
  const paraStyle = styleId ? ctx.styles.get(styleId) : ctx.defaultParaStyle
  let format = pPr ? extractParaFormat(pPr, ctx.themeColors, paraStyle?.display?.bidi) : undefined
  format = inheritStyleBreakFlags(format, paraStyle)
  format = inheritStyleTabStops(format, paraStyle)
  const rawPPr = rawPPrOf(xml)
  // inline math: raw <m:oMath> fragments in document order, aligned with the
  // walk below (strip fallback/textbox copies so indexes match visited nodes)
  const mathXml = stripTextboxes(
    xml.includes('<mc:Fallback')
      ? xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
      : xml,
  )
  const runs = extractRuns(
    pNode,
    ctx,
    ommlFragmentsOf(mathXml),
    rubyFragmentsOf(mathXml),
    withImages,
  )
  const spaceOnly = runs.length > 0 && spaceOnlyRuns(runs) && !hasLayoutRunContent(pNode)
  // a paragraph holding only page/column breaks lays its break line like an
  // empty one: by the mark's face and size, else the break run's
  const breakOnly =
    runs.length > 0 &&
    breakOnlyRuns(runs) &&
    !hasLayoutRunContent(pNode, LAYOUT_RUN_CONTENT_BESIDES_BREAKS)
  if (runs.length === 0 || spaceOnly || breakOnly) {
    const emptySz = emptyParaSizeHalfPoints(pNode, pPr, spaceOnly)
    if (emptySz) format = { ...(format ?? {}), emptyRunSizeHalfPoints: emptySz }
    const emptyFont = emptyParaMarkFont(pNode, pPr, ctx.themeFonts, spaceOnly)
    if (emptyFont) format = { ...(format ?? {}), emptyRunFontFamily: emptyFont }
  }

  // w:ptab absolute-position tabs (TOC dot leaders to the right margin): the run
  // text carries them as '\t'; surface each as a display-only margin-relative
  // stop so the renderer can align at the column center/edge and draw the leader
  const ptabStops = ptabDisplayStops(pNode)
  if (ptabStops.length > 0) {
    const stops = format?.tabStops ? [...format.tabStops] : []
    for (const st of ptabStops) {
      if (!stops.some((s) => s.rel === 'margin' && s.pos === st.pos)) stops.push(st)
    }
    format = { ...(format ?? {}), tabStops: stops }
  }

  // allowOverlap="0" colliding with a sibling anchor (tdf#134114): Word displaces
  // the object out of the other's box instead of stacking the wrapped floats
  // vertically; approximate with a front overlay at the collider's bottom (it may
  // hang into the margin, like Word). Horizontal overlap is presumed — the align
  // gallery drops the X, so only the declared vertical ranges are compared.
  {
    const wrapped = runs.filter(
      (r) => r.image?.wrap && r.image.wrap !== 'front' && r.image.wrap !== 'behind',
    )
    if (wrapped.length > 1) {
      for (const r of wrapped) {
        const img = r.image!
        if (!img.noOverlap) continue
        const top = (img.offsetYEmu ?? 0) / EMU_PER_PX
        const hit = wrapped.find((o) => {
          if (o === r || o.image!.noOverlap) return false
          const oTop = (o.image!.offsetYEmu ?? 0) / EMU_PER_PX
          return top < oTop + (o.image!.heightPx ?? 0) && oTop < top + (img.heightPx ?? 0)
        })
        if (!hit) continue
        img.wrap = 'front'
        img.offsetXEmu = 0
        // the collider float renders at its line top (run floats ignore posOffset)
        img.offsetYEmu = Math.round(((hit.image!.heightPx ?? 0) + 2) * EMU_PER_PX)
      }
    }
  }
  const { bookmarks, hiddenBookmarks } = bookmarkNamesOf(stripTextboxes(xml))
  const { commentStarts, commentEnds } = crossParaCommentMarkers(stripTextboxes(xml))

  // --- move revision detection ---
  // A paragraph with moveFrom/moveTo at run level gets a block-level marker
  // for visual styling (strikethrough+red bg for moveFrom, green bg for moveTo).
  let moveRevision: 'from' | 'to' | undefined
  if (/<w:moveFrom[\s/>]/.test(xml)) moveRevision = 'from'
  else if (/<w:moveTo[\s/>]/.test(xml)) moveRevision = 'to'

  // --- pPrChange info extraction ---
  // When the paragraph has a pPrChange (tracked format change), extract the
  // revision author/date/id for the review badge and navigation.
  let pPrChangeInfo: Block['pPrChangeInfo']
  if (pPr) {
    const pPrChangeEl = findChild(pPr, 'w:pPrChange')
    if (pPrChangeEl) {
      const attrs = attrsOf(pPrChangeEl)
      pPrChangeInfo = { author: attrs['w:author'] ?? '' }
      if (attrs['w:date']) pPrChangeInfo.date = attrs['w:date']
      if (attrs['w:id']) pPrChangeInfo.id = attrs['w:id']
      const oldPPr = findChild(pPrChangeEl, 'w:pPr')
      if (oldPPr) {
        const old: NonNullable<NonNullable<Block['pPrChangeInfo']>['old']> = {
          ...(extractParaFormat(oldPPr) ?? {}),
        }
        const oldStyleId = attrsOf(findChild(oldPPr, 'w:pStyle') ?? {})['w:val']
        if (oldStyleId) old.styleId = oldStyleId
        const oldNumPr = findChild(oldPPr, 'w:numPr')
        const oldNumId = oldNumPr
          ? attrsOf(findChild(oldNumPr, 'w:numId') ?? {})['w:val']
          : undefined
        if (oldNumId) {
          old.type = 'docListItem'
          old.numId = oldNumId
          old.ilvl =
            parseInt(attrsOf(findChild(oldNumPr!, 'w:ilvl') ?? {})['w:val'] ?? '0', 10) || 0
          old.kind = listKindOf(ctx, oldNumId, old.ilvl)
        } else {
          const oldLevel = headingLevelOf(oldPPr, oldStyleId, ctx)
          if (oldLevel) {
            old.type = 'docHeading'
            old.level = oldLevel
          } else if (oldStyleId) {
            old.type = 'docParagraph'
          }
        }
        if (old && Object.keys(old).length > 0) pPrChangeInfo.old = old
      }
    }
  }

  // --- deleted paragraph mark (w:pPr/w:rPr/w:del) ---
  let paraMarkDel: Block['paraMarkDel']
  {
    const pRPr = pPr ? findChild(pPr, 'w:rPr') : undefined
    const delEl = pRPr ? findChild(pRPr, 'w:del') : undefined
    if (delEl) {
      const a = attrsOf(delEl)
      paraMarkDel = { author: a['w:author'] ?? '' }
      if (a['w:date']) paraMarkDel.date = a['w:date']
      if (a['w:id']) paraMarkDel.id = a['w:id']
    }
  }

  // list item?
  const listRef = listRefOf(ctx, pPr, styleId)
  format = withCharIndents(format, ctx, pNode, pPr, styleId, runs, { list: !!listRef, docOffset })
  const markSz = listRef ? emptyParaSizeHalfPoints(pNode, pPr, true) : undefined
  if (markSz) format = { ...(format ?? {}), markSizeHalfPoints: markSz }
  /** extra revision fields shared across all return paths */
  const revExtras = {
    ...(moveRevision ? { moveRevision } : {}),
    ...(pPrChangeInfo ? { pPrChangeInfo } : {}),
    ...(paraMarkDel ? { paraMarkDel } : {}),
  }
  if (listRef) {
    const kind = listKindOf(ctx, listRef.numId, listRef.ilvl)
    return {
      ...base,
      type: 'listItem',
      styleId,
      list: { kind, numId: listRef.numId, ilvl: listRef.ilvl },
      format,
      rawPPr,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs,
      ...revExtras,
    }
  }

  // heading?
  const headingLevel = headingLevelOf(pPr, styleId, ctx)
  if (headingLevel) {
    return {
      ...base,
      type: 'heading',
      level: headingLevel,
      ...(outlineOnlyHeading(pPr, styleId, ctx) ? { outlineOnly: true } : {}),
      styleId,
      format,
      rawPPr,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs,
      ...revExtras,
    }
  }

  return {
    ...base,
    type: 'paragraph',
    styleId,
    format,
    rawPPr,
    bookmarks,
    hiddenBookmarks,
    commentStarts,
    commentEnds,
    runs,
    ...revExtras,
  }
}

/**
 * The paragraph's own empty line: Word keeps it beside a side-wrapped picture
 * (or under an invisible pict) and sizes it by the paragraph mark alone — the
 * anchored drawing run's w:sz does not count.
 */
export function anchorLineOf(xml: string): Block['anchorLine'] {
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(xml) as XNode[]
  } catch {
    return undefined
  }
  const pNode = parsed.find((n) => nameOf(n) === 'w:p')
  if (!pNode) return undefined
  const pPr = findChild(pNode, 'w:pPr')
  const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
  let format = pPr ? extractParaFormat(pPr) : undefined
  const sz = parseInt(
    (pPr && attrsOf(findChild(findChild(pPr, 'w:rPr') ?? {}, 'w:sz') ?? {})['w:val']) ?? '',
    10,
  )
  if (Number.isFinite(sz) && sz > 0) format = { ...(format ?? {}), emptyRunSizeHalfPoints: sz }
  const clear = /<w:br\b[^>]*\bw:clear="(all|left|right)"/.exec(xml)?.[1] as
    'all' | 'left' | 'right' | undefined
  return {
    ...(styleId ? { styleId } : {}),
    ...(format ? { format } : {}),
    ...(clear ? { clear } : {}),
  }
}

/** anchor line of a stray textbox paragraph with the style chain's tab stops
 *  merged in (direct stops win per position, w:val=clear removes) — the
 *  display-only stray line has no style lookup of its own */
export function strayAnchorLine(xml: string, ctx: BuildContext): Block['anchorLine'] {
  const line = anchorLineOf(xml)
  const style = line?.styleId ? ctx.styles.get(line.styleId)?.display : undefined
  if (!line || !style) return line
  const format = { ...(line.format ?? {}) }
  const styleStops = style.tabStops ?? []
  if (styleStops.length) {
    const direct = format.tabStops ?? []
    format.tabStops = [
      ...styleStops.filter((t) => !direct.some((d) => d.pos === t.pos)),
      ...direct.filter((t) => t.val !== 'clear'),
    ]
  }
  // stops are margin-relative: the tab grid needs the effective left indent,
  // style-inherited included
  if (format.indentLeft === undefined && style.indentLeftTwips !== undefined)
    format.indentLeft = style.indentLeftTwips
  return { ...line, format }
}

/** w:framePr sized frame (not a drop cap): the box Word lays the paragraph out in */
function frameBoxOf(pPr: XNode): ParaFrameBox | undefined {
  const framePr = findChild(pPr, 'w:framePr')
  if (!framePr) return undefined
  const a = attrsOf(framePr)
  if (a['w:dropCap']) return undefined
  const twips = (name: string): number | undefined => {
    const v = parseInt(a[name] ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const out: ParaFrameBox = {}
  const w = twips('w:w')
  const h = twips('w:h')
  if (w) out.wTwips = w
  if (h) {
    out.hTwips = h
    if (a['w:hRule'] === 'exact') out.hRule = 'exact'
  }
  if (!w && !h) return undefined
  const hSpace = twips('w:hSpace')
  const vSpace = twips('w:vSpace')
  if (hSpace) out.hSpaceTwips = hSpace
  if (vSpace) out.vSpaceTwips = vSpace
  // the frame keeps the paragraph's own flow position only when anchored to
  // the text; page/margin frames carry absolute offsets this does not place
  if (a['w:vAnchor'] === 'text' && /^(around|auto|through|tight)$/.test(a['w:wrap'] ?? '')) {
    out.floatSide = a['w:xAlign'] === 'right' || a['w:xAlign'] === 'outside' ? 'right' : 'left'
  }
  return out
}

/** @param styleBidi w:bidi of the paragraph's style chain (only the direct flag is modeled) */
export function extractParaFormat(
  pPr: XNode,
  theme?: ThemeColors | null,
  styleBidi?: boolean,
): ParaFormat | undefined {
  const format: ParaFormat = {}
  const bidiOwn = onOffOf(pPr, 'w:bidi')
  if (bidiOwn) format.bidi = true
  const jc = attrsOf(findChild(pPr, 'w:jc') ?? {})['w:val']
  if (jc && JC_ALIGN[jc]) format.align = JC_ALIGN[jc]
  // Word quirk: in bidi paragraphs w:jc left/right are logical values (start/end); convert to visual direction
  if ((bidiOwn ?? styleBidi) && (format.align === 'left' || format.align === 'right')) {
    format.align = format.align === 'left' ? 'right' : 'left'
  }
  const spacing = findChild(pPr, 'w:spacing')
  if (spacing) {
    const attrs = attrsOf(spacing)
    const rule = (attrs['w:lineRule'] ?? 'auto') as 'auto' | 'atLeast' | 'exact'
    const line = lineTwipsOf(attrs['w:line'])
    if (line > 0) {
      format.lineRawTwips = line
      if (rule === 'auto') {
        format.lineSpacing = Math.round((line / 240) * 100) / 100
        format.lineRule = 'auto'
      } else {
        format.lineRule = rule
        // lineSpacing in 'auto' sense is not applicable for atLeast/exact, keep undefined
      }
    } else if (line === 0 && rule === 'atLeast') {
      // w:line="0" atLeast: layout no-op (natural line height) BUT it opts the
      // paragraph out of docGrid snapping (LO probe); keep the rule so the
      // renderer can tell it apart from an undeclared (snapping) paragraph
      format.lineRule = 'atLeast'
      format.lineRawTwips = 0
    }
    // autospacing=1: Word ignores the literal and uses its HTML auto value (14pt,
    // measured font-size independent; adjacent auto margins collapse, and they
    // collapse to 0 between two list items — the renderer applies those rules).
    // Tri-state: an explicit "0" overrides a style-chain auto. The literal is
    // still modeled so unchanged spacing round-trips byte-for-byte.
    const autoOf = (v: string | undefined): boolean | undefined =>
      v === undefined ? undefined : v === '1' || v === 'true'
    const autoBefore = autoOf(attrs['w:beforeAutospacing'])
    if (autoBefore !== undefined) format.spaceBeforeAuto = autoBefore
    const autoAfter = autoOf(attrs['w:afterAutospacing'])
    if (autoAfter !== undefined) format.spaceAfterAuto = autoAfter
    const before = parseInt(attrs['w:before'] ?? '', 10)
    if (before >= 0 && attrs['w:before'] !== undefined) format.spaceBefore = before
    const after = parseInt(attrs['w:after'] ?? '', 10)
    if (after >= 0 && attrs['w:after'] !== undefined) format.spaceAfter = after
  }
  const ind = findChild(pPr, 'w:ind')
  if (ind) {
    const { left, right, firstLine } = indentTwipsOf(ind)
    if (left !== undefined) format.indentLeft = left
    if (right !== undefined) format.indentRight = right
    if (firstLine !== undefined) format.indentFirstLine = firstLine
  }
  {
    // tri-state: an explicit w:val="0" must override a style-chain true
    const pbb = onOffOf(pPr, 'w:pageBreakBefore')
    if (pbb !== undefined) format.pageBreakBefore = pbb
    const kn = onOffOf(pPr, 'w:keepNext')
    if (kn !== undefined) format.keepNext = kn
    const kl = onOffOf(pPr, 'w:keepLines')
    if (kl !== undefined) format.keepLines = kl
    const sln = onOffOf(pPr, 'w:suppressLineNumbers')
    if (sln !== undefined) format.suppressLineNumbers = sln
  }
  // snapToGrid: default ON; only store when explicitly set to OFF
  const snapEl = findChild(pPr, 'w:snapToGrid')
  if (snapEl) {
    const v = attrsOf(snapEl)['w:val']
    if (v === '0' || v === 'false') format.snapToGrid = false
  }
  // widowControl: Word default is ON; tri-state so an explicit on overrides a
  // style chain that turns it off
  const wc = onOffOf(pPr, 'w:widowControl')
  if (wc !== undefined) format.widowControl = wc
  {
    // tri-state: an explicit w:val="0" must override a style-chain true (Word
    // honors the direct spacing again — deliberate blank-page/-1-page driver)
    const ctx = onOffOf(pPr, 'w:contextualSpacing')
    if (ctx !== undefined) format.contextualSpacing = ctx
  }
  const autoSpace = autoSpaceOf(pPr)
  if (autoSpace !== undefined) format.autoSpace = autoSpace
  const wordWrap = onOffOf(pPr, 'w:wordWrap')
  if (wordWrap !== undefined) format.wordWrap = wordWrap
  const overflowPunct = onOffOf(pPr, 'w:overflowPunct')
  if (overflowPunct !== undefined) format.overflowPunct = overflowPunct
  const shd = findChild(pPr, 'w:shd')
  if (shd) {
    const fill = attrsOf(shd)['w:fill']
    if (fill && fill !== 'auto') format.shadingFill = stripHash(fill)
    // pattern shading (pctNN/stripes): white 20pt text on w:shd pct70 was
    // invisible with the fill-only read (real_run2/61 Font Cascade)
    const display = shdDisplayFill(shd, theme)
    if (display && display !== format.shadingFill) format.shadingDisplay = display
    if (!display) format.shadingClear = true
  }
  const sides = paraBorderSidesOf(pPr)
  if (sides) Object.assign(format, paraBordersOf(sides))
  const stops = tabStopsOf(pPr)
  if (stops) format.tabStops = stops
  const frameBox = frameBoxOf(pPr)
  if (frameBox) format.frameBox = frameBox
  // Drop cap: w:framePr w:dropCap="drop"|"margin"
  const framePr = findChild(pPr, 'w:framePr')
  if (framePr) {
    const dropCapVal = attrsOf(framePr)['w:dropCap']
    if (dropCapVal === 'drop' || dropCapVal === 'margin') {
      const lines = parseInt(attrsOf(framePr)['w:lines'] ?? '3', 10) || 3
      format.dropCap = { type: dropCapVal as 'drop' | 'margin', lines }
    } else {
      const frame = paraFrameOf(attrsOf(framePr))
      if (frame) format.frame = frame
    }
  }
  const flow = attrsOf(findChild(pPr, 'w:textDirection') ?? {})['w:val']
  if (flow === 'tbRl' || flow === 'tbRlV' || flow === 'btLr') format.textDirection = flow
  return Object.keys(format).length > 0 ? format : undefined
}

/** positioned frame from w:framePr attributes; frames without a width are not modeled */
function paraFrameOf(a: Record<string, string>): ParaFrame | undefined {
  const num = (k: string) => {
    const n = parseInt(a[k] ?? '', 10)
    return Number.isFinite(n) ? n : undefined
  }
  const w = num('w:w')
  if (!w || w <= 0) return undefined
  const frame: ParaFrame = { wTwips: w, xTwips: num('w:x') ?? 0, yTwips: num('w:y') ?? 0 }
  const h = num('w:h')
  if (h && h > 0) {
    frame.hTwips = h
    frame.hRule = a['w:hRule'] === 'exact' ? 'exact' : 'atLeast'
  }
  const hAnchor = a['w:hAnchor']
  if (hAnchor === 'margin' || hAnchor === 'text') frame.hAnchor = hAnchor
  const vAnchor = a['w:vAnchor']
  if (vAnchor === 'margin' || vAnchor === 'text') frame.vAnchor = vAnchor
  const wrap = a['w:wrap']
  if (
    wrap === 'around' ||
    wrap === 'through' ||
    wrap === 'notBeside' ||
    wrap === 'auto' ||
    wrap === 'tight'
  )
    frame.wrap = wrap
  const hSpace = num('w:hSpace')
  if (hSpace) frame.hSpaceTwips = hSpace
  const vSpace = num('w:vSpace')
  if (vSpace) frame.vSpaceTwips = vSpace
  const xAlign = a['w:xAlign']
  if (
    xAlign === 'left' ||
    xAlign === 'center' ||
    xAlign === 'right' ||
    xAlign === 'inside' ||
    xAlign === 'outside'
  )
    frame.xAlign = xAlign
  const yAlign = a['w:yAlign']
  if (
    yAlign === 'top' ||
    yAlign === 'center' ||
    yAlign === 'bottom' ||
    yAlign === 'inside' ||
    yAlign === 'outside' ||
    yAlign === 'inline'
  )
    frame.yAlign = yAlign
  if (a['w:anchorLock'] === '1' || a['w:anchorLock'] === 'true') frame.anchorLock = true
  return frame
}

/**
 * Formatted result runs of a protected text-field paragraph (display only). The
 * field machinery is folded away by extractRuns (cached results keep their rPr,
 * so an italic journal title inside a citation stays italic). Only accepted when
 * the runs reproduce the visible text exactly: the editing commit compares the
 * rendered text against `visible`, so tabs/breaks (absent from plainText) fall
 * back to the plain string.
 */
const PARA_XML_RE = /^<w:p(?:\s[^>]*)?>([\s\S]*)<\/w:p>$/

/**
 * Paragraph marks inside field code are hidden in Word: the paragraphs show as
 * one under the last mark's properties. Blocks stay separate for saving; the
 * tail shows the joined result, the earlier ones render as nothing.
 */
export function foldFieldCodeParagraphs(blocks: Block[], ctx: BuildContext): void {
  const paraInner = (block: Block): string | null => {
    if (block.type !== 'passthrough' || block.sdtShell || block.hidden) return null
    return PARA_XML_RE.exec(block.originalXml ?? '')?.[1] ?? null
  }
  for (let i = 0; i < blocks.length; i++) {
    const headInner = paraInner(blocks[i])
    if (headInner === null) continue
    let stack = fieldStackAfter(stripTextboxes(headInner), [])
    if (!markInsideFieldCode(stack)) continue
    let end = i
    while (markInsideFieldCode(stack) && end + 1 < blocks.length) {
      const inner = paraInner(blocks[end + 1])
      if (inner === null) break
      end++
      stack = fieldStackAfter(stripTextboxes(inner), stack)
    }
    if (markInsideFieldCode(stack)) continue
    const tail = blocks[end]
    const body = blocks
      .slice(i, end + 1)
      .map((b) => paraInner(b)!.replace(/^<w:pPr>[\s\S]*?<\/w:pPr>/, ''))
      .join('')
    const pPr = /^<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paraInner(tail)!)?.[0] ?? ''
    const joined = `<w:p>${pPr}${body}</w:p>`
    const fieldDisplay = fieldDisplayOf(joined, ctx.styles)
    if (fieldDisplay?.kind === 'text') {
      const runs = fieldResultRuns(joined, ctx, fieldDisplay.left ?? '')
      if (runs) fieldDisplay.runs = runs
    }
    tail.fieldDisplay = fieldDisplay
    tail.previewText = plainText(joined)
    tail.label = fieldLabel(joined)
    for (let k = i; k < end; k++) {
      blocks[k].invisibleMarker = true
      delete blocks[k].fieldDisplay
    }
    i = end
  }
}

/** Run keys that are content or field machinery, not formatting a field result inherits */
const XE_INSTR_RE = /^\s*XE\s+(?:"([^"]*)"|(\S+))/
const REF_INSTR_RE = /^\s*REF\s+(?:"([^"]+)"|([^\s\\]+))/

const RESULT_FORMAT_SKIP = new Set([
  'text',
  'image',
  'math',
  'sym',
  'ruby',
  'noteRef',
  'xeTerm',
  'refField',
  'refInstr',
  'instrField',
  'fldBeginXml',
  'fldDirty',
  'sdtCheckboxXml',
  'commentIds',
  'ins',
  'del',
  'link',
])

export function fieldResultRuns(xml: string, ctx: BuildContext, visible: string): FieldRun[] | null {
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(stripTextboxes(xml)) as XNode[]
  } catch {
    return null
  }
  const pNode = parsed.find((n) => nameOf(n) === 'w:p')
  if (!pNode) return null
  const runs: FieldRun[] = []
  for (const r of extractRuns(pNode, ctx)) {
    if (r.text === '' || r.vanish) continue
    const run: FieldRun = { text: r.text }
    if (r.bold !== undefined) run.bold = r.bold
    if (r.italic !== undefined) run.italic = r.italic
    if (r.underline) run.underline = true
    if (r.color) run.color = r.color
    if (r.sizeHalfPoints) run.sizeHalfPoints = r.sizeHalfPoints
    if (r.font) run.font = r.font
    if (r.fontAscii) run.fontAscii = r.fontAscii
    if (r.csFont) run.csFont = r.csFont
    if (r.link) run.link = r.link
    if (r.styleId) run.styleId = r.styleId
    if (r.math) run.math = r.math
    runs.push(run)
  }
  // plainText trims the visible result: trim the run edges the same way
  while (runs.length > 0) {
    const first = runs[0]
    first.text = first.text.replace(/^\s+/, '')
    if (first.text !== '') break
    runs.shift()
  }
  while (runs.length > 0) {
    const last = runs[runs.length - 1]
    last.text = last.text.replace(/\s+$/, '')
    if (last.text !== '') break
    runs.pop()
  }
  if (runs.length === 0 || runs.map((r) => r.text).join('') !== visible) return null
  return runs
}

export function extractRuns(
  pNode: XNode,
  ctx: BuildContext,
  mathFragments: string[] = [],
  rubyFragments: string[] = [],
  withImages = false,
): Run[] {
  const runs: Run[] = []
  let mathIndex = 0
  let rubyIndex = 0
  // paragraph-style rtl inherits into runs without their own flag
  const pStyleId = attrsOf(findChild(findChild(pNode, 'w:pPr') ?? {}, 'w:pStyle') ?? {})['w:val']
  const paraRtl = pStyleId ? ctx.styles?.get(pStyleId)?.display?.rtl : undefined
  const paraBdr = pStyleId ? ctx.styles?.get(pStyleId)?.display?.bdr : undefined
  // paragraph-style hidden text (w:vanish) inherits into runs without their own
  // flag; style-less paragraphs read the default paragraph style (real_run2/93:
  // a default style carrying vanish hides every run without an explicit off)
  const paraVanish = pStyleId
    ? ctx.styles?.get(pStyleId)?.display?.vanish
    : defaultParaVanish(ctx.styles)
  // Comments are only tracked when the whole range lives inside this paragraph:
  // a regenerated paragraph can then re-emit its own markers, while ranges that
  // span paragraphs are left untouched (their runs get no commentIds).
  const starts = new Set<string>()
  const ends = new Set<string>()
  const collectRangeIds = (nodes: XNode[]) => {
    for (const node of nodes) {
      const name = nameOf(node)
      if (name === 'w:commentRangeStart' || name === 'w:commentRangeEnd') {
        const id = attrsOf(node)['w:id']
        if (id) (name === 'w:commentRangeStart' ? starts : ends).add(id)
      }
      collectRangeIds(childrenOf(node))
    }
  }
  collectRangeIds(childrenOf(pNode))
  const complete = new Set([...starts].filter((id) => ends.has(id)))
  const activeComments = new Set<string>()
  type RevCtx = { ins?: RevisionInfo; del?: RevisionInfo }
  // inline field state: XE folds into Run.xeTerm, REF (cross-reference) into Run.refField
  let fieldDepth = 0
  let fieldInstr = ''
  let fieldSeparated = false
  let fieldCached = ''
  let fieldCachedRuns: Run[] = []
  let fieldBeginRun: XNode | null = null
  let fieldDirty = false
  const eqField = (instr: string) => (/^\s*EQ\b/i.test(instr) ? eqFieldToOmml(instr) : null)
  // formatting of the field result: the first cached run, else the field code's rPr
  const resultFormat = (): Partial<Run> => {
    let src: Run | null | undefined = fieldCachedRuns[0]
    if (!src && fieldBeginRun) {
      const rPr = findChild(fieldBeginRun, 'w:rPr')
      src = buildRun(
        { 'w:r': [...(rPr ? [rPr] : []), { 'w:t': [{ '#text': 'x' }] }] },
        undefined,
        ctx.themeColors,
        ctx.themeFonts,
        undefined,
        ctx.styles,
        paraRtl,
        ctx.xmlSpacePreserve,
        paraVanish,
        paraBdr,
      )
    }
    if (!src) return {}
    return Object.fromEntries(Object.entries(src).filter(([k]) => !RESULT_FORMAT_SKIP.has(k)))
  }
  // reference-only comments (bare w:commentReference, LibreOffice style) anchor
  // on the nearest run; refs seen before any run attach to the next one
  let pendingRefIds: string[] = []
  const addCommentIds = (run: Run, ids: string[]) => {
    run.commentIds = [...new Set([...(run.commentIds ?? []), ...ids])].sort()
  }
  const pushRun = (run: Run, rev?: RevCtx) => {
    if (activeComments.size > 0) run.commentIds = [...activeComments].sort()
    if (pendingRefIds.length > 0) {
      addCommentIds(run, pendingRefIds)
      pendingRefIds = []
    }
    if (rev?.ins) run.ins = rev.ins
    if (rev?.del) run.del = rev.del
    runs.push(run)
  }
  const handleRun = (node: XNode, link: Run['link'] | undefined, rev?: RevCtx) => {
    const fldChar = findChild(node, 'w:fldChar')
    if (fldChar) {
      const type = attrsOf(fldChar)['w:fldCharType']
      if (type === 'begin') {
        fieldDepth++
        if (fieldDepth === 1) {
          fieldInstr = ''
          fieldSeparated = false
          fieldCached = ''
          fieldCachedRuns = []
          fieldBeginRun = node
          fieldDirty = /^(?:true|1)$/.test(String(attrsOf(fldChar)['w:dirty'] ?? ''))
        }
      } else if (type === 'separate') {
        if (fieldDepth === 1) fieldSeparated = true
      } else if (type === 'end') {
        fieldDepth = Math.max(0, fieldDepth - 1)
        if (fieldDepth === 0) {
          const xe = XE_INSTR_RE.exec(fieldInstr)
          const ref = REF_INSTR_RE.exec(fieldInstr)
          const hyper = convertibleHyperlink(fieldInstr)
          if (xe) pushRun({ text: '', xeTerm: xe[1] ?? xe[2] }, rev)
          else if (ref) {
            const name = ref[1] ?? ref[2]
            pushRun(
              {
                text: fieldCached || name,
                refField: name,
                refInstr: fieldInstr,
                ...(fieldDirty ? { fldDirty: true } : {}),
              },
              rev,
            )
          } else if (hyper) {
            // fold the field into plain link runs (the cached result keeps its
            // formatting); regeneration emits w:hyperlink + a fresh rel
            const linkVal: Run['link'] = {
              href: hyper.href,
              ...(hyper.tooltip ? { tooltip: hyper.tooltip } : {}),
            }
            if (fieldCachedRuns.length > 0) {
              for (const cached of fieldCachedRuns) pushRun({ ...cached, link: linkVal }, rev)
            } else pushRun({ text: hyper.href, link: linkVal }, rev)
          } else if (/^\s*FORMCHECKBOX\s*$/.test(fieldInstr)) {
            // Legacy checkbox form field: no cached result — Word draws the box
            // from ffData. Display a glyph; write the begin run back verbatim.
            const state = checkboxStateOf(fieldBeginRun)
            if (state) {
              const glyph = state.checked ? '☒' : '☐'
              // sizeAuto boxes take the field's own rPr (the begin run): an
              // unformatted glyph would lay at the paragraph default size
              const rPr = findChild(fieldBeginRun!, 'w:rPr')
              const glyphRun = buildRun(
                { 'w:r': [...(rPr ? [rPr] : []), { 'w:t': [{ '#text': glyph }] }] },
                link,
                ctx.themeColors,
                ctx.themeFonts,
                undefined,
                ctx.styles,
                paraRtl,
                ctx.xmlSpacePreserve,
                paraVanish,
                paraBdr,
              )
              pushRun(
                {
                  ...(glyphRun ?? { text: glyph }),
                  instrField: 'FORMCHECKBOX',
                  fldBeginXml: serializeXNode(fieldBeginRun!),
                },
                rev,
              )
            }
          } else if (SIMPLE_INLINE_FIELD_RE.test(fieldInstr)) {
            // an unformatted result run would drop to the paragraph default size
            pushRun(
              {
                ...resultFormat(),
                text: fieldCached || ' ',
                instrField: fieldInstr.trim(),
                ...(fieldDirty ? { fldDirty: true } : {}),
                ...(link ? { link } : {}),
              },
              rev,
            )
          } else if (eqField(fieldInstr)) {
            const eq = eqField(fieldInstr)!
            pushRun({ ...resultFormat(), text: eq.text, math: { omml: eq.omml } }, rev)
          } else if (fieldCachedRuns.length > 0) {
            // any other field (HYPERLINK with switches, MERGEFIELD mail-merge
            // labels...): the cached result is still the visible text — keep it
            // as plain runs. Body paragraphs with these fields stay on the
            // passthrough path (onlyXeFields rejects them), so this only feeds
            // display-only contexts such as table cells and textbox content.
            for (const cached of fieldCachedRuns) pushRun(cached, rev)
          }
          fieldInstr = ''
          fieldSeparated = false
          fieldCached = ''
          fieldCachedRuns = []
          fieldBeginRun = null
        }
      }
      return
    }
    if (fieldDepth > 0) {
      // keep the fragment index aligned even for ruby inside a field cache
      if (findChild(node, 'w:ruby')) rubyIndex++
      const instr = findChild(node, 'w:instrText')
      if (instr) fieldInstr += textOf(instr)
      else if (fieldSeparated && fieldDepth === 1) {
        // REF/HYPERLINK cached result is the display text; other fields' caches are dropped
        const cached = buildRun(
          node,
          link,
          ctx.themeColors,
          ctx.themeFonts,
          undefined,
          ctx.styles,
          paraRtl,
          ctx.xmlSpacePreserve,
          paraVanish,
          paraBdr,
        )
        if (cached) {
          fieldCached += cached.text
          fieldCachedRuns.push(cached)
        }
      }
      return
    }
    const rubyNode = findChild(node, 'w:ruby')
    if (rubyNode) {
      const xml = rubyFragments[rubyIndex++]
      const base = rubyPartText(rubyNode, 'w:rubyBase')
      const rt = rubyPartText(rubyNode, 'w:rt')
      // no fragment (textbox paths): degrade to the base characters
      if (base) pushRun(xml ? { text: base, ruby: { rt, xml } } : { text: base }, rev)
      return
    }
    const noteRefNode =
      findChild(node, 'w:footnoteReference') ?? findChild(node, 'w:endnoteReference')
    if (noteRefNode) {
      const kind = nameOf(noteRefNode) === 'w:footnoteReference' ? 'footnote' : 'endnote'
      const id = attrsOf(noteRefNode)['w:id']
      if (id) {
        const num = ctx.noteNumbers.get(`${kind}:${id}`)
        pushRun({ text: String(num ?? '*'), noteRef: { kind, id } }, rev)
        return
      }
    }
    const commentRef = findChild(node, 'w:commentReference')
    if (commentRef) {
      const id = attrsOf(commentRef)['w:id']
      if (id && ctx.referenceOnlyComments?.has(id)) {
        const prev = runs[runs.length - 1]
        if (prev) addCommentIds(prev, [id])
        else pendingRefIds.push(id)
      }
    }
    // Run.image is singular: a run carrying several drawings/picts must split
    // into one run per picture, or every picture past the first is dropped —
    // and permanently lost from the file once the paragraph is edited
    const nodes = (
      withImages &&
      childrenOf(node).filter((c) => IMAGE_RUN_CHILDREN.has(nameOf(c) ?? '')).length > 1
        ? splitImageRun(node)
        : [node]
    ).flatMap(splitSymRun)
    for (const part of nodes) {
      const run = buildRun(
        part,
        link,
        ctx.themeColors,
        ctx.themeFonts,
        // a part without pictures has no media map, but its VML rules
        // (image runs without media) must still be modelled
        withImages ? (ctx.mediaByRid ?? NO_MEDIA) : undefined,
        ctx.styles,
        paraRtl,
        ctx.xmlSpacePreserve,
        paraVanish,
        paraBdr,
        ctx.vmlShapeTypes,
      )
      if (run) {
        // only a w:rtl run reads the cs slot; without it Word lays even Arabic
        // text in the ascii/hAnsi face at w:sz
        if (!run.csFont && run.cs && textHasComplexScript(run.text)) {
          const cs = inheritedCsFont(run.styleId, pStyleId, ctx)
          if (cs) run.csFont = cs
        }
        pushRun(run, rev)
      }
    }
  }
  // w:fldSimple carrying an instruction the complex-field path folds (XE,
  // REF, simple inline fields) becomes the same run, so the paragraph stays
  // editable and the field survives regeneration; other instructions keep
  // their cached result as plain runs
  const foldSimpleField = (node: XNode, link: Run['link'] | undefined, rev?: RevCtx) => {
    const instr = decodeNumericCharRefs(String(attrsOf(node)['w:instr'] ?? ''))
    const xe = XE_INSTR_RE.exec(instr)
    const ref = REF_INSTR_RE.exec(instr)
    if (!xe && !ref && !SIMPLE_INLINE_FIELD_RE.test(instr)) {
      walk(childrenOf(node), link, rev)
      return
    }
    const first = runs.length
    walk(childrenOf(node), link, rev)
    const cached = runs.splice(first)
    const text = cached.map((r) => r.text).join('')
    const format = cached[0]
      ? Object.fromEntries(Object.entries(cached[0]).filter(([k]) => !RESULT_FORMAT_SKIP.has(k)))
      : {}
    const dirty = /^(?:true|1)$/.test(String(attrsOf(node)['w:dirty'] ?? ''))
    if (xe) pushRun({ text: '', xeTerm: xe[1] ?? xe[2] }, rev)
    else if (ref) {
      const name = ref[1] ?? ref[2]
      pushRun(
        {
          ...format,
          text: text || name,
          refField: name,
          refInstr: ` ${instr.trim()} `,
          ...(dirty ? { fldDirty: true } : {}),
          ...(link ? { link } : {}),
        },
        rev,
      )
    } else {
      pushRun(
        {
          ...format,
          text: text || ' ',
          instrField: instr.trim(),
          ...(dirty ? { fldDirty: true } : {}),
          ...(link ? { link } : {}),
        },
        rev,
      )
    }
  }
  const walk = (nodes: XNode[], link?: Run['link'], rev?: RevCtx) => {
    for (const node of nodes) {
      const name = nameOf(node)
      if (name === 'w:commentRangeStart' || name === 'w:commentRangeEnd') {
        const id = attrsOf(node)['w:id']
        if (id && complete.has(id)) {
          if (name === 'w:commentRangeStart') activeComments.add(id)
          else activeComments.delete(id)
        }
      } else if (name === 'w:ins' || name === 'w:del') {
        const attrs = attrsOf(node)
        const info: RevisionInfo = { author: attrs['w:author'] ?? '' }
        if (attrs['w:date']) info.date = attrs['w:date']
        if (attrs['w:id']) info.id = attrs['w:id']
        const next: RevCtx = name === 'w:ins' ? { ...rev, ins: info } : { ...rev, del: info }
        walk(childrenOf(node), link, next)
      } else if (name === 'w:moveFrom' || name === 'w:moveTo') {
        // Treat moveFrom like del (content was moved away) and moveTo like ins (content arrived here).
        // This allows the existing accept/reject mechanism to handle moves via del/ins marks.
        const attrs = attrsOf(node)
        const info: RevisionInfo = { author: attrs['w:author'] ?? '' }
        if (attrs['w:date']) info.date = attrs['w:date']
        if (attrs['w:id']) info.id = attrs['w:id']
        const next: RevCtx = name === 'w:moveFrom' ? { ...rev, del: info } : { ...rev, ins: info }
        walk(childrenOf(node), link, next)
      } else if (name === 'w:r') {
        handleRun(node, link, rev)
      } else if (name === 'm:oMath') {
        // atomic inline formula; the raw fragment saves verbatim on regeneration
        const omml = mathFragments[mathIndex++]
        if (omml) {
          const sz = parseInt(tagAttr(omml, 'w:sz', 'w:val') ?? '', 10)
          pushRun(
            {
              text: mathTokens(omml).join(''),
              math: { omml },
              ...(Number.isFinite(sz) ? { sizeHalfPoints: Math.max(1, sz) } : {}),
            },
            rev,
          )
        }
      } else if (name === 'w:hyperlink') {
        const attrs = attrsOf(node)
        const rId = attrs['r:id']
        const anchor = attrs['w:anchor']
        const tooltip = attrs['w:tooltip']
        const href = rId
          ? `${ctx.rels.get(rId)?.target ?? ''}${anchor ? `#${anchor}` : ''}`
          : anchor
            ? `#${anchor}`
            : ''
        const first = runs.length
        walk(childrenOf(node), { href, rId, ...(tooltip ? { tooltip } : {}) }, rev)
        // Word paints a bookmark link only through its character style: an
        // unstyled run (TOC entries under \h) keeps the paragraph's ink
        if (!rId && anchor) {
          for (const run of runs.slice(first)) {
            if (run.link && !run.styleId) run.link = { ...run.link, plain: true }
          }
        }
      } else if (name === 'w:sdt' && sdtCheckboxControl(node)) {
        // one glyph run per control, whatever the content held; the state, not
        // the file's text, picks the glyph, as Word does when it draws the box
        const control = sdtCheckboxControl(node)!
        const first = runs.length
        walk(childrenOf(node), link, rev)
        const base = runs.slice(first).find((r) => r.text.trim() !== '') ?? runs[first]
        runs.length = first
        pushRun({ ...(base ?? {}), text: control.glyph, sdtCheckboxXml: control.sdtPrXml }, rev)
      } else if (
        name === 'w:smartTag' ||
        name === 'w:sdt' ||
        name === 'w:sdtContent' ||
        name === 'w:dir' ||
        name === 'w:bdo'
      ) {
        walk(childrenOf(node), link, rev)
      } else if (name === 'w:fldSimple') {
        // single-element field form: the children are the cached result runs
        // (Word shows them until the field refreshes) — MERGEFIELD address
        // labels, DATE stamps... Dropping them blanks mail-merge documents.
        // Skip only inside an enclosing complex field's instruction phase.
        if (fieldDepth === 0) foldSimpleField(node, link, rev)
        else if (fieldSeparated) walk(childrenOf(node), link, rev)
      } else if (name === 'w:br') {
        // Word honors a <w:br> sitting outside any <w:r> (direct child of w:p / w:ins)
        pushRun({ text: breakCharOf(attrsOf(node)) }, rev)
      }
    }
  }
  walk(childrenOf(pNode))
  if (fieldDepth > 0 && fieldSeparated) {
    // a field whose result runs on into the next paragraph (BIBLIOGRAPHY) has no
    // fldChar end here; Word still shows the cached result of this paragraph
    for (const cached of fieldCachedRuns) pushRun(cached)
  }
  return mergeRuns(runs)
}

/** Word probe (2026-09-03): a literal newline inside w:t renders as one space
 *  (never a line break); without xml:space="preserve" in scope Word also drops
 *  the element's leading/trailing whitespace and shows a literal tab as a space */
function wtText(raw: string, preserve: boolean): string {
  const text = raw.replace(/\r\n?|\n/g, ' ')
  return preserve ? text : text.replace(/^[ \t]+|[ \t]+$/g, '').replace(/\t/g, ' ')
}

const NO_MEDIA: ReadonlyMap<string, string> = new Map()

const TEXT_EFFECTS = ['outline', 'emboss', 'imprint', 'shadow'] as const

function buildRun(
  rNode: XNode,
  link?: Run['link'],
  theme?: ThemeColors | null,
  themeFonts?: ThemeFonts | null,
  mediaByRid?: ReadonlyMap<string, string>,
  styles?: Map<string, StyleInfo>,
  paraRtl?: boolean,
  partPreserve?: boolean,
  paraVanish?: boolean,
  paraBdr?: Run['bdr'],
  vmlShapeTypes?: ReadonlyMap<string, Record<string, string>>,
): Run | null {
  let text = ''
  let sym: (Run['sym'] & { glyph: string }) | null | undefined
  for (const child of childrenOf(rNode)) {
    const name = nameOf(child)
    if (name === 'w:t' || name === 'w:delText') {
      const own = attrsOf(child)['xml:space']
      text += wtText(
        decodeNumericCharRefs(textOf(child)),
        own === 'preserve' || (own === undefined && partPreserve === true),
      )
    } else if (name === 'w:tab' || name === 'w:ptab') text += '\t'
    // In-paragraph page breaks (w:br w:type="page") are encoded as \f and preserved; column/soft breaks become \n
    else if (name === 'w:br') text += breakCharOf(attrsOf(child))
    else if (name === 'w:cr') text += '\n'
    else if (name === 'w:noBreakHyphen') text += '\u2011'
    else if (name === 'w:softHyphen') text += '\u00ad'
    else if (name === 'w:sym') {
      const a = attrsOf(child)
      const glyph = symbolGlyph(a['w:font'] ?? '', a['w:char'] ?? '')
      if (glyph !== null) {
        text += glyph
        sym = sym === undefined ? { font: a['w:font'] ?? '', char: a['w:char']!, glyph } : null
      }
    }
  }
  let image: Run['image']
  if (mediaByRid) {
    // Word wraps modern drawings in mc:AlternateContent (Choice + VML twin)
    const choice = findChild(findChild(rNode, 'mc:AlternateContent') ?? {}, 'mc:Choice')
    const drawing = findChild(rNode, 'w:drawing') ?? (choice && findChild(choice, 'w:drawing'))
    if (drawing) {
      const drawingXml = serializeXNode(drawing)
      const rId = /<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/.exec(drawingXml)?.[1]
      const dataUrl = rId ? mediaByRid.get(rId) : undefined
      if (dataUrl) {
        image = { dataUrl, xml: drawingXml }
        const extentTag = /<wp:extent[^>]*\/?>/.exec(drawingXml)?.[0] ?? ''
        const cx = Number(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? NaN)
        const cy = Number(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? NaN)
        if (cx > 0) image.widthPx = emuToPx(cx)
        if (cy > 0) image.heightPx = emuToPx(cy)
        const border = picBorderOf(drawingXml)
        if (border) image.border = border
        const xf = picTransformOf(drawingXml)
        if (xf.rotDeg !== undefined) image.rotDeg = xf.rotDeg
        if (xf.flipH) image.flipH = true
        if (xf.flipV) image.flipV = true
        // anchored (floating) picture kept as a run image: carry the wrap kind
        // and anchor offsets so the editor can float it instead of inlining
        if (/<wp:anchor[\s>]/.test(drawingXml)) {
          const meta = imageMeta(drawingXml)
          if (meta.imageWrap) image.wrap = meta.imageWrap
          if (meta.imageOffsetXEmu !== undefined) image.offsetXEmu = meta.imageOffsetXEmu
          if (meta.imageOffsetYEmu !== undefined) image.offsetYEmu = meta.imageOffsetYEmu
          if (meta.imageRelV) image.relV = meta.imageRelV
          if (meta.imageRelH) image.relH = meta.imageRelH
          if (meta.imageWrapDistTopEmu !== undefined)
            image.wrapDistTopEmu = meta.imageWrapDistTopEmu
          if (meta.imageWrapDistBottomEmu !== undefined)
            image.wrapDistBottomEmu = meta.imageWrapDistBottomEmu
          if (meta.imageWrapDistLeftEmu !== undefined)
            image.wrapDistLeftEmu = meta.imageWrapDistLeftEmu
          if (meta.imageWrapDistRightEmu !== undefined)
            image.wrapDistRightEmu = meta.imageWrapDistRightEmu
          // Word centers the object on the anchor line (tdf#162551: the picture
          // juts above the line rather than hanging below it)
          if (
            /<wp:positionV[^>]*relativeFrom\s*=\s*["']line["'][^>]*>\s*<wp:align>center<\/wp:align>/.test(
              drawingXml,
            )
          )
            image.lineCenterV = true
          if (meta.imageNoOverlap) image.noOverlap = true
        }
      }
    }
    // legacy VML picture (w:pict + v:imagedata, Word 2003 era / stamps) or an
    // inline OLE embed (w:object, whose preview is also a v:imagedata): same
    // run-level image treatment; the fragment round-trips verbatim on save
    if (!image) {
      // a run can carry several (an empty w:pict next to the real w:object):
      // take the first with a resolvable preview picture
      const picts = [
        findChild(rNode, 'w:pict'),
        findChild(rNode, 'w:object'),
        ...(choice ? [findChild(choice, 'w:pict'), findChild(choice, 'w:object')] : []),
      ].filter((n): n is XNode => n !== undefined)
      for (const pict of picts) {
        const pictXml = serializeXNode(pict)
        const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(pictXml)?.[1]
        const dataUrl = rId ? mediaByRid.get(rId) : undefined
        if (dataUrl) {
          image = { dataUrl, xml: pictXml }
          const style = /<v:shape [^>]*style="([^"]*)"/.exec(pictXml)?.[1] ?? ''
          const w = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? '')
          const h = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? '')
          // w:object declares its size in twips when the v:shape style is absent
          const objAttrs = /<w:object\b[^>]*>/.exec(pictXml)?.[0] ?? ''
          const wTw = parseInt(/w:dxaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? '', 10)
          const hTw = parseInt(/w:dyaOrig="(\d+)"/.exec(objAttrs)?.[1] ?? '', 10)
          if (w > 0) image.widthPx = Math.round((w / 72) * 96)
          else if (wTw > 0) image.widthPx = Math.round(wTw / 15)
          if (h > 0) image.heightPx = Math.round((h / 72) * 96)
          else if (hTw > 0) image.heightPx = Math.round(hTw / 15)
          break
        }
        const hrRect = /<v:rect\b[^>]*\bo:hr="t"[^>]*>/.exec(pictXml)?.[0]
        if (hrRect) {
          image = { dataUrl: '', xml: pictXml, rule: vmlHrRule(hrRect) }
          break
        }
        // textless inline VML geometry: floating shapes belong to extractTextboxes
        if (nameOf(pict) === 'w:pict' && !/position:\s*absolute/.test(pictXml)) {
          const shape = vmlShapeSvg(pictXml, vmlShapeTypes)
          if (shape) {
            image = {
              dataUrl: shape.dataUrl,
              xml: pictXml,
              widthPx: shape.widthPx,
              heightPx: shape.heightPx,
            }
            const rot = vmlRotationDeg(shape.style)
            if (rot != null) image.rotDeg = rot
            break
          }
        }
      }
    }
  }
  if (text === '' && !image) return null

  const rPr = findChild(rNode, 'w:rPr')
  const run: Run = { text }
  // only a run that is nothing but one w:sym stays a symbol run
  if (sym && text === sym.glyph) run.sym = { font: sym.font, char: sym.char }
  if (image) run.image = image
  if (link) run.link = link
  // a bare run under an rtl style still selects the Cs set from its style chain
  if (!rPr && paraRtl) run.cs = true
  if (!rPr && paraVanish) run.vanish = true
  if (!rPr && paraBdr) run.bdr = paraBdr
  if (rPr) {
    run.rawRPr = serializeXNode(rPr)
    const rStyle = attrsOf(findChild(rPr, 'w:rStyle') ?? {})['w:val']
    if (rStyle) run.styleId = rStyle
    // hidden text: an explicit run w:vanish wins over the character/paragraph
    // style chain; w:specVanish (style separator) keeps the run visible
    const vanishOwn = onOffOf(rPr, 'w:specVanish') === true ? undefined : onOffOf(rPr, 'w:vanish')
    const vanish =
      vanishOwn ?? (rStyle ? styles?.get(rStyle)?.display?.vanish : undefined) ?? paraVanish
    if (vanish === true) run.vanish = true
    if (vanishOwn !== undefined) run.vanishOwn = vanishOwn
    const eaLang =
      attrsOf(findChild(rPr, 'w:lang') ?? {})['w:eastAsia'] ??
      (rStyle ? styles?.get(rStyle)?.display?.eastAsiaLang : undefined)
    if (eaLang) run.eastAsiaLang = eaLang
    // Word picks the whole property set by w:rtl (probed, Word for Mac 2026-08):
    // rtl runs read w:bCs/w:iCs/w:szCs with no fallback to w:b/w:i/w:sz; non-rtl
    // runs read the base props and ignore the Cs twins entirely. Script content
    // and paragraph w:bidi play no part. Font slot choice is separate. The style
    // chain's w:rtl (character style, then paragraph style) is only the inherited
    // value for runs without an explicit flag.
    const inheritedRtl = (rStyle ? styles?.get(rStyle)?.display?.rtl : undefined) ?? paraRtl
    const cs = (onOffOf(rPr, 'w:rtl') ?? inheritedRtl) === true
    if (cs) run.cs = true
    const bold = onOffOf(rPr, cs ? 'w:bCs' : 'w:b')
    if (bold !== undefined) run.bold = bold
    const italic = onOffOf(rPr, cs ? 'w:iCs' : 'w:i')
    if (italic !== undefined) run.italic = italic
    if (underlineProp(rPr)) run.underline = true
    else if (attrsOf(findChild(rPr, 'w:u') ?? {})['w:val'] === 'none') run.underline = false
    const strike = onOffOf(rPr, 'w:strike')
    if (strike !== undefined) run.strike = strike
    const color = colorFrom(rPr, theme) ?? w14TextFillHex(rPr, theme) ?? autoColorOf(rPr)
    if (color) run.color = color
    if (color && theme && attrsOf(findChild(rPr, 'w:color') ?? {})['w:themeColor']) {
      run.themeColor = color
    }
    const sz = parseInt(attrsOf(findChild(rPr, cs ? 'w:szCs' : 'w:sz') ?? {})['w:val'] ?? '', 10)
    // Word clamps w:sz to one half-point: sz=0 lays out at 0.5pt, not at the default size
    if (Number.isFinite(sz)) run.sizeHalfPoints = Math.max(1, sz)
    const rfAttrs = attrsOf(findChild(rPr, 'w:rFonts') ?? {})
    const rf = themedRFonts(rfAttrs, themeFonts)
    const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi
    if (font) run.font = font
    if (rf.eastAsia) run.eastAsiaFont = rf.eastAsia
    if (rf.eaSlotEmpty && font && font === rf.eastAsia) run.eaSlotEmpty = true
    const fontAscii = rf.ascii ?? rf.hAnsi
    if (fontAscii) run.fontAscii = fontAscii
    // record which resolved values came from theme refs (per winning slot)
    const fontThemed =
      rf.eastAsia !== undefined
        ? rf.themed?.eastAsia
        : rf.ascii !== undefined
          ? rf.themed?.ascii
          : rf.themed?.hAnsi
    const fontAsciiThemed = rf.ascii !== undefined ? rf.themed?.ascii : rf.themed?.hAnsi
    if ((fontThemed && font) || (fontAsciiThemed && fontAscii)) {
      run.themeRFonts = {
        ...(fontThemed && font ? { font } : {}),
        ...(fontAsciiThemed && fontAscii ? { fontAscii } : {}),
      }
    }
    // complex-script slot: literal attribute only — theme refs (w:cstheme) stay in
    // rawRPr so untouched runs keep their original bytes
    if (rfAttrs['w:cs']) run.fontCs = rfAttrs['w:cs']
    // theme-resolved cs font for display consumers
    if (rf.cs) run.csFont = rf.cs
    const rtl = onOffOf(rPr, 'w:rtl')
    if (rtl !== undefined) run.rtl = rtl
    const spc = parseInt(attrsOf(findChild(rPr, 'w:spacing') ?? {})['w:val'] ?? '', 10)
    // an explicit 0 must beat the style's letter spacing
    if (!Number.isNaN(spc)) run.charSpacingTwips = spc
    const kern = attrsOf(findChild(rPr, 'w:kern') ?? {})['w:val']
    if (kern !== undefined) run.kernHalfPoints = parseInt(kern, 10) || 0
    // w:caps wins over w:smallCaps when both are on (Word)
    const capsOn = onOffOf(rPr, 'w:caps')
    const smallCapsOn = onOffOf(rPr, 'w:smallCaps')
    if (capsOn) run.caps = 'all'
    else if (smallCapsOn) run.caps = 'small'
    else if (capsOn === false || smallCapsOn === false) run.caps = 'none'
    const wScale = parseInt(attrsOf(findChild(rPr, 'w:w') ?? {})['w:val'] ?? '', 10)
    if (wScale > 0 && wScale !== 100) run.charScalePct = wScale
    const highlight = attrsOf(findChild(rPr, 'w:highlight') ?? {})['w:val']
    if (highlight && highlight !== 'none') run.highlight = highlight
    const shdNode = findChild(rPr, 'w:shd')
    const shdFill = attrsOf(shdNode ?? {})['w:fill']
    if (shdFill && shdFill !== 'auto') run.shading = stripHash(shdFill)
    const shdDisplay = shdDisplayFill(shdNode, theme)
    if (shdDisplay && shdDisplay !== run.shading) run.shadingDisplay = shdDisplay
    const outline = w14TextOutlineOf(rPr, theme)
    if (outline) run.textOutline = outline
    const effect = TEXT_EFFECTS.find((e) => onOffOf(rPr, `w:${e}`))
    if (effect) run.textEffect = effect
    const dstrike = onOffOf(rPr, 'w:dstrike')
    if (dstrike !== undefined) run.dstrike = dstrike
    const glow = w14GlowOf(rPr, theme)
    if (glow) run.glow = glow
    const position = parseInt(attrsOf(findChild(rPr, 'w:position') ?? {})['w:val'] ?? '', 10)
    if (position) run.positionHalfPoints = position
    const bdrNode = findChild(rPr, 'w:bdr')
    const bdr = bdrNode
      ? runBorderOf(bdrNode)
      : ((rStyle ? styles?.get(rStyle)?.display?.bdr : undefined) ?? paraBdr)
    if (bdr) run.bdr = bdr
    const vertAlign = attrsOf(findChild(rPr, 'w:vertAlign') ?? {})['w:val']
    if (vertAlign === 'superscript' || vertAlign === 'subscript') run.vertAlign = vertAlign
    const em = attrsOf(findChild(rPr, 'w:em') ?? {})['w:val']
    if (em && em !== 'none') run.em = em as NonNullable<Run['em']>
    const rPrChange = findChild(rPr, 'w:rPrChange')
    if (rPrChange) {
      const a = attrsOf(rPrChange)
      const oldRPr = findChild(rPrChange, 'w:rPr')
      const old: NonNullable<Run['rPrChange']>['old'] = {}
      if (oldRPr) {
        // the pre-revision snapshot decodes under the same rtl selection
        const ocs = (onOffOf(oldRPr, 'w:rtl') ?? inheritedRtl) === true
        if (boolProp(oldRPr, ocs ? 'w:bCs' : 'w:b')) old.bold = true
        if (boolProp(oldRPr, ocs ? 'w:iCs' : 'w:i')) old.italic = true
        if (underlineProp(oldRPr)) old.underline = true
        if (boolProp(oldRPr, 'w:strike')) old.strike = true
        const oc = colorFrom(oldRPr, theme)
        if (oc) old.color = oc
        const osz = attrsOf(findChild(oldRPr, ocs ? 'w:szCs' : 'w:sz') ?? {})['w:val']
        if (osz) old.sizeHalfPoints = parseInt(osz, 10) || undefined
        const ofonts = attrsOf(findChild(oldRPr, 'w:rFonts') ?? {})
        const of = ofonts['w:eastAsia'] ?? ofonts['w:ascii'] ?? ofonts['w:hAnsi']
        if (of) old.font = of
        const ofa = ofonts['w:ascii'] ?? ofonts['w:hAnsi']
        if (ofa) old.fontAscii = ofa
        const ospc = parseInt(attrsOf(findChild(oldRPr, 'w:spacing') ?? {})['w:val'] ?? '', 10)
        if (ospc) old.charSpacingTwips = ospc
        const owScale = parseInt(attrsOf(findChild(oldRPr, 'w:w') ?? {})['w:val'] ?? '', 10)
        if (owScale > 0 && owScale !== 100) old.charScalePct = owScale
        const ohighlight = attrsOf(findChild(oldRPr, 'w:highlight') ?? {})['w:val']
        if (ohighlight && ohighlight !== 'none') old.highlight = ohighlight
        const overtAlign = attrsOf(findChild(oldRPr, 'w:vertAlign') ?? {})['w:val']
        if (overtAlign === 'superscript' || overtAlign === 'subscript') old.vertAlign = overtAlign
        const ostyle = attrsOf(findChild(oldRPr, 'w:rStyle') ?? {})['w:val']
        if (ostyle) old.styleId = ostyle
      }
      run.rPrChange = {
        author: a['w:author'] ?? '',
        ...(a['w:date'] ? { date: a['w:date'] } : {}),
        ...(a['w:id'] ? { id: a['w:id'] } : {}),
        ...(Object.keys(old).length > 0 ? { old } : {}),
      }
    }
  }
  // Symbol-encoded fonts (Symbol/Wingdings…): swap the glyph codes for their Unicode
  // equivalents and drop the font, so the text survives systems without those fonts.
  // Pictographs stay in the font: installed, it draws Word's exact glyph, and the
  // stand-in would be a colour emoji. The Latin slot draws these glyphs (run.font
  // is eastAsia-first and a w:eastAsia="Times New Roman" twin is routine)
  const symFont = run.fontAscii ?? run.font
  if (symFont && !run.sym) {
    const decoded = decodeSymbolText(symFont, run.text, { textGlyphsOnly: true })
    if (decoded !== null) {
      run.text = decoded
      delete run.font
      delete run.fontAscii
      delete run.fontCs
      if (run.rawRPr) run.rawRPr = run.rawRPr.replace(/<w:rFonts[^>]*\/>/, '')
    }
  }
  return run
}
