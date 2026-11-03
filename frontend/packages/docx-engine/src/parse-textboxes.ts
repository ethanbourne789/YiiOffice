// Floating textbox domain: w:txbxContent / DrawingML shapes / legacy VML
// frames -> TextboxDisplay boxes, stray anchor runs and VML position/stroke helpers.

import { parseCustGeom } from '@yiioffice/pptx-engine/custgeom'
import { computeListMarkerInfos, type ListItemRef } from './list-markers'
import {
  type ParaAlign,
  type Run,
  type SectionSettings,
  type StrayIndent,
  type TextboxDisplay,
  type TextboxParaDisplay,
} from './types'
import {
  attrsOf,
  childrenOf,
  findChild,
  nameOf,
  serializeXNode,
  textOf,
  xmlParser,
  type XNode,
} from './xml-utils'
import { EMU_PER_PT, EMU_PER_PX, decodeNumericCharRefs } from './parse-xml-text'
import {
  EMU_PER_TWIP,
  IDENTITY_CTM,
  LINE_PRSTS,
  LINE_PRSTS_RE,
  DEFAULT_WRAP_DIST_EMU,
  MIN_WRAP_SLIVER_EMU,
  colorNodeHex,
  composeGroupCtm,
  drawingAnchorMeta,
  gradFillApproxHex,
  lineBoxOf,
  resolveAnchorPagePos,
  topLevelDrawings,
  type DrawingAnchorMeta,
  type ExtractTextboxOpts,
  type GroupCtm,
  type ResolvedAnchorPos,
} from './parse-drawing-geometry'
import {
  JC_ALIGN,
  collectNodes,
  collectTopNodes,
  emptyParaSizeHalfPoints,
  hasLayoutRunContent,
  spaceOnlyRuns,
  isInvisibleVmlPict,
  stripTextboxes,
  txbxHasStructuredContent,
} from './parse-props'
import { paraTextSizeHalfPoints } from './parse-styles'
import {
  VML_PICT_RID_RE,
  VML_WORDART_RE,
  vmlColorHex,
  vmlCoordPx,
  vmlGroupScale,
  vmlPathToNormD,
  vmlRotationDeg,
  vmlShapeDimPx,
  vmlShapeSvg,
  vmlWordArtBox,
  type VmlGroupScale,
  type VmlOrigin,
} from './parse-vml'
import { type BuildContext, emuToPx } from './parse-shared'
import { listRefOf } from './parse-numbering'
import { extractParaFormat, extractRuns, withCharIndents } from './parse-paragraph'
import { hfTableRowParagraphs } from './parse-hf'

/**
 * Text runs the anchor paragraph carries alongside content textboxes
 * (heading text sharing its paragraph with an anchored sidebar). Display-only:
 * the block still saves byte-identical.
 */
export function strayParaRuns(
  paragraphXml: string,
  ctx: BuildContext,
  withImages = false,
): {
  runs: Run[]
  styleId?: string
  indent?: StrayIndent
  align?: ParaAlign
  list?: { numId: string; ilvl: number }
} | null {
  try {
    let strayXml = stripTextboxes(paragraphXml)
    // inline run images only — anchored drawings already render as boxes
    if (withImages) {
      for (const frag of topLevelDrawings(strayXml)) {
        if (frag.includes('<wp:anchor')) strayXml = strayXml.replace(frag, '')
      }
    }
    const parsed = xmlParser.parse(strayXml) as XNode[]
    const pNode = parsed.find((n) => nameOf(n) === 'w:p')
    if (!pNode) return null
    const runs = extractRuns(pNode, ctx, [], [], withImages).filter((r) => r.text !== '' || r.image)
    if (runs.length === 0) return null
    const pPr = findChild(pNode, 'w:pPr')
    const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
    // the anchor paragraph's own w:ind shapes the stray line (a wrap column
    // carved out with a large right indent must not run under the box)
    let indent: StrayIndent | undefined
    const ind = pPr ? findChild(pPr, 'w:ind') : undefined
    if (ind) {
      const a = attrsOf(ind)
      const num = (v: string | undefined) => {
        const n = parseInt(v ?? '', 10)
        return Number.isFinite(n) && n !== 0 ? n : undefined
      }
      const left = num(a['w:left'] ?? a['w:start'])
      const right = num(a['w:right'] ?? a['w:end'])
      const hanging = num(a['w:hanging'])
      const firstLine = hanging !== undefined && hanging > 0 ? -hanging : num(a['w:firstLine'])
      if (left !== undefined || right !== undefined || firstLine !== undefined) {
        indent = {
          ...(left !== undefined ? { leftTwips: left } : {}),
          ...(right !== undefined ? { rightTwips: right } : {}),
          ...(firstLine !== undefined ? { firstLineTwips: firstLine } : {}),
        }
      }
    }
    const jc = pPr ? attrsOf(findChild(pPr, 'w:jc') ?? {})['w:val'] : undefined
    const align =
      (jc ? JC_ALIGN[jc] : undefined) ??
      (styleId ? ctx.styles.get(styleId)?.display?.align : undefined)
    const list = listRefOf(ctx, pPr, styleId)
    return {
      runs,
      ...(styleId ? { styleId } : {}),
      ...(indent ? { indent } : {}),
      ...(align ? { align } : {}),
      ...(list ? { list } : {}),
    }
  } catch {
    return null
  }
}

/** paragraphs (and tables, one display line per row) of a w:txbxContent node */
/** @param docOffset host paragraph's document.xml offset (section grid for character indents) */
function txbxContentParas(
  content: XNode,
  ctx: BuildContext,
  docOffset?: number,
): TextboxParaDisplay[] {
  const out: TextboxParaDisplay[] = []
  const listItems: TxbxListItem[] = []
  collectTxbxParas(content, ctx, docOffset, out, listItems)
  if (listItems.length === 0) return out
  // counters run per textbox: its sub-editor renders the markers, so the
  // document-wide sequence of the main editor is out of reach
  const infos = computeListMarkerInfos(
    listItems.map((item) => item.ref),
    ctx.numbering,
  )
  listItems.forEach(({ para, ref, textSizeHalf }, i) => {
    const info = infos[i]
    if (!info) return
    const level = ctx.numbering.get(ref.numId ?? '')?.levels[Math.max(0, ref.ilvl)]
    para.listMarker = {
      text: info.text,
      ...(info.symbolFont ? { symbol: true } : {}),
      ...(info.picBulletSrc ? { picBulletSrc: info.picBulletSrc } : {}),
      ...(level?.indentLeft !== undefined ? { indentLeft: level.indentLeft } : {}),
      ...(level?.hanging ? { hanging: level.hanging } : {}),
      ...(level?.firstLine ? { firstLine: level.firstLine } : {}),
      ...(level?.szHalfPoints ? { szHalfPoints: level.szHalfPoints } : {}),
      ...(level?.szHalfPoints && level.szHalfPoints > textSizeHalf ? { oversized: true } : {}),
    }
  })
  return out
}

interface TxbxListItem {
  para: TextboxParaDisplay
  ref: ListItemRef
  textSizeHalf: number
}

function collectTxbxParas(
  content: XNode,
  ctx: BuildContext,
  docOffset: number | undefined,
  out: TextboxParaDisplay[],
  listItems: TxbxListItem[],
): void {
  for (const child of childrenOf(content)) {
    const name = nameOf(child)
    if (name === 'w:p') {
      // withImages: inline drawings in textbox paragraphs (form checkboxes)
      // must become run images or they are dropped — and lost on first edit
      const para: TextboxParaDisplay = { runs: extractRuns(child, ctx, [], [], true) }
      const pPr = findChild(child, 'w:pPr')
      const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
      const listRef = listRefOf(ctx, pPr, styleId)
      // pPr-less paragraphs too: the Normal style's character indents apply to them
      // in a textbox just as in the body
      Object.assign(
        para,
        withCharIndents(
          pPr
            ? extractParaFormat(
                pPr,
                ctx.themeColors,
                styleId ? ctx.styles.get(styleId)?.display?.bidi : undefined,
              )
            : undefined,
          ctx,
          child,
          pPr,
          styleId,
          para.runs,
          {
            list: !!listRef,
            docOffset,
          },
        ),
      )
      if (styleId) para.styleId = styleId
      if (spaceOnlyRuns(para.runs) && !hasLayoutRunContent(child)) {
        const markSz = emptyParaSizeHalfPoints(child, pPr, true)
        if (markSz) para.emptyRunSizeHalfPoints = markSz
      }
      if (listRef) {
        listItems.push({
          para,
          ref: listRef,
          textSizeHalf: paraTextSizeHalfPoints(ctx, para.runs, child, pPr, styleId),
        })
      }
      out.push(para)
    } else if (name === 'w:tbl') {
      out.push(...txbxTableParas(child, ctx))
    } else if (name === 'w:sdt') {
      const inner = findChild(child, 'w:sdtContent')
      if (inner) collectTxbxParas(inner, ctx, docOffset, out, listItems)
    }
  }
}

/**
 * Table inside a textbox: the same layout-table rows as a header/footer
 * table (cell columns from tblGrid / tcW, per-cell borders, margins, shading),
 * one display paragraph per row. Nested tables flatten into their host cell.
 */
function txbxTableParas(tbl: XNode, ctx: BuildContext): TextboxParaDisplay[] {
  return hfTableRowParagraphs(tbl, ctx, ctx.compatibilityMode ?? 0).map((p) => ({
    runs: [],
    cells: p.cells,
    row: p.row,
  }))
}

/** a paragraph the box shows: text runs or a table row */
function txbxParaVisible(p: TextboxParaDisplay): boolean {
  return p.runs.length > 0 || (p.cells?.length ?? 0) > 0
}

/** a textless top-level v:shape/rect/roundrect/oval placed with position:absolute */
export function hasFloatingVmlGeometry(xml: string): boolean {
  if (VML_PICT_RID_RE.test(xml) || xml.includes('<w:txbxContent')) return false
  return /<v:(?:shape|rect|roundrect|oval)\b[^>]*\bstyle="[^"]*position:\s*absolute/.test(xml)
}

/**
 * Every w:pict of the paragraph either draws nothing (no shape instance) or
 * is an inline shape the SVG path can render: the paragraph stays a text
 * paragraph and buildRun turns the shapes into run images.
 */
export function vmlPictsInlineOnly(
  xml: string,
  shapeTypes: ReadonlyMap<string, Record<string, string>> | undefined,
): boolean {
  const picts = xml.match(/<w:pict[\s>][\s\S]*?<\/w:pict>|<w:pict\s*\/>/g) ?? []
  if (picts.length === 0 || VML_PICT_RID_RE.test(xml)) return false
  return picts.every((pict) => {
    const body = pict.replace(/<v:shapetype\b[\s\S]*?<\/v:shapetype>|<v:shapetype\b[^>]*\/>/g, '')
    if (!/<v:\w+/.test(body)) return true
    return !/position:\s*absolute/.test(pict) && vmlShapeSvg(pict, shapeTypes) !== null
  })
}

/**
 * Display-only line for text a paragraph carries alongside its VML shapes
 * (canvas + trailing hyperlinks): the shape XML is stripped and the remaining
 * runs rendered as a boxless read-only paragraph, so the text stays visible.
 */
export function paragraphStrayBox(pXml: string, ctx: BuildContext): TextboxDisplay | null {
  const stripped = stripTextboxes(pXml).replace(/<w:pict>[\s\S]*?<\/w:pict>/g, '')
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(stripped) as XNode[]
  } catch {
    return null
  }
  const pNodes: XNode[] = []
  collectNodes(parsed, 'w:p', pNodes)
  if (pNodes.length === 0) return null
  const para: TextboxParaDisplay = { runs: extractRuns(pNodes[0], ctx) }
  const pPr = findChild(pNodes[0], 'w:pPr')
  if (pPr) Object.assign(para, extractParaFormat(pPr, ctx.themeColors))
  if (!para.runs.some((r) => r.text.trim() !== '')) return null
  return {
    paras: [para],
    readOnly: true,
    insetTopPx: 0,
    insetRightPx: 0,
    insetBottomPx: 0,
    insetLeftPx: 0,
  }
}

const vmlFlagOff = (value: string | undefined): boolean =>
  value === 'f' || value === 'false' || value === '0'

function vmlStrokeChildOff(shape: XNode): boolean {
  const stroke = findChild(shape, 'v:stroke')
  return stroke !== undefined && vmlFlagOff(attrsOf(stroke)['on'])
}

/** v:shape strokeweight ("0.75pt", "2px", bare = pt) → CSS px */
function vmlStrokeWeightPx(value: string | undefined): number | undefined {
  const m = /^\s*([\d.]+)\s*(pt|px)?\s*$/.exec(value ?? '')
  if (!m) return undefined
  const n = parseFloat(m[1]!)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round((m[2] === 'px' ? n : (n / 72) * 96) * 100) / 100
}

/**
 * Word-specific VML placement of a top-level absolute shape:
 * mso-position-horizontal keywords resolve against the column, margin or page
 * box (default relative "text" = column), and page/margin-relative numeric
 * offsets become absolute page positions like the DrawingML posOffset path.
 */
function applyVmlMsoPosition(box: TextboxDisplay, style: string, sect: SectionSettings): void {
  const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1]
  const relH = /mso-position-horizontal-relative:(\w+)/.exec(style)?.[1] ?? 'text'
  const relV = /mso-position-vertical-relative:(\w+)/.exec(style)?.[1] ?? 'text'
  const marL = sect.marginLeft * EMU_PER_TWIP
  const colW = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP
  const fromPage = relH === 'page'
  if (fromPage || relH === 'margin' || sect.columns <= 1) {
    const originX = fromPage ? -marL : 0
    const spanW = fromPage ? sect.pageWidth * EMU_PER_TWIP : colW
    const wEmu = box.widthPx !== undefined ? box.widthPx * EMU_PER_PX : undefined
    if (posH === 'left' || posH === 'inside') box.offsetXEmu = Math.round(originX)
    else if ((posH === 'right' || posH === 'outside') && wEmu !== undefined)
      box.offsetXEmu = Math.round(originX + spanW - wEmu)
    else if (posH === 'center' && wEmu !== undefined)
      box.offsetXEmu = Math.round(originX + (spanW - wEmu) / 2)
    else if (fromPage) box.offsetXEmu = Math.round((box.offsetXEmu ?? 0) + originX)
  }
  const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1]
  const numericV = posV === undefined || posV === 'absolute'
  if ((relV === 'page' || relV === 'margin') && numericV) {
    if (relV === 'page') {
      box.offsetYEmu = Math.round((box.offsetYEmu ?? 0) - sect.marginTop * EMU_PER_TWIP)
    }
    box.pageRelV = true
    box.pageRelVFrom = relV
  }
}

export function extractTextboxes(
  xml: string,
  ctx: BuildContext,
  opts?: ExtractTextboxOpts,
): TextboxDisplay[] {
  // wrapSquare gate keeps converter-emitted decorative rules on the thin-rule path
  const hasLineShapes = xml.includes('<wp:wrapSquare') && LINE_PRSTS_RE.test(xml)
  const hasCanvasText = xml.includes('<a:txSp')
  const hasVmlWordArt = VML_WORDART_RE.test(xml)
  if (
    !xml.includes('<w:txbxContent') &&
    !hasLineShapes &&
    !hasCanvasText &&
    !hasVmlWordArt &&
    !(opts?.shapes || opts?.pictures)
  ) {
    return []
  }

  const frags = topLevelDrawings(xml)
  // a paragraph anchoring several drawings never stacks them: every anchored
  // shape floats at its own offset (single wrapSquare boxes keep the flow
  // placement the editor has always used)
  const multiDrawing = frags.length > 1

  const out: TextboxDisplay[] = []
  // every w:txbxContent consumes one save-path ordinal (box emitted or not),
  // mirroring how patchTextboxParas counts the non-fallback segments
  let txbxOrdinal = 0

  /** one wps:wsp (already parsed) → display box; null when it renders nothing */
  const buildWpsBox = (
    shape: XNode,
    groupFill?: string,
    nested?: boolean,
    grouped?: boolean,
  ): TextboxDisplay | null => {
    const contents: XNode[] = []
    collectNodes(childrenOf(shape), 'w:txbxContent', contents)
    // only top-level contents of a top-level shape consume a save-path
    // ordinal: xmlSegments never descends into a segment, so neither a
    // textbox nested inside another nor a shape living inside some other
    // box's w:txbxContent may advance the counter
    const topContents: XNode[] = []
    collectTopNodes(childrenOf(shape), 'w:txbxContent', topContents)
    const ordinal = txbxOrdinal
    if (!nested) txbxOrdinal += topContents.length
    // external textbox part (wps:txbx r:txbx, word/txbx*.xml): its root
    // w14:txbx carries the w:p list directly. Display-only — it stays out of
    // topContents, so the box takes no save ordinal and turns readOnly below.
    if (contents.length === 0) {
      const extRid = attrsOf(findChild(shape, 'wps:txbx') ?? {})['r:txbx']
      const extXml = extRid ? ctx.externalTxbxByRid?.get(extRid) : undefined
      if (extXml) {
        try {
          const nodes = xmlParser.parse(extXml) as XNode[]
          const root = nodes.find((n) => nameOf(n)?.endsWith(':txbx'))
          if (root) contents.push(root)
        } catch {
          /* unreadable part: fall through to the textless-shape path */
        }
      }
    }
    const spPr = findChild(shape, 'wps:spPr')
    const prstOf = spPr ? attrsOf(findChild(spPr, 'a:prstGeom') ?? {})['prst'] : undefined
    const custGeomNode = spPr ? findChild(spPr, 'a:custGeom') : undefined
    if (contents.length === 0) {
      if (prstOf && LINE_PRSTS.has(prstOf)) {
        if (hasLineShapes) return lineBoxOf(shape, ctx.themeColors)
        if (!opts?.shapes) return null
        // anchored gallery connector: a real vertical extent, flips, or arrow
        // ends mark a drawn connector; plain near-flat lines stay on the
        // decorative thin-rule path
        const xfrm = findChild(spPr ?? {}, 'a:xfrm')
        const cy = parseInt(attrsOf(findChild(xfrm ?? {}, 'a:ext') ?? {})['cy'] ?? '', 10)
        const xa = attrsOf(xfrm ?? {})
        const flipped = ['flipH', 'flipV'].some((k) => xa[k] === '1' || xa[k] === 'true')
        const ln = findChild(spPr ?? {}, 'a:ln')
        const arrowed = ['a:headEnd', 'a:tailEnd'].some((name) => {
          const type = attrsOf(findChild(ln ?? {}, name) ?? {})['type']
          return !!type && type !== 'none'
        })
        return (Number.isFinite(cy) && cy > 130000) || flipped || arrowed
          ? lineBoxOf(shape, ctx.themeColors)
          : null
      }
      if (hasLineShapes && !opts?.shapes) return null
      if (!opts?.shapes || (!prstOf && !custGeomNode)) return null
      if (prstOf === 'rect') {
        // near-flat rects stay on the decorative thin-rule path; a real
        // rectangle (pattern/solid-filled swatch, tdf dml-shape-fillpattern)
        // renders like any other textless preset shape
        const xfrm = findChild(spPr ?? {}, 'a:xfrm')
        const cy = parseInt(attrsOf(findChild(xfrm ?? {}, 'a:ext') ?? {})['cy'] ?? '', 10)
        // a filled strip sharing its paragraph (or group) with other drawings
        // is drawn geometry — Word masks part of a sibling picture with it —
        // and nothing else would paint it (the decorative-rule path only
        // takes a lone drawing paragraph)
        const filledSibling = (grouped || multiDrawing) && !!findChild(spPr ?? {}, 'a:solidFill')
        if (!filledSibling && (!Number.isFinite(cy) || cy <= 130000)) return null
      }
    }
    const box: TextboxDisplay = { paras: [] }
    if (!nested && topContents.length > 0) box.txbxIndex = ordinal
    if (nested) box.readOnly = true
    const shapeId = attrsOf(findChild(shape, 'wps:cNvPr') ?? {})['id']
    if (!nested && shapeId) box.shapeId = shapeId
    if (spPr) {
      if (!findChild(spPr, 'a:noFill')) {
        // a:pattFill approximates to its foreground color (same tradeoff as gradFill)
        const pattFill = findChild(spPr, 'a:pattFill')
        const fill =
          colorNodeHex(findChild(spPr, 'a:solidFill'), ctx.themeColors) ??
          gradFillApproxHex(spPr, ctx.themeColors) ??
          (pattFill ? colorNodeHex(findChild(pattFill, 'a:fgClr'), ctx.themeColors) : undefined) ??
          // a:grpFill inherits the enclosing wpg group's fill
          (findChild(spPr, 'a:grpFill') ? groupFill : undefined)
        if (fill) box.fill = fill
        const blipFill = findChild(spPr, 'a:blipFill')
        if (blipFill) {
          const rId = attrsOf(findChild(blipFill, 'a:blip') ?? {})['r:embed']
          const dataUrl = rId ? ctx.mediaByRid?.get(rId) : undefined
          if (dataUrl) {
            box.fillImageDataUrl = dataUrl
            if (findChild(blipFill, 'a:tile')) box.fillTile = true
          }
        }
      }
      const ln = findChild(spPr, 'a:ln')
      if (ln && !findChild(ln, 'a:noFill')) {
        const border = colorNodeHex(findChild(ln, 'a:solidFill'), ctx.themeColors)
        if (border) box.borderColor = border
        const w = parseInt(attrsOf(ln)['w'] ?? '', 10)
        if (Number.isFinite(w) && w > 0) {
          box.borderWidthPx = Math.round((w / EMU_PER_PX) * 100) / 100
        }
        const dash = attrsOf(findChild(ln, 'a:prstDash') ?? {})['val']
        if (dash && dash !== 'solid') box.borderDash = /dot/i.test(dash) ? 'dotted' : 'dashed'
      }
      // shape-style references (wps:style): theme fill/line for shapes whose
      // spPr declares no explicit color (Word gallery shapes)
      const styleNode = findChild(shape, 'wps:style')
      if (styleNode) {
        if (!box.fill && !box.fillImageDataUrl && !findChild(spPr, 'a:noFill')) {
          const ref = findChild(styleNode, 'a:fillRef')
          if (parseInt(attrsOf(ref ?? {})['idx'] ?? '0', 10) > 0) {
            const fill = colorNodeHex(ref, ctx.themeColors)
            if (fill) box.fill = fill
          }
        }
        if (!box.borderColor && !(ln && findChild(ln, 'a:noFill'))) {
          const ref = findChild(styleNode, 'a:lnRef')
          if (parseInt(attrsOf(ref ?? {})['idx'] ?? '0', 10) > 0) {
            const border = colorNodeHex(ref, ctx.themeColors)
            if (border) box.borderColor = border
          }
        }
        // a:fontRef is where a gallery shape's text color comes from — the default
        // blue shape references lt1, which is why Word and PowerPoint show white text
        // on it without writing a color on any run. Runs with their own w:color win.
        const fontColor = colorNodeHex(findChild(styleNode, 'a:fontRef'), ctx.themeColors)
        if (fontColor) box.textColor = fontColor
      }
      const prst = prstOf
      if (prst && prst !== 'rect') box.prst = prst
      const xfrm = findChild(spPr, 'a:xfrm')
      if (custGeomNode) {
        const extAttrs = attrsOf(findChild(xfrm ?? {}, 'a:ext') ?? {})
        const geom = parseCustGeom(
          serializeXNode(spPr),
          parseInt(extAttrs['cx'] ?? '', 10) || 0,
          parseInt(extAttrs['cy'] ?? '', 10) || 0,
        )
        if (geom) box.pathData = geom
      }
      const rot = parseInt(attrsOf(xfrm ?? {})['rot'] ?? '', 10)
      if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 60000)
      const ext = findChild(xfrm ?? {}, 'a:ext')
      const cx = ext ? parseInt(attrsOf(ext)['cx'] ?? '', 10) : NaN
      if (Number.isFinite(cx) && cx > 0) box.widthPx = Math.round(cx / EMU_PER_PX)
      // Word clips overflowing text unless the shape auto-fits its content;
      // carrying the fixed height keeps tall sparse boxes from exploding layout
      const bodyPrNode = findChild(shape, 'wps:bodyPr')
      const autoFit = bodyPrNode ? !!findChild(bodyPrNode, 'a:spAutoFit') : false
      const cy = ext ? parseInt(attrsOf(ext)['cy'] ?? '', 10) : NaN
      if (!autoFit && Number.isFinite(cy) && cy > 0) {
        box.heightPx = Math.round(cy / EMU_PER_PX)
        box.minHeightPx = box.heightPx
      }
    }
    const bodyPr = findChild(shape, 'wps:bodyPr')
    if (bodyPr) {
      const attrs = attrsOf(bodyPr)
      const inset = (name: string): number | undefined => {
        const emu = parseInt(attrs[name] ?? '', 10)
        return Number.isFinite(emu) && emu >= 0
          ? Math.round((emu / EMU_PER_PX) * 100) / 100
          : undefined
      }
      box.insetLeftPx = inset('lIns')
      box.insetTopPx = inset('tIns')
      box.insetRightPx = inset('rIns')
      box.insetBottomPx = inset('bIns')
      if (attrs['anchor'] === 'b') box.vAlign = 'bottom'
      else if (attrs['anchor'] === 'ctr') box.vAlign = 'center'
    }
    for (const content of contents)
      box.paras.push(...txbxContentParas(content, ctx, opts?.docOffset))
    if (contents.some(txbxHasStructuredContent)) box.readOnly = true
    // a textbox nested inside this one flattens into paras above: a commit
    // would rewrite the outer w:p list and destroy the nested shape
    if (contents.length > topContents.length) box.readOnly = true
    if (contents.length === 0) {
      // textless preset shape: keep it if the geometry has any visible ink
      if (!box.fill && !box.borderColor && !box.fillImageDataUrl) return null
      // no w:txbxContent to patch — editable only when the cNvPr id gives the
      // save path a shape to inject a fresh wps:txbx into
      if (!box.shapeId) box.readOnly = true
      // Word centers shape text: without an explicit anchor the live preview
      // and the anchor="ctr" the inject path writes agree
      else if (!box.vAlign && !(bodyPr && attrsOf(bodyPr)['anchor'])) box.vAlign = 'center'
      return box
    }
    if (box.paras.some(txbxParaVisible)) return box
    // text-empty box: keep visible ink (a full-page white box must occupy its
    // extent instead of degrading to a chip); its w:txbxContent stays
    // addressable, so typing into the empty shape still commits
    if (!box.fill && !box.borderColor && !box.fillImageDataUrl) return null
    box.paras = []
    return box
  }

  const applyAnchor = (
    box: TextboxDisplay,
    meta: DrawingAnchorMeta,
    pagePos: ResolvedAnchorPos | null,
    grouped = false,
  ): void => {
    if (!meta.anchored) return
    if (meta.behind) box.behind = true
    if (meta.noWrap) box.noWrap = true
    if (meta.outsideCell) box.outsideCell = true
    if (meta.z !== undefined) box.z = meta.z
    // first-page page-anchored cover art: raw page coordinates, rendered
    // against the page box (doc-protected-pagepinned)
    if (meta.pageXEmu !== undefined) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + meta.pageXEmu
      box.offsetYEmu = (box.offsetYEmu ?? 0) + (meta.pageYEmu ?? 0)
      box.floating = true
      box.pagePinned = true
      return
    }
    // page/margin-anchored drawing sitting outside the body column (Word
    // resume sidebars): absolute placement at the resolved position instead
    // of stacking in the flow, wrap kind notwithstanding
    // page/margin-relative X is absolute on the page in Word: a
    // column-translated anchor block must not drag the box sideways
    const relXAbsolute = meta.relH === 'page' || meta.relH === 'margin'
    if (pagePos?.outsideColumn) {
      // group children already carry a group-relative offset: the anchor adds
      box.offsetXEmu = (box.offsetXEmu ?? 0) + pagePos.xEmu
      box.offsetYEmu = (box.offsetYEmu ?? 0) + (pagePos.yEmu ?? meta.offsetYEmu ?? 0)
      box.floating = true
      if (relXAbsolute) box.pageRelX = true
      return
    }
    if (meta.offsetXEmu !== undefined) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + meta.offsetXEmu
      if (relXAbsolute) box.pageRelX = true
      if (meta.relH === 'page') box.pageRelXFrom = 'page'
    }
    // margin-aligned X (wp:align left/center/right) on a floating drawing (photo
    // rows): resolve against the margin box; in-flow wrapSquare boxes keep the
    // legacy flow placement
    if (
      pagePos !== null &&
      !pagePos.outsideColumn &&
      meta.offsetXEmu === undefined &&
      (meta.topBottom || meta.noWrap || multiDrawing)
    ) {
      box.offsetXEmu = (box.offsetXEmu ?? 0) + pagePos.xEmu
      if (relXAbsolute) box.pageRelX = true
    }
    if (meta.offsetYEmu !== undefined) box.offsetYEmu = (box.offsetYEmu ?? 0) + meta.offsetYEmu
    // page/margin-relative posOffset V is absolute on the anchor's page in
    // Word; rendered from the anchor paragraph it needs the canvas re-pin
    if (
      (meta.relV === 'page' || meta.relV === 'margin') &&
      meta.offsetYEmu !== undefined &&
      !meta.alignV
    ) {
      box.pageRelV = true
      box.pageRelVFrom = meta.relV
    }
    // wrapSquare box spanning (nearly) the whole column: no text fits in the
    // leftover sliver, so Word floats the box at its offset (the anchor line
    // stays under it) and lays text above/below — reserve the band like
    // wrapTopAndBottom instead of stacking the box into the flow (or, in a
    // multi-drawing paragraph, overlaying the flow with zero footprint).
    // A multi-drawing paragraph covers the column with the UNION of its boxes
    // (half-width sign-off frames side by side): the wrapSquare ones band too.
    let ownSpansColumn = false
    let squareSpansColumn = false
    const sect = opts?.section
    if (!meta.noWrap && !meta.topBottom && !grouped && sect && sect.columns <= 1) {
      const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP
      const wEmu = box.widthPx !== undefined ? box.widthPx * EMU_PER_PX : meta.extentXEmu
      const xEmu = box.offsetXEmu ?? 0
      ownSpansColumn =
        wEmu !== undefined &&
        wEmu > 0 &&
        xEmu < MIN_WRAP_SLIVER_EMU &&
        colWEmu - xEmu - wEmu < MIN_WRAP_SLIVER_EMU
      squareSpansColumn = ownSpansColumn || (multiDrawing && anchorUnionSpansColumn(sect))
    }
    // wrapTopAndBottom (Word): body text is excluded from the box's whole
    // vertical band. The box floats at its offset and the anchor paragraph
    // reserves flow height down to the box bottom (union over its boxes).
    if (
      (meta.topBottom || squareSpansColumn) &&
      (meta.relV === 'paragraph' || meta.relV === 'line')
    ) {
      // wp:extent cy covers the whole drawing: a usable height fallback only
      // for an ungrouped shape (each group child would claim the group height)
      const h =
        box.heightPx ??
        (!grouped && meta.extentYEmu !== undefined
          ? Math.round(meta.extentYEmu / EMU_PER_PX)
          : undefined)
      if (h !== undefined) {
        const top = Math.round((box.offsetYEmu ?? 0) / EMU_PER_PX)
        if (top + h > 0) {
          box.bandTopPx = top
          box.bandBottomPx = top + h
          // only a box that spans the column BY ITSELF may overflow the page
          // bottom (Word keeps it on its anchor's page); a union band (side by
          // side frames) is pushed whole to the next page like Word
          if (ownSpansColumn && !meta.topBottom) box.bandOverflow = true
        }
      }
      box.floating = true
    }
    if (meta.noWrap || multiDrawing) box.floating = true
    if (!meta.noWrap && !meta.topBottom) box.wrapSides = true
    // in-column wrapSquare box: Word flows the body text beside it (from the
    // anchor paragraph on) instead of stacking it into the flow — a CSS float
    // on the side with less room, when the other side keeps a usable column
    if (
      box.wrapSides &&
      !box.floating &&
      !grouped &&
      sect &&
      sect.columns <= 1 &&
      meta.relV !== 'page' &&
      meta.relV !== 'margin' &&
      meta.alignH !== 'center'
    ) {
      const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP
      const wEmu = box.widthPx !== undefined ? box.widthPx * EMU_PER_PX : meta.extentXEmu
      if (wEmu !== undefined && wEmu > 0) {
        const xEmu =
          meta.alignH === 'right'
            ? colWEmu - wEmu
            : meta.alignH === 'left'
              ? 0
              : (box.offsetXEmu ?? 0)
        const distL = meta.distLEmu ?? DEFAULT_WRAP_DIST_EMU
        const distR = meta.distREmu ?? DEFAULT_WRAP_DIST_EMU
        const leftGap = xEmu - distL
        const rightGap = colWEmu - xEmu - wEmu - distR
        const side = leftGap >= rightGap ? 'right' : 'left'
        if ((side === 'right' ? leftGap : rightGap) >= MIN_WRAP_SLIVER_EMU) {
          box.wrapSide = side
          box.wrapEdgePx = (side === 'right' ? colWEmu - xEmu - wEmu : xEmu) / EMU_PER_PX
          box.wrapGapPx = (side === 'right' ? distL : distR) / EMU_PER_PX
        }
      }
    }
  }

  // union of the paragraph's anchored drawing extents: when the widest
  // remaining horizontal gap in the column is a sliver, no text fits beside
  // the boxes and Word lays it above/below the row
  let unionSpans: boolean | undefined
  const anchorUnionSpansColumn = (sect: SectionSettings): boolean => {
    if (unionSpans !== undefined) return unionSpans
    const colWEmu = (sect.pageWidth - sect.marginLeft - sect.marginRight) * EMU_PER_TWIP
    const iv = fragMetas
      .filter((m) => m.anchored && m.offsetXEmu !== undefined && (m.extentXEmu ?? 0) > 0)
      .map((m): [number, number] => [m.offsetXEmu!, m.offsetXEmu! + m.extentXEmu!])
      .sort((a, b) => a[0] - b[0])
    let gap = 0
    let cursor = 0
    for (const [a, b] of iv) {
      gap = Math.max(gap, a - cursor)
      cursor = Math.max(cursor, b)
    }
    gap = Math.max(gap, colWEmu - cursor)
    unionSpans = iv.length > 0 && gap < MIN_WRAP_SLIVER_EMU
    return unionSpans
  }

  // first-page cover art with a page-relative V anchor: keep RAW page
  // coordinates and pin the boxes to the page box itself. Any paragraph- or
  // body-top-relative rendering re-adds whatever sits above the anchor
  // paragraph (logo lines, empty leads) and shifts the whole composition.
  // All-or-nothing per paragraph: the un-positioned pagepinned wrapper would
  // break any sibling drawing still positioned from the paragraph origin.
  const pinnable = (m: DrawingAnchorMeta): boolean =>
    m.anchored === true &&
    (m.noWrap === true || m.behind === true || multiDrawing) &&
    m.relV === 'page' &&
    (m.relH === 'page' || m.relH === 'margin')
  const fragMetas = frags.map(drawingAnchorMeta)
  const anchoredMetas = fragMetas.filter((m) => m.anchored)
  const pinAll =
    opts?.firstPage === true &&
    opts.section !== undefined &&
    anchoredMetas.length > 0 &&
    anchoredMetas.every(pinnable)
  // page-relative posOffset measures from the page edge; boxes render from
  // the column/paragraph origin, so keeping the raw value double-counts the
  // margins (X is exact; Y approximates the anchor paragraph at body top,
  // strictly closer than the raw page offset). One pass up front keeps every
  // consumer -- applyAnchor, the column-span test, the anchor union -- in the
  // same column space; pinned metas keep raw page coordinates.
  if (opts?.section) {
    for (const m of fragMetas) {
      if (pinAll && pinnable(m)) continue
      if (m.relH === 'page' && m.offsetXEmu !== undefined && !m.alignH) {
        m.offsetXEmu -= opts.section.marginLeft * EMU_PER_TWIP
      }
      if (m.relV === 'page' && m.offsetYEmu !== undefined && !m.alignV) {
        m.offsetYEmu -= opts.section.marginTop * EMU_PER_TWIP
      }
    }
  }

  for (const [fragIndex, frag] of frags.entries()) {
    let parsedFrag: XNode[]
    try {
      parsedFrag = xmlParser.parse(frag) as XNode[]
    } catch {
      continue
    }
    const meta = fragMetas[fragIndex]
    if (pinAll && pinnable(meta) && opts?.section) {
      const marL = opts.section.marginLeft * EMU_PER_TWIP
      const marT = opts.section.marginTop * EMU_PER_TWIP
      const aligned = resolveAnchorPagePos(meta, opts.section)
      meta.pageXEmu =
        aligned !== null
          ? aligned.xEmu + marL
          : (meta.relH === 'margin' ? marL : 0) + (meta.offsetXEmu ?? 0)
      meta.pageYEmu = aligned?.yEmu !== undefined ? aligned.yEmu + marT : (meta.offsetYEmu ?? 0)
    }
    const pagePos = meta.pageXEmu === undefined ? resolveAnchorPagePos(meta, opts?.section) : null
    let wspCount = 0
    const extentCy = parseInt(/<wp:extent[^>]*cy="(\d+)"/.exec(frag)?.[1] ?? '', 10)
    const inlineExtentPx = !meta.anchored && extentCy > 0 ? emuToPx(extentCy) : 0
    const pushShape = (
      shape: XNode,
      ctm: GroupCtm | null,
      groupFill?: string,
      nested?: boolean,
    ): void => {
      wspCount++
      const box = buildWpsBox(shape, groupFill, nested, ctm !== null)
      if (!box) return
      if (ctm) {
        const xfrm = findChild(findChild(shape, 'wps:spPr') ?? {}, 'a:xfrm')
        const off = attrsOf(findChild(xfrm ?? {}, 'a:off') ?? {})
        const x = parseInt(off['x'] ?? '', 10)
        const y = parseInt(off['y'] ?? '', 10)
        if (Number.isFinite(x)) box.offsetXEmu = Math.round(ctm.tx + x * ctm.sx)
        if (Number.isFinite(y)) box.offsetYEmu = Math.round(ctm.ty + y * ctm.sy)
        if (ctm.sx !== 1 && box.widthPx) box.widthPx = Math.round(box.widthPx * ctm.sx)
        if (ctm.sy !== 1) {
          if (box.heightPx) box.heightPx = Math.round(box.heightPx * ctm.sy)
          if (box.minHeightPx) box.minHeightPx = Math.round(box.minHeightPx * ctm.sy)
        }
        // grouped shapes place absolutely at their mapped offset like Word
        box.floating = true
        if (inlineExtentPx > 0) box.inlineExtentPx = inlineExtentPx
      }
      applyAnchor(box, meta, pagePos, ctm !== null)
      out.push(box)
    }
    // grouped pic:pic (photo inside a wpg group): a photo box at the mapped
    // child offset, painted in document order between its sibling shapes
    const pushPic = (node: XNode, ctm: GroupCtm | null): void => {
      const blip = findChild(findChild(node, 'pic:blipFill') ?? {}, 'a:blip')
      const blipAttrs = attrsOf(blip ?? {})
      const rId = blipAttrs['r:embed'] ?? blipAttrs['r:link']
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : undefined
      if (!dataUrl) return
      const xfrm = findChild(findChild(node, 'pic:spPr') ?? {}, 'a:xfrm')
      const ext = attrsOf(findChild(xfrm ?? {}, 'a:ext') ?? {})
      const cx = parseInt(ext['cx'] ?? '', 10)
      const cy = parseInt(ext['cy'] ?? '', 10)
      if (!(cx > 0) || !(cy > 0)) return
      const rot = parseInt(attrsOf(xfrm ?? {})['rot'] ?? '', 10)
      const box: TextboxDisplay = {
        paras: [],
        readOnly: true,
        fillImageDataUrl: dataUrl,
        widthPx: emuToPx(cx * (ctm?.sx ?? 1)),
        heightPx: emuToPx(cy * (ctm?.sy ?? 1)),
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0,
      }
      if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 60000)
      if (ctm) {
        const off = attrsOf(findChild(xfrm ?? {}, 'a:off') ?? {})
        const x = parseInt(off['x'] ?? '', 10)
        const y = parseInt(off['y'] ?? '', 10)
        if (Number.isFinite(x)) box.offsetXEmu = Math.round(ctm.tx + x * ctm.sx)
        if (Number.isFinite(y)) box.offsetYEmu = Math.round(ctm.ty + y * ctm.sy)
        box.floating = true
        if (inlineExtentPx > 0) box.inlineExtentPx = inlineExtentPx
      }
      applyAnchor(box, meta, pagePos, ctm !== null)
      out.push(box)
    }
    // document-order walk (box order must match w:txbxContent order for the
    // patch-save mapping), carrying the enclosing wpg group transform and
    // fill; anything below a wps:wsp lives inside its txbx → nested
    const walkShapes = (
      nodes: XNode[],
      ctm: GroupCtm | null,
      groupFill?: string,
      nested = false,
    ): void => {
      for (const node of nodes) {
        const name = nameOf(node)
        if (name === 'wps:wsp') pushShape(node, ctm, groupFill, nested)
        if (name === 'pic:pic' && opts?.pictures && ctm) pushPic(node, ctm)
        if (name === 'wpg:wgp' || name === 'wpg:grpSp') {
          const fill =
            colorNodeHex(
              findChild(findChild(node, 'wpg:grpSpPr') ?? {}, 'a:solidFill'),
              ctx.themeColors,
            ) ?? groupFill
          walkShapes(
            childrenOf(node),
            composeGroupCtm(node, ctm ?? IDENTITY_CTM) ?? ctm,
            fill,
            nested,
          )
        } else {
          walkShapes(childrenOf(node), ctm, groupFill, nested || name === 'wps:wsp')
        }
      }
    }
    walkShapes(parsedFrag, null)
    // picture-only drawing sharing a multi-drawing paragraph: a photo box.
    // Inline pics in a paragraph that also anchors drawings stay out — they
    // flow as stray run images, keeping every box floating (overlay layout)
    if (
      opts?.pictures &&
      wspCount === 0 &&
      frag.includes('<pic:pic') &&
      (meta.anchored || !xml.includes('<wp:anchor'))
    ) {
      const rId =
        /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(frag)?.[1] ??
        /<a:blip[^>]*r:link\s*=\s*["']([^"']+)["']/.exec(frag)?.[1]
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : undefined
      const extentTag = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? ''
      const extCx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
      const extCy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extentTag)?.[1] ?? '', 10)
      if (dataUrl && Number.isFinite(extCx) && Number.isFinite(extCy)) {
        const box: TextboxDisplay = {
          paras: [],
          readOnly: true,
          fillImageDataUrl: dataUrl,
          widthPx: emuToPx(extCx),
          heightPx: emuToPx(extCy),
          insetTopPx: 0,
          insetRightPx: 0,
          insetBottomPx: 0,
          insetLeftPx: 0,
        }
        // rotation lives on the pic's own xfrm (same read as imageMeta)
        const picXfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>/.exec(frag)?.[1]
        const rot = parseInt(/\brot="(-?\d+)"/.exec(picXfrm ?? '')?.[1] ?? '', 10)
        if (Number.isFinite(rot) && rot !== 0) box.rotDeg = Math.round(rot / 60000)
        applyAnchor(box, meta, pagePos)
        out.push(box)
      }
    }
  }

  // legacy VML shapes (w:pict, outside w:drawing fragments)
  let parsed: XNode[] | null = null
  if (/<v:(?:shape|rect|roundrect|oval)\b/.test(xml)) {
    try {
      parsed = xmlParser.parse(xml) as XNode[]
    } catch {
      parsed = null
    }
  }
  if (parsed) {
    const shapeTypes: XNode[] = []
    collectNodes(parsed, 'v:shapetype', shapeTypes)
    const vmlShapeTypeAttrs = (type: string | undefined): Record<string, string> => {
      const id = type?.startsWith('#') ? type.slice(1) : undefined
      const node = id ? shapeTypes.find((t) => attrsOf(t)['id'] === id) : undefined
      return node ? attrsOf(node) : (id && ctx.vmlShapeTypes?.get(id)) || {}
    }
    const vmlShapeTypeLookup = {
      get: (id: string) => {
        const a = vmlShapeTypeAttrs(`#${id}`)
        return Object.keys(a).length > 0 ? a : undefined
      },
    }
    // shared placement: top-level absolute shapes float at their pt margins;
    // group children float at the group origin plus scaled group coordinates
    const placeVmlBox = (
      box: TextboxDisplay,
      style: string,
      scale: VmlGroupScale | null,
      origin: VmlOrigin | null,
    ): void => {
      if (!scale && /position:absolute/.test(style)) {
        box.floating = true
        const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(style)?.[1] ?? '')
        const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(style)?.[1] ?? '')
        if (Number.isFinite(mx)) box.offsetXEmu = Math.round(mx * EMU_PER_PT)
        if (Number.isFinite(my)) box.offsetYEmu = Math.round(my * EMU_PER_PT)
        if (opts?.section) applyVmlMsoPosition(box, style, opts.section)
      } else if (scale && origin) {
        box.floating = true
        box.offsetXEmu = Math.round(vmlCoordPx(style, 'left', scale, origin) * EMU_PER_PX)
        box.offsetYEmu = Math.round(vmlCoordPx(style, 'top', scale, origin) * EMU_PER_PX)
      }
    }
    // VML picture shape (v:imagedata with an r:id): a photo box, like the
    // DrawingML pushPic path — dropping it loses real page content
    const vmlPicBox = (
      shape: XNode,
      scale: VmlGroupScale | null,
      origin: VmlOrigin | null,
    ): boolean => {
      const rId = attrsOf(findChild(shape, 'v:imagedata') ?? {})['r:id']
      const dataUrl = rId ? ctx.mediaByRid?.get(rId) : undefined
      if (!dataUrl) return false
      const style = attrsOf(shape)['style'] ?? ''
      const box: TextboxDisplay = {
        paras: [],
        readOnly: true,
        fillImageDataUrl: dataUrl,
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0,
      }
      const w = vmlShapeDimPx(style, 'width', scale)
      if (w) box.widthPx = w
      const h = vmlShapeDimPx(style, 'height', scale)
      if (h) box.heightPx = h
      placeVmlBox(box, style, scale, origin)
      out.push(box)
      return true
    }
    // textless VML geometry with a visible fill or stroke (callout tabs,
    // path-drawn table backdrops): rendered, not silently dropped
    const vmlGeomBox = (
      shape: XNode,
      scale: VmlGroupScale | null,
      origin: VmlOrigin | null,
    ): void => {
      const a = attrsOf(shape)
      const style = a['style'] ?? ''
      if (a['o:hr'] === 't' || /visibility:\s*hidden/.test(style)) return
      // a picture shape (t75) whose image did not resolve draws no frame
      if (a['o:spt'] === '75' || /_x0000_t75\b/.test(a['type'] ?? '')) return
      // floating top-level shapes draw like header/footer shapes: the SVG path
      // keeps VML's default black stroke, gradients and shapetype geometry.
      // Canvas children (unitless dims) and inline shapes (run images) stay
      // on the box path below.
      const shapeXml = !scale && /position:\s*absolute/.test(style) ? serializeXNode(shape) : null
      const svg =
        shapeXml && !isInvisibleVmlPict(shapeXml) ? vmlShapeSvg(shapeXml, vmlShapeTypeLookup) : null
      if (svg) {
        const box: TextboxDisplay = {
          paras: [],
          readOnly: true,
          fillImageDataUrl: svg.dataUrl,
          widthPx: svg.widthPx,
          heightPx: svg.heightPx,
          insetTopPx: 0,
          insetRightPx: 0,
          insetBottomPx: 0,
          insetLeftPx: 0,
        }
        if (/z-index:\s*-/.test(style)) box.behind = true
        const rot = vmlRotationDeg(style)
        if (rot != null) box.rotDeg = rot
        placeVmlBox(box, style, scale, origin)
        out.push(box)
        return
      }
      const fill = a['filled'] === 'f' ? undefined : vmlColorHex(a['fillcolor'])
      // VML strokes default on/black; like the textbox path, only canvas
      // (group) children get that default — top-level shapes need an explicit
      // strokecolor so converter placeholder furniture stays invisible
      const stroke =
        a['stroked'] === 'f'
          ? undefined
          : (vmlColorHex(a['strokecolor']) ?? (scale ? '000000' : undefined))
      // white unstroked placeholders draw nothing in Word (isInvisibleVmlPict)
      if ((!fill || fill.toUpperCase() === 'FFFFFF') && !stroke) return
      const w = vmlShapeDimPx(style, 'width', scale)
      const h = vmlShapeDimPx(style, 'height', scale)
      if (!w || !h) return
      const box: TextboxDisplay = {
        paras: [],
        readOnly: true,
        widthPx: w,
        heightPx: h,
        minHeightPx: h,
        insetTopPx: 0,
        insetRightPx: 0,
        insetBottomPx: 0,
        insetLeftPx: 0,
      }
      if (fill) box.fill = fill
      if (stroke) box.borderColor = stroke
      const name = nameOf(shape)
      if (name === 'v:roundrect') box.prst = 'roundRect'
      else if (name === 'v:oval') box.prst = 'ellipse'
      const path = a['path']
      if (path) {
        const cs = /^\s*(\d+)[,\s]+(\d+)/.exec(a['coordsize'] ?? '')
        const d = cs ? vmlPathToNormD(path, parseInt(cs[1]!, 10), parseInt(cs[2]!, 10)) : undefined
        // an unconvertible path must not degrade to a solid bounding box
        if (!d) return
        box.pathData = { path: d }
      }
      placeVmlBox(box, style, scale, origin)
      out.push(box)
    }
    // Children of a v:group (drawing canvas) position/size in the group's own
    // coordinate space (unitless style values); the scale maps them to px.
    const vmlBox = (
      shape: XNode,
      scale: VmlGroupScale | null,
      origin: VmlOrigin | null,
      nested: boolean,
    ): void => {
      const shapeAttrs = attrsOf(shape)
      const style = shapeAttrs['style'] ?? ''
      const contents: XNode[] = []
      collectNodes(childrenOf(shape), 'w:txbxContent', contents)
      if (contents.length === 0) {
        const wordArt = vmlWordArtBox(shape)
        if (wordArt) {
          out.push(wordArt)
          return
        }
        // a shape nested inside some textbox's content must not escape onto
        // the page as a sibling box
        if (nested) return
        if (vmlPicBox(shape, scale, origin)) return
        vmlGeomBox(shape, scale, origin)
        return
      }
      const topContents: XNode[] = []
      collectTopNodes(childrenOf(shape), 'w:txbxContent', topContents)
      const box: TextboxDisplay = { paras: [] }
      if (!nested) {
        box.txbxIndex = txbxOrdinal
        txbxOrdinal += topContents.length
      }
      if (nested || contents.length > topContents.length) box.readOnly = true
      // VML shape: geometry from the style attribute, colors from fillcolor/strokecolor
      const w = vmlShapeDimPx(style, 'width', scale)
      if (w) box.widthPx = w
      const h = vmlShapeDimPx(style, 'height', scale)
      // mso-fit-shape-to-text: Word resizes the shape to its text, so the
      // declared height is stale and the box sizes to content like autofit
      const fitToText = /mso-fit-shape-to-text:\s*t/.test(
        attrsOf(findChild(shape, 'v:textbox') ?? {})['style'] ?? '',
      )
      if (h && !fitToText) {
        box.heightPx = h
        box.minHeightPx = h
      }
      const typeAttrs = vmlShapeTypeAttrs(shapeAttrs['type'])
      const inherited = (name: string) => shapeAttrs[name] ?? typeAttrs[name]
      const fill = vmlColorHex(inherited('fillcolor'))
      if (fill && !vmlFlagOff(inherited('filled'))) box.fill = fill
      const shapeName = nameOf(shape)
      if (shapeName === 'v:roundrect') box.prst = 'roundRect'
      else if (shapeName === 'v:oval') box.prst = 'ellipse'
      // VML strokes default to on/black (Word draws every textbox frame that
      // is not switched off on the shape, its shapetype or a v:stroke child)
      if (!vmlFlagOff(inherited('stroked')) && !vmlStrokeChildOff(shape)) {
        box.borderColor = vmlColorHex(inherited('strokecolor')) ?? '000000'
        const weight = vmlStrokeWeightPx(inherited('strokeweight'))
        if (weight !== undefined) box.borderWidthPx = weight
      }
      // absolutely positioned VML shape: leaves the flow like a wp:anchor box
      // (page banners stack at full height otherwise, tdf 1194 family).
      // Canvas (v:group) children float at their scaled group coordinates.
      placeVmlBox(box, style, scale, origin)
      for (const content of contents)
        box.paras.push(...txbxContentParas(content, ctx, opts?.docOffset))
      if (contents.some(txbxHasStructuredContent)) box.readOnly = true
      // a text-empty box still paints its ink (a filled banner shape holding
      // one blank paragraph); white unstroked placeholders stay invisible
      const inked =
        (box.fill !== undefined && box.fill.toUpperCase() !== 'FFFFFF') || !!box.borderColor
      if (box.paras.some(txbxParaVisible) || inked) out.push(box)
    }
    const walkVml = (
      nodes: XNode[],
      scale: VmlGroupScale | null,
      origin: VmlOrigin | null,
      nested = false,
    ): void => {
      for (const node of nodes) {
        const name = nameOf(node)
        if (name === 'v:group') {
          const gScale = vmlGroupScale(node, scale)
          const gAttrs = attrsOf(node)
          const gStyle = gAttrs['style'] ?? ''
          let gOrigin: VmlOrigin | null = null
          if (gScale && scale && origin) {
            // nested group: placed in the parent group's coordinate space
            gOrigin = {
              x: vmlCoordPx(gStyle, 'left', scale, origin),
              y: vmlCoordPx(gStyle, 'top', scale, origin),
            }
          } else if (gScale && /position:absolute/.test(gStyle)) {
            const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(gStyle)?.[1] ?? '')
            const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(gStyle)?.[1] ?? '')
            gOrigin = {
              x: Number.isFinite(mx) ? (mx * 96) / 72 : 0,
              y: Number.isFinite(my) ? (my * 96) / 72 : 0,
            }
          } else if (gScale && !nested) {
            // inline canvas: reserve its flow footprint so the floated
            // children overlay it instead of collapsing the paragraph
            const w = vmlShapeDimPx(gStyle, 'width', scale)
            const h = vmlShapeDimPx(gStyle, 'height', scale)
            if (w && h) {
              out.push({
                paras: [],
                readOnly: true,
                widthPx: w,
                heightPx: h,
                minHeightPx: h,
                insetTopPx: 0,
                insetRightPx: 0,
                insetBottomPx: 0,
                insetLeftPx: 0,
              })
              gOrigin = { x: 0, y: 0 }
            }
          }
          // children position from coordorigin, not 0,0 (drawing canvases)
          if (gScale && gOrigin) {
            const co = /^\s*(-?\d+)[,\s]+(-?\d+)/.exec(gAttrs['coordorigin'] ?? '')
            if (co) {
              gOrigin = {
                x: gOrigin.x - parseInt(co[1]!, 10) * gScale.sx,
                y: gOrigin.y - parseInt(co[2]!, 10) * gScale.sy,
              }
            }
          }
          walkVml(childrenOf(node), gScale ?? scale, gScale ? gOrigin : null, nested)
          continue
        }
        if (
          name === 'v:shape' ||
          name === 'v:rect' ||
          name === 'v:roundrect' ||
          name === 'v:oval'
        ) {
          vmlBox(node, scale, origin, nested)
        }
        // below a w:txbxContent = inside some box: consumes no save ordinal
        walkVml(childrenOf(node), scale, origin, nested || name === 'w:txbxContent')
      }
    }
    walkVml(parsed, null, null)
  }

  // lockedCanvas text shapes (a:txSp): DrawingML a:p/a:r/a:t text bodies inside
  // a drawing canvas (logo lockups etc.) that neither the wps nor the VML path
  // sees. Display-only, so all characters at least remain visible.
  if (hasCanvasText) {
    let parsedAll: XNode[]
    try {
      parsedAll = xmlParser.parse(xml) as XNode[]
    } catch {
      return out
    }
    const txSps: XNode[] = []
    collectNodes(parsedAll, 'a:txSp', txSps)
    for (const sp of txSps) {
      const body = findChild(sp, 'a:txBody')
      if (!body) continue
      const paras: TextboxParaDisplay[] = []
      for (const p of childrenOf(body)) {
        if (nameOf(p) !== 'a:p') continue
        const runs: Run[] = []
        for (const r of childrenOf(p)) {
          if (nameOf(r) !== 'a:r') continue
          const t = findChild(r, 'a:t')
          const text = t ? decodeNumericCharRefs(textOf(t)) : ''
          if (text === '') continue
          const run: Run = { text }
          const rPr = findChild(r, 'a:rPr')
          if (rPr) {
            const a = attrsOf(rPr)
            const sz = parseInt(a['sz'] ?? '', 10)
            // a:sz is in hundredths of a point
            if (Number.isFinite(sz) && sz > 0) run.sizeHalfPoints = Math.round(sz / 50)
            if (a['b'] === '1') run.bold = true
            const latin = attrsOf(findChild(rPr, 'a:latin') ?? {})['typeface']
            if (latin && !latin.startsWith('+')) run.font = latin
          }
          runs.push(run)
        }
        if (runs.length > 0) {
          const algn = attrsOf(findChild(p, 'a:pPr') ?? {})['algn']
          paras.push({
            runs,
            ...(algn === 'ctr' ? { align: 'center' as const } : {}),
          })
        }
      }
      if (paras.length > 0) out.push({ paras, readOnly: true })
    }
  }
  return out
}
