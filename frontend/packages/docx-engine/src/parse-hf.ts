// Header/footer part domain: part reading, display content (paragraphs, layout
// tables, images, watermarks, textboxes) and the anchor/docPr binding tables.

import JSZip from 'jszip'
import { parseCustGeom } from '@yiioffice/pptx-engine/custgeom'
import { hfReferenceRId, hfReferenceTags, hfReferenceType } from './section'
import {
  PAGE_MARK,
  TOTAL_PAGES_MARK,
  type DocDefaults,
  type NoteInfo,
  type NoteProps,
  type HfImage,
  type PictureWatermarkInfo,
  type HfTextBox,
  type HfParagraph,
  type HfTableCell,
  type HfTableRow,
  type HfPartInfo,
  type ParaFormat,
  type CellBorder,
  type CellBorders,
  type Run,
  type StyleInfo,
  type TableStyleDisplay,
  type TableBorders,
  type ThemeColors,
  type ThemeFonts,
} from './types'
import {
  isPictureWatermarkShape,
  readPictureWatermark,
  readWatermarkShape,
  readWatermarkText,
} from './watermark'
import {
  attrsOf,
  boolProp,
  childrenOf,
  childrenThroughSdt,
  findChild,
  findChildren,
  nameOf,
  serializeXNode,
  xmlParser,
  type XNode,
} from './xml-utils'
import {
  EMU_PER_PX,
  plainText,
  stripHash,
  type RelInfo,
} from './parse-xml-text'
import {
  cellMarginsOf,
  collectNodes,
  emptyParaSizeHalfPoints,
  mergeStyleBorders,
  mergedBorderLinesOf,
} from './parse-props'
import { parseRels, resolveRelationshipTargetPath } from './parse-package'
import {
  anchorRelH,
  anchorRelV,
  vmlFloatAnchor,
  vmlFraction,
  vmlRotationDeg,
  vmlShapeSvg,
  vmlStyleDimPx,
} from './parse-vml'
import { type BuildContext, emuToPx } from './parse-shared'
import { mediaDataUrl } from './parse-rels'
import { rectFrac } from './parse-images'
import { extractParaFormat, extractRuns } from './parse-paragraph'

export const ANCHOR_HOSTS = new Set(['w:drawing', 'w:pict'])
const TXBX_CONTENT = new Set(['w:txbxContent'])
const WP_INLINE = new Set(['wp:inline'])
const WP_ANCHOR = new Set(['wp:anchor'])
/** wp:docPr ids of the anchored drawings in a layout-table row / on a cell-run image (binds HfImage.anchorPara) */
const hfRowAnchorIds = new WeakMap<HfParagraph, string[]>()
const hfImageAnchorId = new WeakMap<HfImage, string>()
/** wp:docPr ids of inline pictures kept on a text paragraph's runs (not in the part image list) */
const hfRunImageIds = new WeakMap<HfParagraph[], Set<string>>()
function anchorDocPrIds(node: XNode): string[] {
  const anchors: XNode[] = []
  collectNodes(childrenOf(node), 'wp:anchor', anchors)
  return anchors.flatMap((a) => attrsOf(findChild(a, 'wp:docPr') ?? {})['id'] ?? [])
}

/** depth-first search for any descendant with one of the given names */
export function hasDeepChild(node: XNode, names: Set<string>): boolean {
  return hasDeepChildOutside(node, names)
}

/** any descendant floating VML picture shape (watermarks): drawn at its anchor,
 *  never in the flow. Textbox shapes are excluded: their own content decides. */
function hasFloatingVmlPicture(node: XNode): boolean {
  for (const child of childrenOf(node)) {
    const name = nameOf(child)
    if (
      name?.startsWith('v:') &&
      /position:\s*absolute/.test(attrsOf(child)['style'] ?? '') &&
      !hasDeepChild(child, TXBX_CONTENT)
    ) {
      return true
    }
    if (hasFloatingVmlPicture(child)) return true
  }
  return false
}

/** like hasDeepChild, but does not descend into `skip` subtrees (e.g. textbox content) */
function hasDeepChildOutside(node: XNode, names: Set<string>, skip?: Set<string>): boolean {
  for (const child of childrenOf(node)) {
    const name = nameOf(child)
    if (name && names.has(name)) return true
    if (name && skip?.has(name)) continue
    if (hasDeepChildOutside(child, names, skip)) return true
  }
  return false
}

export function hfPartInfo(
  part: { text: string; hasPageNumber: boolean; paras: HfParagraph[]; images?: HfImage[] } | null,
): HfPartInfo | null {
  if (!part) return null
  return {
    text: part.text,
    hasPageNumber: part.hasPageNumber,
    paras: part.paras,
    ...(part.images?.length ? { images: part.images } : {}),
  }
}

/**
 * display-only images of a header/footer part (logos etc.): resolves a:blip r:embed
 * and VML v:imagedata r:id from the part's own rels; watermarks (v:textpath) excluded.
 * The save path does not go through here -- image paragraphs keep their original bytes
 * when the part is regenerated.
 */
/** cell-run anchors: bind each image to the strip row holding its anchor (HfImage.anchorPara) */
function bindHfImageAnchors(images: HfImage[], paras: HfParagraph[]): HfImage[] {
  for (const image of images) {
    const id = hfImageAnchorId.get(image)
    if (!id) continue
    const at = paras.findIndex((p) => hfRowAnchorIds.get(p)?.includes(id))
    if (at >= 0) image.anchorPara = at
  }
  return images
}

async function hfImages(
  zip: JSZip,
  partPath: string,
  partXml: string,
  paras?: HfParagraph[],
): Promise<HfImage[]> {
  if (
    !partXml.includes('<a:blip') &&
    !partXml.includes('<wps:wsp') &&
    !/<w:pict[\s>]/.test(partXml)
  ) {
    return []
  }
  const relsPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const rels = await parseRels(zip, relsPath)
  // inline pictures in layout tables (nested ones included) live on their cell
  // runs (hfTableRowParagraphs); floating ones still position through this
  // part-level list
  const tbls = hfTblRanges(partXml)
  const onCellRun = (at: number) => tbls.some(([s, e]) => at > s && at < e)
  const runImageIds = paras ? hfRunImageIds.get(paras) : undefined
  const onTextRun = (frag: string) => {
    const id = /<wp:docPr\s[^>]*\bid="([^"]+)"/.exec(frag)?.[1]
    return id != null && !!runImageIds?.has(id)
  }
  // mc:AlternateContent: the Choice is authoritative; its Fallback re-emits the
  // same picture (an anchored logo shape falls back to an inline copy), doubling
  // the drawn image and inflating the strip's reserved height (prod100r4/43).
  // Fallback content only counts when nothing in the same block's Choice
  // resolved (mac Word PDF Choice + PNG Fallback keeps working: those blips
  // share one w:drawing and are tried in order above).
  const acs = Array.from(
    partXml.matchAll(/<mc:AlternateContent[\s>][\s\S]*?<\/mc:AlternateContent>/g),
    (m) => {
      const fb = /<mc:Fallback>[\s\S]*?<\/mc:Fallback>/.exec(m[0])
      return {
        start: m.index!,
        end: m.index! + m[0].length,
        fbStart: fb ? m.index! + fb.index : -1,
        fbEnd: fb ? m.index! + fb.index + fb[0].length : -1,
      }
    },
  )
  const acAt = (at: number) => acs.findIndex((a) => at > a.start && at < a.end)
  const inFallbackOf = (at: number) => acs.findIndex((a) => at > a.fbStart && at < a.fbEnd)
  const choiceProduced = new Set<number>()
  /** true = skip this match (its Choice sibling already produced an image) */
  const fallbackDup = (at: number): boolean => {
    const fb = inFallbackOf(at)
    return fb >= 0 && choiceProduced.has(fb)
  }
  const recordProduced = (at: number) => {
    const ac = acAt(at)
    if (ac >= 0 && inFallbackOf(at) < 0) choiceProduced.add(ac)
  }
  const out: HfImage[] = []
  /** w:jc of the paragraph containing offset `at` (inline images follow it) */
  const paraAlignAt = (at: number): HfImage['align'] => {
    const pStart = Math.max(partXml.lastIndexOf('<w:p ', at), partXml.lastIndexOf('<w:p>', at))
    if (pStart < 0) return undefined
    const jc = /<w:jc w:val="(\w+)"/.exec(partXml.slice(pStart, at))?.[1]
    return jc === 'left' || jc === 'center' || jc === 'right' ? jc : undefined
  }
  for (const m of partXml.matchAll(/<w:drawing[\s>][\s\S]*?<\/w:drawing>/g)) {
    const frag = m[0]
    if (fallbackDup(m.index!)) continue
    if (!/<wp:anchor[\s>]/.test(frag) && onCellRun(m.index!)) continue
    if (!/<wp:anchor[\s>]/.test(frag) && onTextRun(frag)) continue
    if (/<wp:anchor[\s>]/.test(frag) && frag.includes('<wpg:wgp')) {
      const children = await hfGroupPictures(zip, rels, frag, partPath)
      if (children) {
        out.push(...children)
        recordProduced(m.index!)
        continue
      }
    }
    // mc:AlternateContent may hold several blips (mac Word: PDF Choice + PNG
    // Fallback); use the first one whose media resolves
    let dataUrl: string | null = null
    for (const b of frag.matchAll(/<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/g)) {
      dataUrl = await mediaDataUrl(zip, rels, b[1], partPath)
      if (dataUrl) break
    }
    // textless vector decorations (wpg group of custGeom shapes) render as one SVG
    if (!dataUrl) dataUrl = hfShapeDrawingSvg(frag)
    if (!dataUrl) continue
    const image: HfImage = { dataUrl }
    const extent = /<wp:extent[^>]*\/?>/.exec(frag)?.[0] ?? ''
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? '', 10)
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? '', 10)
    if (Number.isFinite(cx) && cx > 0) image.widthPx = emuToPx(cx)
    if (Number.isFinite(cy) && cy > 0) image.heightPx = emuToPx(cy)
    // a:srcRect source crop: two same-image anchors cropped to different
    // regions read as duplicated pictures without it (prod100r1 sample 90)
    const srcRect = /<a:srcRect\s[^>]*\/>/.exec(frag)?.[0]
    if (srcRect) {
      const crop = {
        l: rectFrac(srcRect, 'l'),
        t: rectFrac(srcRect, 't'),
        r: rectFrac(srcRect, 'r'),
        b: rectFrac(srcRect, 'b'),
      }
      if (crop.l || crop.t || crop.r || crop.b) image.crop = crop
    }
    if (/<wp:anchor[\s>]/.test(frag)) {
      image.floating = true
      const anchorTag = /<wp:anchor[^>]*>/.exec(frag)?.[0] ?? ''
      if (/behindDoc="(?:1|true)"/.test(anchorTag)) image.behind = true
      const wrap = /<wp:wrap(None|Square|Tight|Through|TopAndBottom)[\s/>]/.exec(frag)?.[1]
      if (wrap) {
        image.wrap = wrap === 'TopAndBottom' ? 'topBottom' : (wrap.toLowerCase() as HfImage['wrap'])
      }
      readAnchorPos(frag, image)
      // inside a layout-table cell, column/margin offsets measure from that cell's text column
      if (image.posXPx != null && image.posHRel === 'margin' && onCellRun(m.index!)) {
        image.posXPx += hfCellColumnLeftPx(partXml, m.index!)
      }
      if (image.posVRel === 'paragraph' && image.posYPx != null && onCellRun(m.index!)) {
        const id = /<wp:docPr\s[^>]*\bid="([^"]+)"/.exec(frag)?.[1]
        if (id) hfImageAnchorId.set(image, id)
      }
    } else {
      const align = paraAlignAt(m.index!)
      if (align) image.align = align
    }
    recordProduced(m.index!)
    out.push(image)
  }
  for (const m of partXml.matchAll(/<w:pict[\s>][\s\S]*?<\/w:pict>/g)) {
    const frag = m[0]
    if (fallbackDup(m.index!)) continue
    if (frag.includes('<v:textpath')) {
      const wm = readWatermarkShape(frag)
      if (wm) {
        recordProduced(m.index!)
        out.push(wm)
      }
      continue
    }
    if (!/position:\s*absolute/.test(frag) && onCellRun(m.index!)) continue
    const rId = /<v:imagedata[^>]*r:id="([^"]+)"/.exec(frag)?.[1]
    if (!rId) {
      // textless vector shape (mc:Fallback twin of a wps shape the Choice
      // path could not draw, or a plain VML decoration)
      const shape = vmlShapeSvg(frag)
      if (!shape || !/position:\s*absolute/.test(shape.style)) continue
      const image: HfImage = {
        dataUrl: shape.dataUrl,
        widthPx: shape.widthPx,
        heightPx: shape.heightPx,
        floating: true,
      }
      if (/z-index:\s*-/.test(shape.style)) image.behind = true
      const rot = vmlRotationDeg(shape.style)
      if (rot != null) image.rotationDeg = rot
      vmlFloatAnchor(shape.style, image)
      recordProduced(m.index!)
      out.push(image)
      continue
    }
    const dataUrl = await mediaDataUrl(zip, rels, rId, partPath)
    if (!dataUrl) continue
    // VML dimensions live in the v:shape style attribute (pt, in, cm...)
    const style = /<v:shape[^>]*style="([^"]*)"/.exec(frag)?.[1] ?? ''
    const image: HfImage = { dataUrl }
    const w = vmlStyleDimPx(style, 'width')
    const h = vmlStyleDimPx(style, 'height')
    if (w) image.widthPx = w
    if (h) image.heightPx = h
    // absolute-positioned shapes (picture watermarks): must not stack into the
    // header strip nor count toward the header height estimate
    if (/position:absolute/.test(style)) {
      image.floating = true
      if (/z-index:\s*-/.test(style)) image.behind = true
      if (isPictureWatermarkShape(frag)) image.watermark = true
      const rot = vmlRotationDeg(style)
      if (rot != null) image.rotationDeg = rot
      vmlFloatAnchor(style, image)
    } else {
      const align = paraAlignAt(m.index!)
      if (align) image.align = align
    }
    const imagedata = /<v:imagedata[^>]*>/.exec(frag)?.[0] ?? ''
    const gain = vmlFraction(/\sgain="([^"]*)"/.exec(imagedata)?.[1])
    const blackLevel = vmlFraction(/\sblacklevel="([^"]*)"/.exec(imagedata)?.[1])
    if (gain != null || blackLevel != null) {
      image.washout = { gain: gain ?? 1, blackLevel: blackLevel ?? 0 }
    }
    recordProduced(m.index!)
    out.push(image)
  }
  return out
}

/** wp:anchor wp:positionH/V of a header/footer image: wp:align keeps the VML-style
 *  alignment fields, wp:posOffset (EMU) becomes a px offset from the page edge or
 *  margin box (horizontal paragraph/column/character origins approximate to margin;
 *  vertical paragraph/line keeps 'paragraph' so body push-down can measure from the
 *  header strip top). */
function readAnchorPos(
  frag: string,
  image: Pick<HfImage, 'posH' | 'posV' | 'posXPx' | 'posYPx' | 'posHRel' | 'posVRel'>,
): void {
  for (const axis of ['H', 'V'] as const) {
    const m = new RegExp(
      `<wp:position${axis}[^>]*relativeFrom="([^"]+)"[^>]*>([\\s\\S]*?)</wp:position${axis}>`,
    ).exec(frag)
    if (!m) continue
    const align = /<wp:align>(\w+)<\/wp:align>/.exec(m[2])?.[1]
    const offset = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(m[2])?.[1]
    if (align) {
      if (axis === 'H' && (align === 'left' || align === 'center' || align === 'right')) {
        image.posH = align
        image.posHRel = anchorRelH(m[1])
      }
      if (axis === 'V' && (align === 'top' || align === 'center' || align === 'bottom')) {
        image.posV = align
        image.posVRel = anchorRelV(m[1])
      }
    } else if (offset != null) {
      const px = Math.round(Number(offset) / EMU_PER_PX)
      if (axis === 'H') {
        image.posXPx = px
        image.posHRel = anchorRelH(m[1])
      } else {
        image.posYPx = px
        image.posVRel = anchorRelV(m[1])
      }
    }
  }
}

/**
 * Anchored wpg group of pictures (logo strips): one HfImage per child picture
 * at its own mapped offset, size and a:srcRect crop. Reading the group as one
 * image stretched the first (cropped) picture over the whole group extent.
 * Null (caller falls back to the single-image path) unless the anchor uses
 * posOffset on both axes and every child picture has a plain xfrm.
 */
async function hfGroupPictures(
  zip: JSZip,
  rels: Map<string, RelInfo>,
  frag: string,
  sourcePath = 'word/document.xml',
): Promise<HfImage[] | null> {
  const body = frag.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
  const anchor: Pick<HfImage, 'posH' | 'posV' | 'posXPx' | 'posYPx' | 'posHRel' | 'posVRel'> = {}
  readAnchorPos(body, anchor)
  if (anchor.posXPx == null || anchor.posYPx == null) return null
  const attrNum = (tag: string, key: string): number | null => {
    // Either quote style and whitespace around `=` are legal XML; a
    // double-quote-only pattern silently drops the whole shape on single-quoted
    // attributes (the same document Word writes when it round-trips VML).
    const v = new RegExp(`${key}\\s*=\\s*["'](-?\\d+)["']`).exec(tag)?.[1]
    return v == null ? null : parseInt(v, 10)
  }
  const grpXfrm = /<wpg:grpSpPr[^>]*>[\s\S]*?<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(body)?.[1]
  if (!grpXfrm) return null
  const el = (name: string) => new RegExp(`<a:${name}[^>]*/>`).exec(grpXfrm)?.[0] ?? ''
  const ext = { x: attrNum(el('ext'), 'cx') ?? 0, y: attrNum(el('ext'), 'cy') ?? 0 }
  const chExt = { x: attrNum(el('chExt'), 'cx') ?? 0, y: attrNum(el('chExt'), 'cy') ?? 0 }
  const sx = ext.x > 0 && chExt.x > 0 ? ext.x / chExt.x : 1
  const sy = ext.y > 0 && chExt.y > 0 ? ext.y / chExt.y : 1
  const tx = (attrNum(el('off'), 'x') ?? 0) - (attrNum(el('chOff'), 'x') ?? 0) * sx
  const ty = (attrNum(el('off'), 'y') ?? 0) - (attrNum(el('chOff'), 'y') ?? 0) * sy
  const anchorTag = /<wp:anchor[^>]*>/.exec(body)?.[0] ?? ''
  const behind = /behindDoc="(?:1|true)"/.test(anchorTag)
  const wrap = /<wp:wrap(None|Square|Tight|Through|TopAndBottom)[\s/>]/.exec(body)?.[1]
  const out: HfImage[] = []
  for (const pm of body.matchAll(/<pic:pic[\s>][\s\S]*?<\/pic:pic>/g)) {
    const pic = pm[0]
    const xfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>([\s\S]*?)<\/a:xfrm>/.exec(pic)
    if (!xfrm || /\brot="-?[1-9]/.test(xfrm[1])) return null
    const off = /<a:off[^>]*\/>/.exec(xfrm[2])?.[0] ?? ''
    const size = /<a:ext[^>]*\/>/.exec(xfrm[2])?.[0] ?? ''
    const cx = (attrNum(size, 'cx') ?? 0) * sx
    const cy = (attrNum(size, 'cy') ?? 0) * sy
    if (cx <= 0 || cy <= 0) return null
    const rId = /<a:blip[^>]*r:embed\s*=\s*["']([^"']+)["']/.exec(pic)?.[1]
    const dataUrl = rId ? await mediaDataUrl(zip, rels, rId, sourcePath) : null
    if (!dataUrl) continue
    const image: HfImage = {
      dataUrl,
      widthPx: emuToPx(cx),
      heightPx: emuToPx(cy),
      floating: true,
      posXPx: anchor.posXPx + Math.round(((attrNum(off, 'x') ?? 0) * sx + tx) / EMU_PER_PX),
      posYPx: anchor.posYPx + Math.round(((attrNum(off, 'y') ?? 0) * sy + ty) / EMU_PER_PX),
      posHRel: anchor.posHRel,
      posVRel: anchor.posVRel,
    }
    if (behind) image.behind = true
    if (wrap) {
      image.wrap = wrap === 'TopAndBottom' ? 'topBottom' : (wrap.toLowerCase() as HfImage['wrap'])
    }
    const srcRect = /<a:srcRect\s[^>]*\/>/.exec(pic)?.[0]
    if (srcRect) {
      const crop = {
        l: rectFrac(srcRect, 'l'),
        t: rectFrac(srcRect, 't'),
        r: rectFrac(srcRect, 'r'),
        b: rectFrac(srcRect, 'b'),
      }
      if (crop.l || crop.t || crop.r || crop.b) image.crop = crop
    }
    out.push(image)
  }
  return out.length > 0 ? out : null
}

/**
 * Textless vector decoration in a header/footer drawing (wpg group of solid-fill
 * custGeom wps shapes, e.g. corner ornament groups) composed into one SVG data
 * URL at the wp:extent size. Bails (null) on any unsupported piece — rotation,
 * flips, text content, missing fill/geometry — so partial art never renders.
 */
function hfShapeDrawingSvg(frag: string): string | null {
  if (!frag.includes('<wps:wsp') || frag.includes('<w:txbxContent')) return null
  // Word pairs DrawingML shapes with a VML twin in mc:Fallback
  const body = frag.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
  const attrNum = (tag: string, key: string): number | null => {
    // Either quote style and whitespace around `=` are legal XML; a
    // double-quote-only pattern silently drops the whole shape on single-quoted
    // attributes (the same document Word writes when it round-trips VML).
    const v = new RegExp(`${key}\\s*=\\s*["'](-?\\d+)["']`).exec(tag)?.[1]
    return v == null ? null : parseInt(v, 10)
  }
  const extent = /<wp:extent[^>]*\/?>/.exec(body)?.[0] ?? ''
  const extCx = attrNum(extent, 'cx') ?? 0
  const extCy = attrNum(extent, 'cy') ?? 0
  if (extCx <= 0 || extCy <= 0) return null
  if (/rot="-?[1-9]|flipH="(?:1|true)"|flipV="(?:1|true)"/.test(body)) return null
  // group child space -> drawing space (wpg:grpSpPr a:xfrm)
  let sx = 1
  let sy = 1
  let tx = 0
  let ty = 0
  const grpXfrm = /<wpg:grpSpPr[^>]*>[\s\S]*?<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(body)?.[1]
  if (grpXfrm) {
    const el = (name: string) => new RegExp(`<a:${name}[^>]*/>`).exec(grpXfrm)?.[0] ?? ''
    const ext = { x: attrNum(el('ext'), 'cx') ?? 0, y: attrNum(el('ext'), 'cy') ?? 0 }
    const chExt = { x: attrNum(el('chExt'), 'cx') ?? 0, y: attrNum(el('chExt'), 'cy') ?? 0 }
    sx = ext.x > 0 && chExt.x > 0 ? ext.x / chExt.x : 1
    sy = ext.y > 0 && chExt.y > 0 ? ext.y / chExt.y : 1
    const off = { x: attrNum(el('off'), 'x') ?? 0, y: attrNum(el('off'), 'y') ?? 0 }
    const chOff = { x: attrNum(el('chOff'), 'x') ?? 0, y: attrNum(el('chOff'), 'y') ?? 0 }
    tx = off.x - chOff.x * sx
    ty = off.y - chOff.y * sy
  }
  const px = (emu: number) => Math.round((emu / EMU_PER_PX) * 100) / 100
  /** normalized 0..1 path tokens -> px path inside the shape's rect */
  const placePath = (d: string, x: number, y: number, w: number, h: number): string => {
    let axis = 0
    return d
      .split(' ')
      .map((tok) => {
        const n = Number(tok)
        if (!Number.isFinite(n)) {
          axis = 0
          return tok
        }
        return String(
          axis++ % 2 === 0
            ? Math.round((x + n * w) * 100) / 100
            : Math.round((y + n * h) * 100) / 100,
        )
      })
      .join(' ')
  }
  const paths: string[] = []
  for (const s of body.matchAll(/<wps:wsp[\s>][\s\S]*?<\/wps:wsp>/g)) {
    const wsp = s[0]
    const spPr = /<wps:spPr[\s\S]*?<\/wps:spPr>/.exec(wsp)?.[0] ?? ''
    const xfrm = /<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/.exec(spPr)?.[0] ?? ''
    const off = /<a:off[^>]*\/>/.exec(xfrm)?.[0] ?? ''
    const ext = /<a:ext[^>]*\/>/.exec(xfrm)?.[0] ?? ''
    const cx = attrNum(ext, 'cx') ?? 0
    const cy = attrNum(ext, 'cy') ?? 0
    if (cx <= 0 || cy <= 0) return null
    const fill = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(spPr)?.[1]
    if (!fill) return null
    const geom = parseCustGeom(wsp, cx, cy)
    const d = [geom?.path, geom?.fillPath].filter(Boolean).join(' ')
    if (!d) return null
    const x = px((attrNum(off, 'x') ?? 0) * sx + tx)
    const y = px((attrNum(off, 'y') ?? 0) * sy + ty)
    paths.push(`<path d="${placePath(d, x, y, px(cx * sx), px(cy * sy))}" fill="#${fill}"/>`)
  }
  if (paths.length === 0) return null
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px(extCx)} ${px(extCy)}">` +
    paths.join('') +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** [start, end) spans of top-level w:tbl elements (nesting-aware) */
/**
 * Tracked deletions in a header/footer part leave the strip as in Word's
 * markup views (a deleted logo run no longer pushes the body down); the save
 * path keeps the part's original bytes. The Original view is not restored.
 */
function stripHfDeletions(xml: string): string {
  if (!/<w:(?:del|moveFrom)[\s>]/.test(xml)) return xml
  return xml.replace(/<w:(del|moveFrom)(?=[\s>])(?:[^>/]|\/(?!>))*>[\s\S]*?<\/w:\1>/g, '')
}

function hfTblRanges(xml: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /<w:tbl[\s>]|<\/w:tbl>/g
  let depth = 0
  let start = 0
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0] === '</w:tbl>') {
      if (depth > 0 && --depth === 0) out.push([start, m.index + m[0].length])
    } else {
      if (depth === 0) start = m.index
      depth++
    }
  }
  return out
}

/** px from the margin to the text column of the table cell holding offset `at`:
 *  w:tblInd plus the grid columns of the cells before it in its row (the
 *  border sits a cell margin left of the text, which cancels the cell's own
 *  left margin; nested tables in earlier cells are skipped) */
function hfCellColumnLeftPx(xml: string, at: number): number {
  // innermost table still open at `at`, with its first row and the row holding `at`
  const open: Array<{ start: number; firstRow: number; row: number }> = []
  const re = /<w:tbl[\s>]|<\/w:tbl>|<w:tr[\s>]/g
  for (let m = re.exec(xml); m && m.index < at; m = re.exec(xml)) {
    if (m[0] === '</w:tbl>') open.pop()
    else if (m[0].startsWith('<w:tbl')) open.push({ start: m.index, firstRow: -1, row: -1 })
    else if (open.length > 0) {
      const t = open[open.length - 1]
      if (t.firstRow < 0) t.firstRow = m.index
      t.row = m.index
    }
  }
  const tbl = open[open.length - 1]
  if (!tbl || tbl.row < 0) return 0
  const { start: tblStart, row: rowStart } = tbl
  const head = xml.slice(tblStart, tbl.firstRow)
  const tblInd =
    parseInt(/<w:tblInd\b[^>]*\bw:w\s*=\s*["'](-?\d+)["']/.exec(head)?.[1] ?? '0', 10) || 0
  const grid = Array.from(
    (/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(head)?.[1] ?? '').matchAll(
      /<w:gridCol\b[^>]*\bw:w\s*=\s*["'](\d+)["']/g,
    ),
    (g) => parseInt(g[1], 10),
  )
  const before = xml.slice(rowStart, at).replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g, '')
  let cols = 0
  const cells = Array.from(before.matchAll(/<w:tc[\s>]([\s\S]*?)(?=<w:p[\s>]|<w:tc[\s>]|$)/g))
  for (const cell of cells.slice(0, -1)) {
    cols +=
      parseInt(/<w:gridSpan\b[^>]*\bw:val\s*=\s*["'](\d+)["']/.exec(cell[1])?.[1] ?? '1', 10) || 1
  }
  const twips = tblInd + grid.slice(0, cols).reduce((a, b) => a + b, 0)
  return Math.round(twips / 15)
}

/** Pre-resolved image media (rId -> data/external URL) for pictures inside a
 *  header/footer part's layout tables, so the sync cell-run extraction can
 *  attach them (mirrors tableBlipMedia). */
async function hfTableMedia(
  zip: JSZip,
  partPath: string,
  partXml: string,
): Promise<Map<string, string> | undefined> {
  if (!partXml.includes('<w:tbl') && !partXml.includes('<wp:inline')) return undefined
  if (!partXml.includes('<a:blip') && !partXml.includes('<v:imagedata')) return undefined
  const rels = await parseRels(zip, partPath.replace(/([^/]+)$/, '_rels/$1.rels'))
  const out = new Map<string, string>()
  // inline pictures sharing a text paragraph become run images too, so a part
  // without tables still needs its media
  const ranges = partXml.includes('<w:tbl') ? hfTblRanges(partXml) : []
  if (partXml.includes('<wp:inline')) ranges.push([0, partXml.length])
  for (const [start, end] of ranges) {
    const slice = partXml.slice(start, end)
    const refs = [
      ...slice.matchAll(/<a:blip[^>]*r:(?:embed|link)\s*=\s*["']([^"']+)["']/g),
      ...slice.matchAll(/<v:imagedata[^>]*r:id\s*=\s*["']([^"']+)["']/g),
    ]
    for (const m of refs) {
      const rId = m[1]
      if (out.has(rId)) continue
      const rel = rels.get(rId)
      if (!rel) continue
      if (rel.targetMode === 'External' || /^https?:\/\//i.test(rel.target)) {
        out.set(rId, rel.target)
        continue
      }
      const dataUrl = await mediaDataUrl(zip, rels, rId, partPath)
      if (dataUrl) out.set(rId, dataUrl)
    }
  }
  return out.size > 0 ? out : undefined
}

/**
 * Display numbers for note reference markers: Word counts references in body
 * order from numStart, restarting per section when numRestart=eachSect (a
 * section-break paragraph's own references still belong to the section it
 * closes; nested paragraphs in textboxes do not end it). A note is numbered
 * at its first reference; later references reuse it. Notes never referenced
 * in the body keep their part-order number; references to a missing note are
 * not counted. eachPage cannot be resolved before pagination and counts as
 * continuous.
 */
export function noteNumbersOf(
  documentXml: string,
  footnotes: NoteInfo[],
  endnotes: NoteInfo[],
  footnoteProps?: NoteProps,
  endnoteProps?: NoteProps,
): Map<string, number> {
  const out = new Map<string, number>()
  footnotes.forEach((n, i) => out.set(`footnote:${n.id}`, i + 1))
  endnotes.forEach((n, i) => out.set(`endnote:${n.id}`, i + 1))
  const props = { footnote: footnoteProps, endnote: endnoteProps }
  const count = { footnote: 0, endnote: 0 }
  const numbered = new Set<string>()
  let depth = 0
  let sectDepth = -1
  const re =
    /<w:(footnote|endnote)Reference\b([^>]*?)\/?>|<w:sectPr[\s>]|<w:p(?:\s[^>]*)?\/?>|<\/w:p>/g
  for (const m of documentXml.matchAll(re)) {
    if (m[0].startsWith('<w:sectPr')) {
      sectDepth = depth
      continue
    }
    if (m[0].startsWith('<w:p')) {
      if (!m[0].endsWith('/>')) depth++
      continue
    }
    if (m[0] === '</w:p>') {
      depth--
      if (sectDepth > depth) {
        sectDepth = -1
        for (const kind of ['footnote', 'endnote'] as const) {
          if (props[kind]?.numRestart === 'eachSect') count[kind] = 0
        }
      }
      continue
    }
    const kind = m[1] as 'footnote' | 'endnote'
    if (/w:customMarkFollows="(?:1|true)"/.test(m[2])) continue
    const id = /w:id="([^"]+)"/.exec(m[2])?.[1]
    const key = `${kind}:${id}`
    if (!id || !out.has(key) || numbered.has(key)) continue
    numbered.add(key)
    out.set(key, (props[kind]?.numStart ?? 1) + count[kind]++)
  }
  return out
}

/** header/footer part XML -> display content (PAGE fields shown as PAGE_MARK) */
function hfContentFromXml(
  xml: string,
  kind: 'header' | 'footer',
  theme?: ThemeColors | null,
  styles?: Map<string, StyleInfo>,
  tableMedia?: Map<string, string>,
  compatibilityMode = 0,
  themeFonts?: ThemeFonts | null,
  docDefaults?: DocDefaults,
): {
  text: string
  hasPageNumber: boolean
  watermark: string | null
  watermarkPicture: PictureWatermarkInfo | null
  paras: HfParagraph[]
} {
  // Rewrite each field span (begin..end) for display. PAGE and NUMPAGES become
  // private-use markers (the renderer substitutes real numbers; a literal '#'
  // in the part text must never be mistaken for the field), dropping their
  // stale cached results; other fields (DATE, STYLEREF, ...) keep their cached
  // result runs (Word refreshes them on open). fldChar attribute matching is
  // tolerant (Pages writes w:fldLock="0" etc.; LibreOffice writes the begin
  // marker as an empty element pair, not self-closing).
  // hasPageNumber is set by the same match that emits PAGE_MARK, so the two
  // can't drift (Word may split "PAGE" across several instrText runs).
  let hasPageNumber = false
  // mc:AlternateContent carries the same textbox twice (DrawingML Choice + VML
  // Fallback); keeping both prints the content twice (e.g. duplicated "— PAGE —"
  // page numbers), so only the Choice branch feeds text/paragraph extraction
  let cleaned = xml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
  cleaned = cleaned.replace(
    /<w:fldChar[^>]*w:fldCharType\s*=\s*["']begin["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)[\s\S]*?<w:fldChar[^>]*w:fldCharType\s*=\s*["']end["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)/g,
    (span) => {
      const instr = (span.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) ?? [])
        .map((m) => m.replace(/<[^>]+>/g, ''))
        .join('')
      const cached =
        /<w:fldChar[^>]*w:fldCharType\s*=\s*["']separate["'][^>]*?(?:\/>|>\s*<\/w:fldChar>)([\s\S]*)$/.exec(
          span,
        )?.[1]
      // Word formats the number with the result run's rPr; the separate run's
      // rPr (first in the span) is only the field-code formatting
      const resultRun = cached
        ?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)
        ?.find((run) => run.includes('<w:t'))
      const rPr =
        (resultRun && /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(resultRun)?.[0]) ||
        (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(span)?.[0] ?? '')
      // the span starts inside the begin run and ends inside the end run, so
      // the replacement closes/reopens the enclosing w:r to stay balanced
      // (the leftover edge runs end up empty and are dropped later)
      const emit = (inner: string) => `</w:r>${inner}<w:r>`
      if (/\bNUMPAGES\b/.test(instr)) {
        return emit(`<w:r>${rPr}<w:t>${TOTAL_PAGES_MARK}</w:t></w:r>`)
      }
      if (/\bPAGE\b/.test(instr)) {
        hasPageNumber = true
        return emit(`<w:r>${rPr}<w:t>${PAGE_MARK}</w:t></w:r>`)
      }
      // complete result runs between separate and end (partial run fragments at the edges drop out)
      return emit(
        (cached?.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? [])
          .filter((run) => run.includes('<w:t'))
          .join(''),
      )
    },
  )
  // <w:fldSimple w:instr=" PAGE "> single-element field form
  cleaned = cleaned.replace(
    /<w:fldSimple[^>]*w:instr\s*=\s*["']([^"']*)["'][^>]*(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g,
    (whole, instr: string, inner: string | undefined) => {
      const rPr = inner ? (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? '') : ''
      if (/\bNUMPAGES\b/.test(instr)) return `<w:r>${rPr}<w:t>${TOTAL_PAGES_MARK}</w:t></w:r>`
      if (/\bPAGE\b/.test(instr)) {
        hasPageNumber = true
        return `<w:r>${rPr}<w:t>${PAGE_MARK}</w:t></w:r>`
      }
      return inner ?? whole
    },
  )
  // legacy <w:pgNum/> run element (pre-field page number) renders as a PAGE field
  cleaned = cleaned.replace(/<w:pgNum\s*\/>/g, () => {
    hasPageNumber = true
    return `<w:t>${PAGE_MARK}</w:t>`
  })
  return {
    text: plainText(cleaned),
    hasPageNumber,
    watermark: kind === 'header' ? readWatermarkText(xml) : null,
    watermarkPicture: kind === 'header' ? readPictureWatermark(xml) : null,
    // strip leftover field chars so the page marker parses as plain text
    paras: hfParagraphs(
      cleaned.replace(/<w:fldChar[^>]*?(?:\/>|>\s*<\/w:fldChar>)/g, ''),
      theme,
      styles,
      tableMedia,
      compatibilityMode,
      themeFonts,
      docDefaults,
    ),
  }
}

/** Plain-text content of a header/footer part referenced by any sectPr. */
export async function readHeaderFooterPart(
  zip: JSZip,
  documentXml: string,
  rels: Map<string, RelInfo>,
  kind: 'header' | 'footer',
  hfType: 'default' | 'first' | 'even' = 'default',
  theme?: ThemeColors | null,
  styles?: Map<string, StyleInfo>,
  compatibilityMode = 0,
  themeFonts?: ThemeFonts | null,
  docDefaults?: DocDefaults,
  sourcePath = 'word/document.xml',
): Promise<{
  text: string
  hasPageNumber: boolean
  watermark: string | null
  watermarkPicture: PictureWatermarkInfo | null
  paras: HfParagraph[]
  images?: HfImage[]
} | null> {
  const refs = hfReferenceTags(documentXml, kind)
  const typed = refs.find((r) => hfReferenceType(r) === hfType)
  // untyped references count as default (w:type is technically required but often
  // omitted); non-schema w:type="odd" is Word's default (odd-page) part too
  const ref =
    hfType === 'default'
      ? (typed ??
        refs.find((r) => hfReferenceType(r) === 'odd') ??
        refs.find((r) => hfReferenceType(r) === undefined))
      : typed
  if (!ref) return null
  const rId = hfReferenceRId(ref)
  const target = rId ? rels.get(rId)?.target : undefined
  if (!target) return null
  const path = resolveRelationshipTargetPath(sourcePath, target)
  if (!path) return null
  const file = zip.file(path)
  if (!file) return null
  const xml = stripHfDeletions(await file.async('string'))
  const content = hfContentFromXml(
    xml,
    kind,
    theme,
    styles,
    await hfTableMedia(zip, path, xml),
    compatibilityMode,
    themeFonts,
    docDefaults,
  )
  const images = bindHfImageAnchors(await hfImages(zip, path, xml, content.paras), content.paras)
  return images.length > 0 ? { ...content, images } : content
}

/** All header/footer parts by rId (multi-section docs look them up via each section's sectPr refs) */
export async function parseAllHfParts(
  zip: JSZip,
  rels: Map<string, RelInfo>,
  styles: Map<string, StyleInfo> | undefined,
  theme?: ThemeColors | null,
  compatibilityMode = 0,
  themeFonts?: ThemeFonts | null,
  docDefaults?: DocDefaults,
  sourcePath = 'word/document.xml',
): Promise<Record<string, HfPartInfo>> {
  const out: Record<string, HfPartInfo> = {}
  for (const [rId, rel] of rels) {
    const kind = rel.type.endsWith('/header')
      ? 'header'
      : rel.type.endsWith('/footer')
        ? 'footer'
        : null
    if (!kind) continue
    const path = resolveRelationshipTargetPath(sourcePath, rel.target)
    if (!path) continue
    const file = zip.file(path)
    if (!file) continue
    const xml = stripHfDeletions(await file.async('string'))
    const content = hfContentFromXml(
      xml,
      kind,
      theme,
      styles,
      await hfTableMedia(zip, path, xml),
      compatibilityMode,
      themeFonts,
      docDefaults,
    )
    const images = bindHfImageAnchors(await hfImages(zip, path, xml, content.paras), content.paras)
    out[rId] = {
      text: content.text,
      hasPageNumber: content.hasPageNumber,
      paras: content.paras,
      ...(images.length > 0 ? { images } : {}),
    }
  }
  return out
}

/** Word merges style-chain and direct tab stops (direct wins per position; w:val="clear" removes) */
function mergeTabStops(
  style: import('./types').TabStop[] | undefined,
  direct: import('./types').TabStop[] | undefined,
): import('./types').TabStop[] | undefined {
  if (!style?.length || !direct?.length) {
    const only = direct ?? style
    return only?.filter((s) => s.val !== 'clear')
  }
  const merged = [...style.filter((s) => !direct.some((o) => o.pos === s.pos)), ...direct]
    .filter((s) => s.val !== 'clear')
    .sort((a, b) => a.pos - b.pos)
  // duplicated positions inside one list (seen in production pPr) collapse to the first
  const out = merged.filter((s, i) => i === 0 || s.pos !== merged[i - 1].pos)
  return out.length > 0 ? out : undefined
}

/** rich paragraphs of a header/footer part (watermark/drawing paragraphs skipped) */
/** Word's Header/Footer styles reset Normal's line spacing (w:line=240): strip
 *  lines are sized by the style chain when the paragraph declares none */
/** display-only style layer: Word's built-in Header/Footer styles carry the
 *  center/right tab stops (and sometimes w:jc); direct pPr wins per property */
function hfParaStyleLayers(
  pNode: XNode,
  styles: Map<string, StyleInfo> | undefined,
): { direct: ParaFormat | undefined; d: StyleInfo['display'] } {
  const pPr = findChild(pNode, 'w:pPr')
  const direct = pPr ? extractParaFormat(pPr) : undefined
  const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
  return { direct, d: styleId ? styles?.get(styleId)?.display : undefined }
}

function hfStyledParaFormat(
  pNode: XNode,
  styles: Map<string, StyleInfo> | undefined,
  docDefaults?: DocDefaults,
): ParaFormat {
  const { direct, d } = hfParaStyleLayers(pNode, styles)
  // an unstyled strip paragraph is a Normal paragraph: its spacing chain starts
  // at the default paragraph style, not at docDefaults
  const chain = d ?? hfDefaultParaStyle(styles)?.display
  return {
    ...(d?.align && d.align !== 'justify' ? { align: d.align } : {}),
    ...hfStyleLineSpacing(d, direct),
    ...direct,
    ...hfResolvedSpacing(chain, direct, docDefaults),
    ...(chain?.borderSides ? mergeStyleBorders(chain.borderSides, direct) : {}),
  }
}

/** Word's HTML auto paragraph spacing (w:beforeAutospacing / w:afterAutospacing), twips */
const HF_AUTO_SPACING_TWIPS = 280

function hfDefaultParaStyle(styles: Map<string, StyleInfo> | undefined): StyleInfo | undefined {
  if (!styles) return undefined
  for (const info of styles.values()) if (info.type === 'paragraph' && info.isDefault) return info
  return undefined
}

/** Strip paragraphs stack their before/after; Word resolves them through the
 *  style chain and docDefaults like body paragraphs (a Normal (Web) blank line
 *  in a header adds 14pt above and below), so the display format carries the
 *  resolved twips, autospacing as 14pt. */
function hfResolvedSpacing(
  d: StyleInfo['display'],
  direct: ParaFormat | undefined,
  dd: DocDefaults | undefined,
): Pick<ParaFormat, 'spaceBefore' | 'spaceAfter'> {
  const out: Pick<ParaFormat, 'spaceBefore' | 'spaceAfter'> = {}
  const before =
    (direct?.spaceBeforeAuto ?? d?.spaceBeforeAuto ?? dd?.spaceBeforeAuto)
      ? HF_AUTO_SPACING_TWIPS
      : (direct?.spaceBefore ?? d?.spaceBeforeTwips ?? dd?.spaceBeforeTwips)
  const after =
    (direct?.spaceAfterAuto ?? d?.spaceAfterAuto ?? dd?.spaceAfterAuto)
      ? HF_AUTO_SPACING_TWIPS
      : (direct?.spaceAfter ?? d?.spaceAfterTwips ?? dd?.spaceAfterTwips)
  if (before) out.spaceBefore = before
  if (after) out.spaceAfter = after
  return out
}

function hfStyleLineSpacing(
  d: StyleInfo['display'],
  direct: ParaFormat | undefined,
): Pick<ParaFormat, 'lineRule' | 'lineRawTwips' | 'lineSpacing'> {
  if (!d?.lineRule || !d.lineRawTwips) return {}
  if (direct?.lineRule || direct?.lineRawTwips || direct?.lineSpacing !== undefined) return {}
  return {
    lineRule: d.lineRule,
    lineRawTwips: d.lineRawTwips,
    ...(d.lineRule === 'auto'
      ? { lineSpacing: Math.round((d.lineRawTwips / 240) * 100) / 100 }
      : {}),
  }
}

function hfParagraphs(
  partXml: string,
  theme?: ThemeColors | null,
  styles?: Map<string, StyleInfo>,
  tableMedia?: Map<string, string>,
  compatibilityMode = 0,
  themeFonts?: ThemeFonts | null,
  docDefaults?: DocDefaults,
): HfParagraph[] {
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(partXml) as XNode[]
  } catch {
    return []
  }
  const root = parsed.find((n) => nameOf(n) === 'w:hdr' || nameOf(n) === 'w:ftr')
  if (!root) return []
  // header parts have their own rels; hyperlink targets are not resolved here
  const ctx = {
    rels: new Map(),
    noteNumbers: new Map(),
    themeColors: theme,
    themeFonts,
    styles,
    xmlSpacePreserve: attrsOf(root)['xml:space'] === 'preserve',
  } as unknown as BuildContext
  const out: HfParagraph[] = []
  const runImageIds = new Set<string>()
  hfRunImageIds.set(out, runImageIds)
  // floating tables (w:tblpPr) anchor to the paragraph that follows them in
  // markup; Word draws that paragraph first, so their rows are deferred past it
  const deferred: HfParagraph[] = []
  const flushDeferred = () => {
    out.push(...deferred)
    deferred.length = 0
  }
  // paragraphs may sit inside (nested) w:sdt content controls (OpenXML SDK footers)
  for (const node of childrenThroughSdt(root, ['w:tbl', 'w:p'])) {
    const name = nameOf(node)
    if (name === 'w:tbl') {
      // layout tables (logo | title | date rows): one display paragraph per row
      const rows = hfTableRowParagraphs(
        node,
        tableMedia ? ({ ...ctx, mediaByRid: tableMedia } as BuildContext) : ctx,
        compatibilityMode,
      )
      if (findChild(findChild(node, 'w:tblPr') ?? {}, 'w:tblpPr')) deferred.push(...rows)
      else out.push(...rows)
      continue
    }
    if (name !== 'w:p') continue
    const pNode = node
    let runs = extractRuns(pNode, ctx)
    // Word lays an inline picture out at its run position (after a tab, on the
    // text line); only a picture sharing its paragraph with text takes this
    // path, picture-only paragraphs stay on the part-level image list
    if (runs.length > 0 && tableMedia && hasDeepChildOutside(pNode, WP_INLINE, TXBX_CONTENT)) {
      runs = extractRuns(
        pNode,
        { ...ctx, mediaByRid: tableMedia } as BuildContext,
        [],
        [],
        true,
      ).flatMap((r) => {
        if (!r.image) return r
        if (/<wp:inline[\s>]/.test(r.image.xml)) {
          const id = /<wp:docPr\s[^>]*\bid="([^"]+)"/.exec(r.image.xml)?.[1]
          if (id) runImageIds.add(id)
          return r
        }
        const { image: _image, ...rest } = r
        return rest.text === '' ? [] : rest
      })
    }
    const boxed = hasDeepChild(pNode, TXBX_CONTENT) ? textboxParagraphs(pNode, ctx) : []
    if (runs.length === 0 && (findChild(pNode, 'w:r') || findChild(pNode, 'w:pict'))) {
      // Government-style footers keep their text (e.g. the "— PAGE —" page number)
      // inside a VML textbox shape; surface those inner paragraphs instead of dropping
      // the content. Watermark / decorative drawing paragraphs still skip.
      // A paragraph carrying only floating boxes, anchored drawings (logo
      // groups) or a floating VML shape (picture watermark) keeps its own line
      // in Word (often collapsed by w:spacing w:line): the body starts below
      // that line. Word probe 2026-09-23: a Normal-style header paragraph whose
      // only content is a picture watermark reserves a full 22.56pt line.
      if (
        (boxed.length > 0 || hasDeepChild(pNode, WP_ANCHOR) || hasFloatingVmlPicture(pNode)) &&
        boxed.every((p) => p.box) &&
        !hasDeepChildOutside(pNode, WP_INLINE, TXBX_CONTENT)
      ) {
        for (const p of boxed) p.box!.anchorPara = out.length
        out.push({ ...hfStyledParaFormat(pNode, styles, docDefaults), runs: [], lineOnly: true })
      }
      out.push(...boxed)
      flushDeferred()
      continue
    }
    // floating boxes sharing the paragraph with text: surfaced after it and
    // anchored to it (paragraph-relative offsets measure from that paragraph)
    const anchoredBoxes = boxed.filter((p) => p.box)
    for (const p of anchoredBoxes) p.box!.anchorPara = out.length
    const pPr = findChild(pNode, 'w:pPr')
    const { direct, d } = hfParaStyleLayers(pNode, styles)
    // absolute position tabs (w:ptab): carry their own alignment, ignore stops.
    // Indexed by overall tab order — regular w:tab occupies a slot as undefined,
    // so mixed tab/ptab paragraphs keep their alignments on the right segment.
    const ptabAligns: Array<'left' | 'center' | 'right' | undefined> = []
    let sawPtab = false
    const walkTabs = (n: XNode): void => {
      for (const c of childrenOf(n)) {
        const name = nameOf(c)
        if (name === 'w:pPr') continue
        if (name === 'w:tab') ptabAligns.push(undefined)
        else if (name === 'w:ptab') {
          sawPtab = true
          const a = attrsOf(c)['w:alignment']
          ptabAligns.push(a === 'center' ? 'center' : a === 'right' ? 'right' : 'left')
        } else walkTabs(c)
      }
    }
    walkTabs(pNode)
    // w:framePr frames (page-number "1" floated at the right margin): the frame
    // shares the following paragraph's flow line instead of stacking above it
    const framePr = pPr ? findChild(pPr, 'w:framePr') : undefined
    const frameAttrs = framePr ? attrsOf(framePr) : undefined
    const xAlign = frameAttrs && !frameAttrs['w:dropCap'] ? frameAttrs['w:xAlign'] : undefined
    const frameXAlign =
      xAlign === 'right' || xAlign === 'outside'
        ? ('right' as const)
        : xAlign === 'center'
          ? ('center' as const)
          : xAlign === 'left' || xAlign === 'inside'
            ? ('left' as const)
            : undefined
    const mergedStops = mergeTabStops(d?.tabStops, direct?.tabStops)
    // a blank strip line is sized by its paragraph mark, else by the style's run size
    const styleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
    const emptySz =
      runs.length === 0
        ? (emptyParaSizeHalfPoints(pNode, pPr) ??
          (styleId ? styles?.get(styleId)?.display?.sizeHalfPoints : undefined))
        : undefined
    out.push({
      ...hfStyledParaFormat(pNode, styles, docDefaults),
      ...(mergedStops ? { tabStops: mergedStops } : {}),
      ...(sawPtab ? { ptabAligns } : {}),
      ...(frameXAlign ? { frameXAlign } : {}),
      ...(emptySz ? { emptyRunSizeHalfPoints: emptySz } : {}),
      runs,
    })
    out.push(...anchoredBoxes)
    flushDeferred()
  }
  flushDeferred()
  // empty paragraphs stay, even when the whole part is blank: Word lays them
  // out and their height pushes the body when it exceeds the margin
  return out
}

type HfRawCell = {
  tc: XNode
  tcPr?: XNode
  gridStart: number
  span: number
  widthTwips: number
  widthIsPct: boolean
  vMergeContinue: boolean
  borders?: CellBorders
}

const NO_BORDER: CellBorder = { style: 'none' }

function hfLine(b: CellBorder | undefined): CellBorder | undefined {
  return b && b.style !== 'none' && b.style !== 'nil' ? b : undefined
}

/** Resolved per-side borders of a layout-table cell (w:tcBorders over
 *  w:tblBorders): each line shared between two cells is assigned to one of
 *  them (the earlier cell's right / bottom) so it never paints twice, and
 *  a vertically merged cell keeps no line through its interior. */
function hfCellBorders(
  rows: HfRawCell[][],
  r: number,
  c: number,
  tbl: TableBorders | undefined,
): CellBorders | undefined {
  const cell = rows[r][c]
  const own = cell.borders
  const below = rows[r + 1]
  const covering = (row: HfRawCell[], col: number) =>
    row.find((x) => x.gridStart <= col && col < x.gridStart + x.span)
  let bottom: CellBorder | undefined
  if (!below) bottom = own?.bottom ?? tbl?.bottom
  else {
    for (let col = cell.gridStart; col < cell.gridStart + cell.span; col++) {
      const under = covering(below, col)
      const line = under?.vMergeContinue
        ? NO_BORDER
        : (own?.bottom ?? under?.borders?.top ?? tbl?.insideH)
      if (hfLine(line)) {
        bottom = line
        break
      }
      bottom ??= line
    }
  }
  const next = rows[r][c + 1]
  const right = next
    ? (own?.right ?? next.borders?.left ?? tbl?.insideV)
    : (own?.right ?? tbl?.right)
  // inner lines belong to the cell above / to the left (own top and left feed
  // their resolution there); only the table's first row and column paint them
  const top = r === 0 ? (own?.top ?? tbl?.top) : undefined
  const left = c === 0 ? (own?.left ?? tbl?.left) : undefined
  const out: CellBorders = {}
  if (hfLine(top)) out.top = top
  if (hfLine(left)) out.left = left
  if (hfLine(bottom)) out.bottom = bottom
  if (hfLine(right)) out.right = right
  return Object.keys(out).length > 0 ? out : undefined
}

/** header/footer top-level table → one paragraph per row, cells as columns */
export function hfTableRowParagraphs(
  tbl: XNode,
  ctx: BuildContext,
  compatibilityMode: number,
): HfParagraph[] {
  const tblPr = findChild(tbl, 'w:tblPr')
  const styleId = attrsOf(findChild(tblPr ?? {}, 'w:tblStyle') ?? {})['w:val']
  const styleTable = styleId ? ctx.styles?.get(styleId)?.tableDisplay : undefined
  const tblBorders = mergedBorderLinesOf(tblPr, 'w:tblBorders', true) ?? styleTable?.borders
  const tblMar = cellMarginsOf(findChild(tblPr ?? {}, 'w:tblCellMar')) ?? styleTable?.cellMarTwips
  const tblW = attrsOf(findChild(tblPr ?? {}, 'w:tblW') ?? {})
  const tblInd = attrsOf(findChild(tblPr ?? {}, 'w:tblInd') ?? {})
  const indRaw = !tblInd['w:type'] || tblInd['w:type'] === 'dxa' ? Number(tblInd['w:w']) : 0
  // legacy layout (Word 2010 and before) measures tblInd to the cell text, so
  // the left border sits one cell margin further out; Word 2013+ to the border
  const indentTwips =
    (Number.isFinite(indRaw) ? indRaw : 0) - (compatibilityMode >= 15 ? 0 : (tblMar?.left ?? 108))
  const bidiVisual = boolProp(tblPr ?? {}, 'w:bidiVisual')
  const rowBase: HfTableRow = {
    indentTwips,
    tabOverflow: compatibilityMode >= 15 ? 'wrap' : 'clip',
    ...(bidiVisual ? { bidiVisual: true } : {}),
  }
  const grid = findChild(tbl, 'w:tblGrid')
  const gridCols = grid
    ? findChildren(grid, 'w:gridCol').map((g) => Number(attrsOf(g)['w:w']) || 0)
    : []
  const trs = childrenThroughSdt(tbl, 'w:tr')
  const rawRows: HfRawCell[][] = trs.map((tr) => {
    let col = 0
    return childrenThroughSdt(tr, 'w:tc').map((tc) => {
      const tcPr = findChild(tc, 'w:tcPr')
      const span = Number(attrsOf(findChild(tcPr ?? {}, 'w:gridSpan') ?? {})['w:val']) || 1
      const a = attrsOf(findChild(tcPr ?? {}, 'w:tcW') ?? {})
      const v = Number(a['w:w'])
      const widthIsPct = a['w:type'] === 'pct'
      const declared = !widthIsPct && Number.isFinite(v) && v > 0 ? v : 0
      const fromGrid = gridCols.slice(col, col + span).reduce((s, w) => s + w, 0)
      const vMerge = findChild(tcPr ?? {}, 'w:vMerge')
      const cell: HfRawCell = {
        tc,
        tcPr,
        gridStart: col,
        span,
        widthTwips: declared || fromGrid,
        widthIsPct,
        vMergeContinue: Boolean(vMerge) && attrsOf(vMerge!)['w:val'] !== 'restart',
        borders: mergedBorderLinesOf(tcPr, 'w:tcBorders', false),
      }
      col += span
      return cell
    })
  })
  // w:left / w:right borders are physical sides: resolve neighbours in visual order
  const visualRows = bidiVisual ? rawRows.map((row) => [...row].reverse()) : rawRows
  // declared widths hold as absolute columns unless the table (or a cell) is
  // sized as a percentage of the strip; then the cells share the row
  const absolute =
    tblW['w:type'] !== 'pct' &&
    rawRows.every((row) => row.every((c) => !c.widthIsPct && c.widthTwips > 0))
  const out: HfParagraph[] = []
  rawRows.forEach((raw, r) => {
    const trPr = findChild(trs[r], 'w:trPr')
    const trHeight = attrsOf(findChild(trPr ?? {}, 'w:trHeight') ?? {})
    const heightTwips = Number(trHeight['w:val'])
    const row: HfTableRow = {
      ...rowBase,
      ...(heightTwips > 0
        ? { heightTwips, heightRule: trHeight['w:hRule'] === 'exact' ? 'exact' : 'atLeast' }
        : {}),
    }
    const total = raw.reduce((s, c) => s + c.widthTwips, 0)
    const cells = raw.map((rc, c): HfTableCell => {
      const content = hfCellContent(rc.tc, ctx, styleTable?.paraSpacing)
      const vAlign = attrsOf(findChild(rc.tcPr ?? {}, 'w:vAlign') ?? {})['w:val']
      const tcMar = cellMarginsOf(findChild(rc.tcPr ?? {}, 'w:tcMar'))
      const mar = tblMar || tcMar ? { ...tblMar, ...tcMar } : undefined
      const borders = hfCellBorders(visualRows, r, bidiVisual ? raw.length - 1 - c : c, tblBorders)
      return {
        ...content,
        ...(total > 0 && rc.widthTwips > 0 ? { widthPct: (rc.widthTwips / total) * 100 } : {}),
        ...(absolute ? { widthTwips: rc.widthTwips } : {}),
        ...(borders ? { borders } : {}),
        ...(vAlign === 'center' || vAlign === 'bottom' ? { vAlign } : {}),
        ...(mar ? { marTwips: mar } : {}),
      }
    })
    // bordered / shaded-only rows still render (banner bars with no text)
    if (
      cells.some(
        (c) =>
          c.paras.some((rs) => rs.some((r) => r.text !== '' || r.image)) || c.fill || c.borders,
      )
    ) {
      const rowPara: HfParagraph = { runs: [], cells, row }
      out.push(rowPara)
      const ids = anchorDocPrIds(trs[r])
      if (ids.length > 0) hfRowAnchorIds.set(rowPara, ids)
    }
  })
  return out
}

/** Cell content in document order, nested layout tables flattened into the cell
 *  (their cell text, alignment and shading would otherwise be dropped). */
function hfCellContent(
  tc: XNode,
  ctx: BuildContext,
  styleSpacing?: TableStyleDisplay['paraSpacing'],
): {
  paras: Run[][]
  paraProps?: HfTableCell['paraProps']
  align?: HfTableCell['align']
  fill?: string
} {
  const paras: Run[][] = []
  const paraProps: NonNullable<HfTableCell['paraProps']> = []
  let align: HfTableCell['align']
  const shd = attrsOf(findChild(findChild(tc, 'w:tcPr') ?? {}, 'w:shd') ?? {})['w:fill']
  let fill = shd && shd !== 'auto' ? stripHash(shd) : undefined
  let sawNested = false
  for (const node of childrenThroughSdt(tc, ['w:p', 'w:tbl'])) {
    if (nameOf(node) === 'w:tbl') {
      sawNested = true
      const nestedStyle = attrsOf(findChild(findChild(node, 'w:tblPr') ?? {}, 'w:tblStyle') ?? {})[
        'w:val'
      ]
      const nestedSpacing = nestedStyle
        ? ctx.styles?.get(nestedStyle)?.tableDisplay?.paraSpacing
        : undefined
      for (const tr of childrenThroughSdt(node, 'w:tr')) {
        for (const inner of childrenThroughSdt(tr, 'w:tc')) {
          const c = hfCellContent(inner, ctx, nestedSpacing)
          paras.push(...c.paras)
          paraProps.push(...(c.paraProps ?? c.paras.map(() => undefined)))
          align ??= c.align
          fill ??= c.fill
        }
      }
      continue
    }
    // anchored pictures stay in the part-level image list (page positioning);
    // a run carrying both text and an anchored drawing keeps its text
    paras.push(
      extractRuns(node, ctx, [], [], true).flatMap((r) => {
        if (
          !r.image ||
          (!/<wp:anchor[\s>]/.test(r.image.xml) && !/position:\s*absolute/.test(r.image.xml))
        )
          return r
        const { image: _image, ...rest } = r
        return rest.text === '' ? [] : rest
      }),
    )
    const pPr = findChild(node, 'w:pPr')
    const direct = pPr ? extractParaFormat(pPr, ctx.themeColors) : undefined
    const pStyle = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
    const d = pStyle ? ctx.styles?.get(pStyle)?.display : undefined
    const stops = mergeTabStops(d?.tabStops, direct?.tabStops)
    // table-style w:pPr spacing sits under the paragraph style and direct pPr
    const spaceBefore =
      direct?.spaceBefore ?? (d?.spaceBeforeTwips == null ? styleSpacing?.beforeTwips : undefined)
    const spaceAfter =
      direct?.spaceAfter ?? (d?.spaceAfterTwips == null ? styleSpacing?.afterTwips : undefined)
    const props: NonNullable<HfTableCell['paraProps']>[number] = {
      ...(d?.align && d.align !== 'justify' ? { align: d.align } : {}),
      ...(direct?.align ? { align: direct.align } : {}),
      ...(direct?.indentLeft ? { indentLeft: direct.indentLeft } : {}),
      ...(direct?.indentFirstLine ? { indentFirstLine: direct.indentFirstLine } : {}),
      ...(spaceBefore ? { spaceBefore } : {}),
      ...(spaceAfter ? { spaceAfter } : {}),
      ...(stops?.length ? { tabStops: stops } : {}),
      ...hfStyleLineSpacing(d, direct),
      ...(direct?.lineRule ? { lineRule: direct.lineRule } : {}),
      ...(direct?.lineRawTwips ? { lineRawTwips: direct.lineRawTwips } : {}),
      ...(direct?.lineSpacing !== undefined ? { lineSpacing: direct.lineSpacing } : {}),
    }
    paraProps.push(Object.keys(props).length > 0 ? props : undefined)
    if (!align && props.align) align = props.align
  }
  // the mandatory empty paragraph after a nested table is layout noise
  if (sawNested) {
    while (paras.length > 0 && paras[paras.length - 1].length === 0) {
      paras.pop()
      paraProps.pop()
    }
  }
  return {
    paras,
    ...(paraProps.some(Boolean) ? { paraProps } : {}),
    ...(align ? { align } : {}),
    ...(fill ? { fill } : {}),
  }
}

/** text paragraphs nested inside textbox shapes (VML v:textbox / DrawingML wps:txbx → w:txbxContent) */
function textboxParagraphs(pNode: XNode, ctx: BuildContext): HfParagraph[] {
  const out: HfParagraph[] = []
  const walk = (node: XNode, box: HfTextBox | undefined) => {
    const name = nameOf(node)
    if (name === 'w:txbxContent') {
      for (const inner of findChildren(node, 'w:p')) {
        const runs = extractRuns(inner, ctx)
        if (runs.length === 0) continue
        const pPr = findChild(inner, 'w:pPr')
        // content of a floating box draws at the anchor, not in the strip flow:
        // it must not push the body down (Word), only display does
        out.push({
          ...(pPr ? extractParaFormat(pPr, ctx.themeColors) : {}),
          runs,
          ...(box ? { boxAnchored: true, box } : {}),
        })
      }
      return
    }
    let next = box
    if (name === 'wp:anchor') next = hfTextBoxOfAnchor(node)
    else if (name?.startsWith('v:') && /position:\s*absolute/.test(attrsOf(node)['style'] ?? '')) {
      next = hfTextBoxOfVml(node)
    } else if (box && name === 'wps:bodyPr') {
      readBodyPr(node, box)
    } else if (box && name === 'v:textbox') {
      readVmlInset(node, box)
    }
    for (const child of childrenOf(node)) walk(child, next)
  }
  walk(pNode, undefined)
  return out
}

let hfTextBoxSeq = 0
/** Word's textbox text insets (0.1in / 0.05in) when the shape declares none */
const TEXTBOX_INSETS_PX = [9.6, 4.8, 9.6, 4.8]

/** placement of a header/footer textbox from its wp:anchor */
function hfTextBoxOfAnchor(anchor: XNode): HfTextBox {
  const box: HfTextBox = { id: ++hfTextBoxSeq }
  const attrs = attrsOf(anchor)
  if (attrs['behindDoc'] === '1' || attrs['behindDoc'] === 'true') box.behind = true
  const ext = attrsOf(findChild(anchor, 'wp:extent') ?? {})
  const cx = parseInt(ext['cx'] ?? '', 10)
  const cy = parseInt(ext['cy'] ?? '', 10)
  if (cx > 0) box.widthPx = Math.round(cx / EMU_PER_PX)
  if (cy > 0) box.heightPx = Math.round(cy / EMU_PER_PX)
  for (const child of childrenOf(anchor)) {
    const wrap = /^wp:wrap(None|Square|Tight|Through|TopAndBottom)$/.exec(nameOf(child) ?? '')?.[1]
    if (wrap)
      box.wrap = wrap === 'TopAndBottom' ? 'topBottom' : (wrap.toLowerCase() as HfTextBox['wrap'])
  }
  readAnchorPos(serializeXNode(anchor), box)
  return box
}

/** placement of a header/footer textbox from an absolutely positioned VML shape's style */
/** VML CSS length in px: pt / in / cm / mm / px / pc, unitless = pt (Word writes bare 0) */
function vmlLengthPx(raw: string | undefined): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|px|pc)?\s*$/.exec(raw ?? '')
  if (!m) return undefined
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return undefined
  const perIn: Record<string, number> = { pt: 72, in: 1, cm: 2.54, mm: 25.4, px: 96, pc: 6 }
  return Math.round((v / (perIn[m[2] ?? 'pt'] ?? 72)) * 96 * 100) / 100
}

function hfTextBoxOfVml(shape: XNode): HfTextBox {
  const box: HfTextBox = { id: ++hfTextBoxSeq }
  const style = attrsOf(shape)['style'] ?? ''
  const px = (prop: string): number | undefined => {
    const v = vmlLengthPx(new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`).exec(style)?.[1])
    return v === undefined ? undefined : Math.round(v)
  }
  const w = px('width')
  const h = px('height')
  if (w !== undefined && w > 0) box.widthPx = w
  if (h !== undefined && h > 0) box.heightPx = h
  if (/z-index:\s*-/.test(style)) box.behind = true
  const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1]
  const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1]
  const relH = /mso-position-horizontal-relative:([\w-]+)/.exec(style)?.[1]
  const relV = /mso-position-vertical-relative:([\w-]+)/.exec(style)?.[1]
  const x = px('margin-left')
  const y = px('margin-top')
  if (posH === 'left' || posH === 'center' || posH === 'right') box.posH = posH
  else if (x !== undefined) {
    box.posXPx = x
    box.posHRel = anchorRelH(relH)
  }
  if (posV === 'top' || posV === 'center' || posV === 'bottom') box.posV = posV
  else if (y !== undefined) {
    box.posYPx = y
    box.posVRel = relV === 'margin' ? 'margin' : anchorRelV(relV ?? 'text')
  }
  const wrap = attrsOf(findChild(shape, 'w10:wrap') ?? {})['type']
  if (wrap === 'none' || wrap === 'square' || wrap === 'tight' || wrap === 'through')
    box.wrap = wrap
  else if (wrap === 'topAndBottom') box.wrap = 'topBottom'
  return box
}

/** wps:bodyPr insets (EMU) and vertical anchor of a DrawingML textbox */
function readBodyPr(bodyPr: XNode, box: HfTextBox): void {
  const a = attrsOf(bodyPr)
  const ins = (name: string, dflt: number) => {
    const v = parseInt(a[name] ?? '', 10)
    return Math.round(((Number.isFinite(v) ? v : dflt) / EMU_PER_PX) * 100) / 100
  }
  box.insets = [ins('lIns', 91440), ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720)]
  if (a['anchor'] === 'ctr') box.vAlign = 'center'
  else if (a['anchor'] === 'b') box.vAlign = 'bottom'
  if (a['wrap'] === 'none') box.nowrap = true
  if (findChild(bodyPr, 'a:spAutoFit')) box.autofit = true
}

/** v:textbox inset="l,t,r,b" (pt / in / unitless pt; missing entries keep Word's defaults) */
function readVmlInset(textbox: XNode, box: HfTextBox): void {
  if (/mso-fit-shape-to-text:\s*t/.test(attrsOf(textbox)['style'] ?? '')) box.autofit = true
  const raw = attrsOf(textbox)['inset']
  if (!raw) return
  const parts = raw.split(',')
  box.insets = TEXTBOX_INSETS_PX.map((d, i) => vmlLengthPx(parts[i]) ?? d) as [
    number,
    number,
    number,
    number,
  ]
}
