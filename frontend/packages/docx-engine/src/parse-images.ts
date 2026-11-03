// Picture metadata (DrawingML wp:anchor/wp:inline + legacy VML): extents, wrap,
// crop, effects, borders and transforms read off the raw drawing XML.
import { emuToPx } from './parse-shared'
import { EMU_PER_PX, EMU_PER_PT, plainText } from './parse-xml-text'
import { rawPPrOf } from './parse-props'
import type { Block, ImageEffects } from './types'

/** display size (wp:extent), paragraph alignment and wrap mode of an image paragraph */
export type ImageMeta = Pick<
  Block,
  | 'imageWidthPx'
  | 'imageHeightPx'
  | 'imageBand'
  | 'imageLeadingText'
  | 'imageLeadingFont'
  | 'imageLeadingExplicitSpaceWidthPx'
  | 'imageLeadingImplicitSpaceCount'
  | 'imageParagraphIndentLeft'
  | 'imageParagraphIndentRight'
  | 'imageParagraphIndentFirstLine'
  | 'imageParagraphSpaceBefore'
  | 'imageParagraphSpaceAfter'
  | 'imageParagraphLineTwips'
  | 'imageParagraphLineRule'
  | 'imageMarkFont'
  | 'imageMarkFontEastAsia'
  | 'imageMarkSizeHalfPoints'
  | 'imageEffectExtentTopPx'
  | 'imageEffectExtentBottomPx'
  | 'imageAlign'
  | 'imageWrap'
  | 'imageWrapDistTopEmu'
  | 'imageWrapDistBottomEmu'
  | 'imageWrapDistLeftEmu'
  | 'imageWrapDistRightEmu'
  | 'imageZOrder'
  | 'imageOffsetXEmu'
  | 'imageOffsetYEmu'
  | 'imageRelV'
  | 'imageRelH'
  | 'imageAnchorLocked'
  | 'imagePosH'
  | 'imagePosV'
  | 'imageRotDeg'
  | 'imageFlipH'
  | 'imageFlipV'
  | 'imageCrop'
  | 'imageEffects'
  | 'imageFillRect'
  | 'imageBorder'
> & {
  /** wp:anchor allowOverlap="0": Word displaces the object out of a colliding anchor's box */
  imageNoOverlap?: boolean
}

/** a:lum / a:grayscl / a:biLevel inside the picture's a:blip → display recolor */
function blipEffectsOf(xml: string): ImageEffects | undefined {
  // a self-closing first blip must not span to a later picture's closing tag
  const blip = /<a:blip\b[^>]*[^/>]>([\s\S]*?)<\/a:blip>/.exec(xml)?.[1]
  if (!blip) return undefined
  const out: ImageEffects = {}
  const lum = /<a:lum\b[^>]*\/?>/.exec(blip)?.[0]
  if (lum) {
    const bright = rectFrac(lum, 'bright')
    const contrast = rectFrac(lum, 'contrast')
    if (bright) out.bright = bright
    if (contrast) out.contrast = contrast
  }
  if (/<a:grayscl\b/.test(blip)) out.grayscale = true
  const biLevel = /<a:biLevel\b[^>]*\/?>/.exec(blip)?.[0]
  if (biLevel) out.biLevelThresh = /\bthresh="/.test(biLevel) ? rectFrac(biLevel, 'thresh') : 0.5
  return Object.keys(out).length > 0 ? out : undefined
}

/** a:srcRect / a:fillRect attribute (1000ths of a percent; some writers emit decimals) → fraction */
export function rectFrac(tag: string, name: string): number {
  const v = parseFloat(new RegExp(`\\b${name}\\s*=\\s*["'](-?[\\d.]+)["']`).exec(tag)?.[1] ?? '')
  return Number.isFinite(v) ? v / 100000 : 0
}

/**
 * Picture outline (a:ln with a solid fill on the pic's own spPr, so a sibling
 * textbox outline in the same drawing is not picked up); rendered as a CSS
 * border, display-only like crop. Theme-colored (schemeClr) outlines stay
 * unrendered.
 */
export function picBorderOf(xml: string): { color: string; widthPt: number } | undefined {
  const picSpPr = /<pic:spPr[^>]*>([\s\S]*?)<\/pic:spPr>/.exec(xml)?.[1]
  const picLn = picSpPr ? /<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/.exec(picSpPr)?.[0] : undefined
  if (!picLn || /<a:noFill\s*\/>/.test(picLn)) return undefined
  const color = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(picLn)?.[1]
  if (!color) return undefined
  const w = parseInt(/<a:ln\b[^>]*\bw="(\d+)"/.exec(picLn)?.[1] ?? '', 10)
  // DrawingML default stroke width is 0.75pt (9525 EMU)
  return {
    color: color.toUpperCase(),
    widthPt: Number.isFinite(w) && w > 0 ? w / EMU_PER_PT : 0.75,
  }
}

/** rotation/flip live on the pic's own xfrm (an anchored textbox sibling has its own wps xfrm) */
export function picTransformOf(xml: string): { rotDeg?: number; flipH?: boolean; flipV?: boolean } {
  const picXfrm = /<pic:spPr[^>]*>[\s\S]*?<a:xfrm([^>]*)>/.exec(xml)?.[1]
  if (!picXfrm) return {}
  const out: { rotDeg?: number; flipH?: boolean; flipV?: boolean } = {}
  const rot = parseInt(/\brot="(-?\d+)"/.exec(picXfrm)?.[1] ?? '', 10)
  if (Number.isFinite(rot) && rot !== 0) out.rotDeg = ((Math.round(rot / 60000) % 360) + 360) % 360
  if (/\bflipH="(?:1|true)"/.test(picXfrm)) out.flipH = true
  if (/\bflipV="(?:1|true)"/.test(picXfrm)) out.flipV = true
  return out
}

export function imageMeta(xml: string): ImageMeta {
  const meta: ImageMeta = {}
  const drawingAt = xml.search(/<w:(?:drawing|pict)[\s>]/)
  if (drawingAt >= 0 && /^<w:p[\s>]/.test(xml)) {
    const leadingXml = xml.slice(0, drawingAt)
    // a leading tab keeps its line when the picture does not fit beside it
    const leadingText = plainText(
      leadingXml.replace(/<w:tab\s*\/>|<w:tab>\s*<\/w:tab>/g, '<w:t>\t</w:t>'),
    )
    if (leadingText !== '') meta.imageLeadingText = leadingText
    const pPr = rawPPrOf(xml)
    const leadingFonts = [...leadingXml.matchAll(/<w:rFonts\b[^>]*\/?>/g)].at(-1)?.[0]
    meta.imageLeadingFont =
      /w:eastAsia="([^"]+)"/.exec(leadingFonts ?? '')?.[1] ??
      /w:ascii="([^"]+)"/.exec(leadingFonts ?? '')?.[1]
    let explicitSpaceWidthPx = 0
    let implicitSpaceCount = 0
    for (const runMatch of leadingXml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const runBody = runMatch[1]
      const text = plainText(`<w:r>${runBody}</w:r>`)
      if (!/^[ ]+$/.test(text)) continue
      const rPr = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(runBody)?.[0]
      const sizeHalfPoints = Number(/<w:sz\b[^>]*w:val="(\d+)"/.exec(rPr ?? '')?.[1] ?? NaN)
      if (Number.isFinite(sizeHalfPoints)) {
        // Word's CJK single-byte spaces are half-em: half-points / 3 = CSS px.
        explicitSpaceWidthPx += (text.length * sizeHalfPoints) / 3
      } else {
        implicitSpaceCount += text.length
      }
    }
    if (explicitSpaceWidthPx > 0) {
      meta.imageLeadingExplicitSpaceWidthPx = explicitSpaceWidthPx
    }
    if (implicitSpaceCount > 0) meta.imageLeadingImplicitSpaceCount = implicitSpaceCount
    const ind = pPr ? /<w:ind\b[^>]*\/?>/.exec(pPr)?.[0] : undefined
    const twips = (name: string): number | undefined => {
      const value = Number(new RegExp(`\\bw:${name}\\s*=\\s*["'](-?\\d+)["']`).exec(ind ?? '')?.[1] ?? NaN)
      return Number.isFinite(value) ? value : undefined
    }
    meta.imageParagraphIndentLeft = twips('left')
    meta.imageParagraphIndentRight = twips('right')
    meta.imageParagraphIndentFirstLine = twips('firstLine')
    if (meta.imageParagraphIndentFirstLine === undefined) {
      const hanging = twips('hanging')
      if (hanging !== undefined) meta.imageParagraphIndentFirstLine = -hanging
    }
    const spacing = pPr ? /<w:spacing\b[^>]*\/?>/.exec(pPr)?.[0] : undefined
    const spacingTwips = (name: string): number | undefined => {
      const value = Number(new RegExp(`\\bw:${name}\\s*=\\s*["'](-?\\d+)["']`).exec(spacing ?? '')?.[1] ?? NaN)
      return Number.isFinite(value) ? value : undefined
    }
    meta.imageParagraphSpaceBefore = spacingTwips('before')
    meta.imageParagraphSpaceAfter = spacingTwips('after')
    const lineTwips = spacingTwips('line')
    if (lineTwips !== undefined) {
      meta.imageParagraphLineTwips = lineTwips
      const rule = /\bw:lineRule="(\w+)"/.exec(spacing ?? '')?.[1]
      meta.imageParagraphLineRule = rule === 'exact' || rule === 'atLeast' ? rule : 'auto'
    }
    const markRPr = pPr ? /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] : undefined
    if (markRPr) {
      const fonts = /<w:rFonts\b[^>]*\/?>/.exec(markRPr)?.[0] ?? ''
      const font = /w:ascii="([^"]+)"/.exec(fonts)?.[1] ?? /w:hAnsi="([^"]+)"/.exec(fonts)?.[1]
      if (font) meta.imageMarkFont = font
      const eastAsia = /w:eastAsia="([^"]+)"/.exec(fonts)?.[1]
      if (eastAsia) meta.imageMarkFontEastAsia = eastAsia
      const sz = Number(/<w:sz\b[^>]*w:val="(\d+)"/.exec(markRPr)?.[1] ?? NaN)
      if (Number.isFinite(sz) && sz > 0) meta.imageMarkSizeHalfPoints = sz
    }
  }
  const extent = /<wp:extent[^>]*\/?>/.exec(xml)?.[0]
  if (extent) {
    const cx = parseInt(/\bcx\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? '', 10)
    const cy = parseInt(/\bcy\s*=\s*["'](\d+)["']/.exec(extent)?.[1] ?? '', 10)
    if (Number.isFinite(cx) && cx > 0) meta.imageWidthPx = emuToPx(cx)
    if (Number.isFinite(cy) && cy > 0) meta.imageHeightPx = emuToPx(cy)
  }
  const effect = /<wp:inline\b[^>]*>[\s\S]*?<wp:effectExtent\b([^>]*)\/?>/.exec(xml)?.[1]
  if (effect) {
    const px = (name: string): number => {
      const v = parseInt(new RegExp(`\\b${name}\\s*=\\s*["'](\\d+)["']`).exec(effect)?.[1] ?? '', 10)
      return Number.isFinite(v) && v > 0 ? Math.round((v / EMU_PER_PX) * 100) / 100 : 0
    }
    const t = px('t')
    const b = px('b')
    if (t) meta.imageEffectExtentTopPx = t
    if (b) meta.imageEffectExtentBottomPx = b
  }
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1]
  if (jc === 'center') meta.imageAlign = 'center'
  else if (jc === 'right' || jc === 'end') meta.imageAlign = 'right'
  const xf = picTransformOf(xml)
  if (xf.rotDeg !== undefined) meta.imageRotDeg = xf.rotDeg
  if (xf.flipH) meta.imageFlipH = true
  if (xf.flipV) meta.imageFlipV = true
  const border = picBorderOf(xml)
  if (border) meta.imageBorder = border
  // source crop (a:srcRect) and fill placement (a:stretch/a:fillRect): applied
  // by the renderer as an overflow-hidden window over a scaled/offset image
  const srcRect = /<a:srcRect\s[^>]*\/>/.exec(xml)?.[0]
  if (srcRect) {
    const crop = {
      l: rectFrac(srcRect, 'l'),
      t: rectFrac(srcRect, 't'),
      r: rectFrac(srcRect, 'r'),
      b: rectFrac(srcRect, 'b'),
    }
    if (crop.l || crop.t || crop.r || crop.b) meta.imageCrop = crop
  }
  const effects = blipEffectsOf(xml)
  if (effects) meta.imageEffects = effects
  const fillRect = /<a:stretch>\s*<a:fillRect\s[^>]*\/>/.exec(xml)?.[0]
  if (fillRect) {
    const fr = {
      l: rectFrac(fillRect, 'l'),
      t: rectFrac(fillRect, 't'),
      r: rectFrac(fillRect, 'r'),
      b: rectFrac(fillRect, 'b'),
    }
    if (fr.l || fr.t || fr.r || fr.b) meta.imageFillRect = fr
  }
  const anchor = /<wp:anchor[^>]*>/.exec(xml)?.[0]
  if (anchor) {
    const wrapDistance = (attr: string): number | undefined => {
      const value = Number(new RegExp(`\\b${attr}\\s*=\\s*["'](\\d+)["']`).exec(anchor)?.[1] ?? NaN)
      return Number.isFinite(value) ? value : undefined
    }
    meta.imageWrapDistTopEmu = wrapDistance('distT')
    meta.imageWrapDistBottomEmu = wrapDistance('distB')
    meta.imageWrapDistLeftEmu = wrapDistance('distL')
    meta.imageWrapDistRightEmu = wrapDistance('distR')
    if (/allowOverlap\s*=\s*["'](?:0|false)["']/.test(anchor)) meta.imageNoOverlap = true
    if (/\blocked\s*=\s*["'](?:1|true)["']/.test(anchor)) meta.imageAnchorLocked = true
    // relativeHeight = 251658240 base + zOrder; keep the delta so overlapping
    // anchors round-trip their paint order and the editor can reorder them
    const relHeight = Number(/relativeHeight\s*=\s*["'](\d+)["']/.exec(anchor)?.[1] ?? NaN)
    if (Number.isFinite(relHeight)) {
      const z = relHeight - 251658240
      if (z !== 0) meta.imageZOrder = z
    }
    // an explicit wrap element wins over behindDoc: Word draws a
    // behindDoc+wrapTight object behind the text and still wraps around it
    if (
      /behindDoc\s*=\s*["']1["']/.test(anchor) &&
      !/<wp:wrap(Square|Tight|Through|TopAndBottom)/.test(xml)
    )
      meta.imageWrap = 'behind'
    else if (/<wp:wrapTopAndBottom/.test(xml)) meta.imageWrap = 'topBottom'
    else if (/<wp:wrap(Square|Tight|Through)/.test(xml)) {
      const kind = /<wp:wrap(Square|Tight|Through)/.exec(xml)![1]
      const alignRight =
        /<wp:positionH[^>]*>(?:(?!<\/wp:positionH>)[\s\S])*?<wp:align>right<\/wp:align>/.test(xml)
      // column-relative only: margin/page align pairs are the position-gallery
      // presets and keep their square wrap (imagePosH/V round-trip)
      const alignCenter =
        /<wp:positionH[^>]*relativeFrom\s*=\s*["']column["'][^>]*>(?:(?!<\/wp:positionH>)[\s\S])*?<wp:align>center<\/wp:align>/.test(
          xml,
        )
      // wrapText names the side the text goes on — the object floats opposite;
      // with bothSides, the object's CENTER past mid-body (~4680 twips usable
      // half on Letter/A4) means it hugs the right side: a left-edge test
      // misclassifies wide pictures whose X sits before the midline but whose
      // body fills the right half (public issue #118)
      const wrapText = /<wp:wrap(?:Square|Tight|Through)[^>]*wrapText\s*=\s*["']([^"']+)["']/.exec(
        xml,
      )?.[1]
      const posH = /<wp:positionH[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(xml)?.[1] ?? ''
      const offX = Number(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posH)?.[1] ?? NaN)
      const extentCx = Number(/<wp:extent[^>]*\bcx\s*=\s*["'](\d+)["']/.exec(xml)?.[1] ?? NaN)
      const centerX = offX + (Number.isFinite(extentCx) ? extentCx / 2 : 0)
      const side =
        alignRight || wrapText === 'left' || (wrapText !== 'right' && centerX > 4680 * 635)
          ? 'right'
          : 'left'
      // centered object wrapping both sides: no both-side wrap in the
      // renderer, so approximate with the topBottom centered slot
      meta.imageWrap = alignCenter
        ? 'topBottom'
        : kind === 'Tight'
          ? `tight-${side}`
          : kind === 'Through'
            ? `through-${side}`
            : `square-${side}`
    } else meta.imageWrap = 'front'
    // Parse numeric posOffset for free-position floating images
    const posHBody = /<wp:positionH[^>]*>([\s\S]*?)<\/wp:positionH>/.exec(xml)?.[1] ?? ''
    const posVBody = /<wp:positionV[^>]*>([\s\S]*?)<\/wp:positionV>/.exec(xml)?.[1] ?? ''
    const offsetX = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posHBody)?.[1]
    const offsetY = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(posVBody)?.[1]
    if (offsetX !== undefined) meta.imageOffsetXEmu = parseInt(offsetX, 10)
    if (offsetY !== undefined) meta.imageOffsetYEmu = parseInt(offsetY, 10)
    // margin-relative wp:align pair = Word position-gallery preset
    const posHFrom = /<wp:positionH[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1]
    const posVFrom = /<wp:positionV[^>]*relativeFrom="([^"]+)"/.exec(xml)?.[1]
    const alignH = /<wp:align>(left|center|right)<\/wp:align>/.exec(posHBody)?.[1]
    const alignV = /<wp:align>(top|center|bottom)<\/wp:align>/.exec(posVBody)?.[1]
    if ((posVFrom === 'page' || posVFrom === 'margin') && offsetY !== undefined && !alignV)
      meta.imageRelV = posVFrom
    if ((posHFrom === 'page' || posHFrom === 'margin') && offsetX !== undefined && !alignH)
      meta.imageRelH = posHFrom
    if (posHFrom === 'margin' && posVFrom === 'margin' && alignH && alignV) {
      meta.imagePosH = alignH as ImageMeta['imagePosH']
      meta.imagePosV = alignV as ImageMeta['imagePosV']
    } else if ((posHFrom === 'margin' || posHFrom === 'page') && alignH && !alignV) {
      // mixed positioning (H aligned, V by offset): keep the horizontal preset
      // so no-wrap images at least center like Word/LO
      meta.imagePosH = alignH as ImageMeta['imagePosH']
    }
  }
  return meta
}

/**
 * VML picture geometry (v:shape style) → the DrawingML ImageMeta model, so
 * legacy stamps/watermark pictures reuse the floating-image render path.
 * Only the high-frequency subset: width/height, absolute position offsets,
 * behind-text z-index, and margin-relative centering.
 */
export function vmlImageMeta(xml: string): ImageMeta {
  const meta: ImageMeta = {}
  const style = /<v:shape [^>]*style="([^"]*)"/.exec(xml)?.[1] ?? ''
  const w = parseFloat(/(?:^|;)width:([\d.]+)pt/.exec(style)?.[1] ?? '')
  const h = parseFloat(/(?:^|;)height:([\d.]+)pt/.exec(style)?.[1] ?? '')
  if (w > 0) meta.imageWidthPx = Math.round((w / 72) * 96)
  if (h > 0) meta.imageHeightPx = Math.round((h / 72) * 96)
  const jc = /<w:jc w:val="([^"]+)"/.exec(xml)?.[1]
  if (jc === 'center') meta.imageAlign = 'center'
  else if (jc === 'right' || jc === 'end') meta.imageAlign = 'right'
  if (/position:absolute/.test(style)) {
    meta.imageWrap = /z-index:\s*-/.test(style) ? 'behind' : 'front'
    const mx = parseFloat(/margin-left:(-?[\d.]+)pt/.exec(style)?.[1] ?? '')
    const my = parseFloat(/margin-top:(-?[\d.]+)pt/.exec(style)?.[1] ?? '')
    if (Number.isFinite(mx)) meta.imageOffsetXEmu = Math.round(mx * EMU_PER_PT)
    if (Number.isFinite(my)) meta.imageOffsetYEmu = Math.round(my * EMU_PER_PT)
    const posH = /mso-position-horizontal:(\w+)/.exec(style)?.[1]
    const posV = /mso-position-vertical:(\w+)/.exec(style)?.[1]
    const relH = /mso-position-horizontal-relative:(\w+)/.exec(style)?.[1]
    const relV = /mso-position-vertical-relative:(\w+)/.exec(style)?.[1]
    if (
      (relH === 'margin' || relH === 'page') &&
      (relV === 'margin' || relV === 'page') &&
      (posH === 'left' || posH === 'center' || posH === 'right') &&
      (posV === 'top' || posV === 'center' || posV === 'bottom')
    ) {
      meta.imagePosH = posH
      meta.imagePosV = posV
    }
  }
  return meta
}
