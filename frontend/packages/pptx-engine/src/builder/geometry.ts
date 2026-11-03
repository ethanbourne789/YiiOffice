import { isPresetShapeType } from '../preset-shape-types'
import { custGeomXml, parseCustGeom, validCustGeomPath, type CustGeomPath } from '../custgeom'
import { patchedElementXml } from './patch'
import type { Slide, TextElement } from '../types'

/**
 * Update a picture element's srcRect crop (0..1 fractions, null = full image).
 * Flags dirtySrcRect so save surgically patches <a:srcRect>; no other bytes are
 * touched. Returns whether the element was found and updated.
 */
export function editPictureSrcRect(
  slide: Slide,
  sourceId: string,
  srcRect: { l: number; t: number; r: number; b: number } | null,
): boolean {
  const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture')
  if (!el) return false
  const pic = el as import('../types').PictureElement
  if (srcRect && !srcRect.l && !srcRect.t && !srcRect.r && !srcRect.b) {
    pic.srcRect = undefined
  } else {
    pic.srcRect = srcRect ?? undefined
  }
  pic.dirtySrcRect = true
  return true
}

/**
 * Change a shape's preset geometry ("Change Shape"): replace <a:prstGeom> (or
 * <a:custGeom>) with the new preset and a fresh <a:avLst/>, keeping transform,
 * fill, outline, and text. Byte surgery baked directly into originalXml.
 */
export function setShapePresetGeometry(slide: Slide, elementId: string, prst: string): boolean {
  if (!isPresetShapeType(prst)) return false
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  const xml = swapGeometryXml(patchedElementXml(el), presetGeomXml(prst))
  if (xml == null) return false
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  const shape = el as TextElement
  shape.presetGeometry = prst
  delete shape.adjust
  delete shape.customGeometry
  slide.structureDirty = true
  return true
}

/**
 * Replace a shape's geometry with a freeform path ("Edit Points"): <a:prstGeom>
 * or the previous <a:custGeom> becomes a single-path <a:custGeom> whose w/h are
 * the path space (callers pass the element extents so points are EMU). The
 * model's customGeometry is re-parsed from the written XML so the render matches
 * a reopen byte for byte. Byte surgery baked directly into originalXml.
 */
export function setShapeCustomGeometry(
  slide: Slide,
  elementId: string,
  geom: CustGeomPath,
): boolean {
  if (!validCustGeomPath(geom)) return false
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  const xml = swapGeometryXml(patchedElementXml(el), custGeomXml(geom))
  if (xml == null) return false
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  applyCustomGeometryModel(el as TextElement, xml)
  slide.structureDirty = true
  return true
}

export function applyCustomGeometryModel(shape: TextElement, xml: string): void {
  const { cx, cy } = shape.transform.offset
  delete shape.presetGeometry
  delete shape.adjust
  delete shape.noGeometry
  shape.customGeometry = parseCustGeom(xml, cx, cy)
}

/** Serialize adjust values as an <a:avLst> ("val" formulas only). */
function avLstXml(adjust: Record<string, number>): string {
  const gds = Object.entries(adjust)
    .map(([n, v]) => `<a:gd name="${n}" fmla="val ${Math.round(v)}"/>`)
    .join('')
  return `<a:avLst>${gds}</a:avLst>`
}

/** Adjust maps must be non-empty, with safe names and finite values (they go straight into XML). */
export function validAdjust(adjust: Record<string, number>): boolean {
  const entries = Object.entries(adjust)
  return (
    entries.length > 0 && entries.every(([n, v]) => /^[A-Za-z0-9]+$/.test(n) && Number.isFinite(v))
  )
}

/** Replace the <a:avLst> inside <a:prstGeom> with the given adjust values; null without a prstGeom. */
export function swapAvLstXml(xml: string, adjust: Record<string, number>): string | null {
  const open = /<a:prstGeom\b[^>]*?(\/?)>/.exec(xml)
  if (!open) return null
  const av = avLstXml(adjust)
  if (open[1] === '/') {
    const tag = open[0].slice(0, -2) + '>'
    return (
      xml.slice(0, open.index) + tag + av + '</a:prstGeom>' + xml.slice(open.index + open[0].length)
    )
  }
  const end = xml.indexOf('</a:prstGeom>', open.index)
  if (end < 0) return null
  const innerStart = open.index + open[0].length
  const inner = xml.slice(innerStart, end)
  const avRe = /<a:avLst\b[^>]*\/>|<a:avLst\b[\s\S]*?<\/a:avLst>/
  const newInner = avRe.test(inner) ? inner.replace(avRe, av) : av + inner
  return xml.slice(0, innerStart) + newInner + xml.slice(end)
}

/**
 * Set a shape's preset-geometry adjust values (the "yellow handle" edit):
 * rewrite <a:avLst> inside <a:prstGeom>, keeping everything else. Byte surgery
 * baked directly into originalXml (same contract as setShapePresetGeometry).
 */
export function setShapeAdjustValues(
  slide: Slide,
  elementId: string,
  adjust: Record<string, number>,
): boolean {
  if (!validAdjust(adjust)) return false
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  const xml = swapAvLstXml(patchedElementXml(el), adjust)
  if (xml == null) return false
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  ;(el as TextElement).adjust = { ...adjust }
  slide.structureDirty = true
  return true
}

export const presetGeomXml = (prst: string) => `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`

/** Replace <a:prstGeom>/<a:custGeom> in a shape's XML with the given geometry; null if no anchor point exists. */
export function swapGeometryXml(xml: string, geomXml: string): string | null {
  const existing =
    /<a:prstGeom\b[^>]*\/>|<a:prstGeom\b[\s\S]*?<\/a:prstGeom>|<a:custGeom\b[\s\S]*?<\/a:custGeom>/.exec(
      xml,
    )
  if (existing)
    return xml.slice(0, existing.index) + geomXml + xml.slice(existing.index + existing[0].length)
  // No explicit geometry (bare text boxes): insert after </a:xfrm> inside spPr
  const xfrmClose = /<\/a:xfrm>/.exec(xml)
  if (!xfrmClose) return null
  const at = xfrmClose.index + xfrmClose[0].length
  return xml.slice(0, at) + geomXml + xml.slice(at)
}
