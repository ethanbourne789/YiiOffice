import { matchesElementRef } from '../identity'
import { calcBoundingBox, buildGrpSpXml } from '../insert'
import { sliceGroupChildXmls } from '../parse'
import { patchedElementXml } from './patch'
import { appendRawElements, materializeSlide } from './slide-ops'
import {
  patchElementXfrm,
  patchTextElementXml,
  patchElementFill,
  patchElementStroke,
  patchElementPPr,
  rebuildTxBody,
  type GradientFillPatch,
  type StrokePatch,
} from '../generate'
import {
  applyFontPatch,
  applyParagraphFormat,
  strokePatchToModel,
  type ElementFontPatch,
  type FontSizeMap,
  type ParagraphFormatPatch,
} from './shared'
import {
  validAdjust,
  swapAvLstXml,
  swapGeometryXml,
  presetGeomXml,
  applyCustomGeometryModel,
} from './geometry'
import { custGeomXml, validCustGeomPath, type CustGeomPath } from '../custgeom'
import { type OpenedPptx } from '../package'
import type { Slide, SlideElement, GroupElement, TextElement, Paragraph } from '../types'

// ── Element group / ungroup ───────────────────────────────────────────────

/**
 * Group multiple editable elements (text/shape/picture) into one p:grpSp.
 *
 * - Removes the selected elements from slide.elements, builds the p:grpSp XML and appends at the slide end
 * - Goes through the appendRawElements → materialize path (structureDirty=true, rebuilt on save)
 * - Only accepts text/shape/picture; passthrough/table/chart/group are refused outright
 * - Requires at least 2 elements
 *
 * Returns: { slide: fresh Slide, groupId: new group element id } or null (failure)
 */
export function groupElements(
  opened: OpenedPptx,
  slideIndex: number,
  sourceIds: string[],
): { slide: Slide; groupId: string } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide || sourceIds.length < 2) return null

  // Validate: only text/shape/picture allowed. Refs resolve like every other
  // op (parse-time id, durable e_<guid8>, e_<cNvPr id>), deduplicated in case
  // two forms name the same element.
  const GROUPABLE = new Set(['text', 'shape', 'picture'])
  const targets = [
    ...new Set(
      sourceIds
        .map((id) => slide.elements.find((e) => matchesElementRef(e, id)))
        .filter(Boolean) as SlideElement[],
    ),
  ]
  if (targets.length < 2) return null
  if (targets.some((e) => !GROUPABLE.has(e.type))) return null

  // Compute the bounding box
  const bbox = calcBoundingBox(targets)

  // Child XML: keep original bytes (patchedElementXml equals originalXml when clean)
  const childrenXml = targets.map((e) => patchedElementXml(e)).join('')

  // Build the grpSp XML
  const grpXml = buildGrpSpXml(slide, bbox, childrenXml)

  // Remove the selected elements from the current slide
  const grouped = new Set(targets)
  slide.elements = slide.elements.filter((e) => !grouped.has(e))

  // Append the grpSp and reparse
  const result = appendRawElements(opened, slideIndex, [grpXml])
  if (!result) return null

  return { slide: result.slide, groupId: result.elementIds[result.elementIds.length - 1]! }
}

/**
 * Ungroup: lift the group's children to the slide top level.
 *
 * Coordinate conversion rules:
 * - If childOffset defines a child coordinate system (chOff/chExt), child
 *   coordinates are based on it.
 * - This implementation sets chOff=off, chExt=ext (1:1 mapping) in buildGrpSpXml,
 *   so child coordinates are directly slide coordinates; groups from old files
 *   get the generic conversion too.
 * - Conversion: slideX = childX - chOff.x + group.off.x (plus * ext/chExt when scaled)
 *
 * Old-file groups pass their bytes through wholesale; after ungrouping they take
 * the rebuild path (structureDirty=true). Passthrough children (charts etc.)
 * keep their originalXml slices.
 *
 * Returns a fresh Slide or null.
 */
export function ungroupElement(
  opened: OpenedPptx,
  slideIndex: number,
  sourceId: string,
): Slide | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null

  const groupEl = slide.elements.find((e) => e.id === sourceId)
  if (!groupEl || groupEl.type !== 'group') return null

  const grp = groupEl as import('../types').GroupElement

  // Coordinate conversion parameters
  const gOff = grp.transform.offset // group's position on the slide
  const chOff = grp.childOffset ?? { x: 0, y: 0, cx: gOff.cx, cy: gOff.cy }

  // Scale factors (ext/chExt; groups built by this app are 1:1)
  const scaleX = chOff.cx > 0 ? gOff.cx / chOff.cx : 1
  const scaleY = chOff.cy > 0 ? gOff.cy / chOff.cy : 1

  // Direct child fragments in document order — same order as grp.children (parseGroup
  // sorts by source offset), so index i on both sides refers to the same child
  const childXmls = sliceGroupChildXmls(grp.anchor.originalXml)

  // Convert each child's coordinates into the slide coordinate system
  const liftedXmls: string[] = []
  for (let i = 0; i < childXmls.length; i++) {
    const childXml = childXmls[i]!
    const child = grp.children[i]
    if (!child) {
      // No corresponding model (e.g. an unparsed child), keep as-is
      liftedXmls.push(childXml)
      continue
    }
    const co = child.transform.offset
    const slideX = Math.round((co.x - chOff.x) * scaleX + gOff.x)
    const slideY = Math.round((co.y - chOff.y) * scaleY + gOff.y)
    const slideCx = Math.round(co.cx * scaleX)
    const slideCy = Math.round(co.cy * scaleY)
    const newXml = patchElementXfrmDirect(
      childXml,
      slideX,
      slideY,
      slideCx,
      slideCy,
      child.transform.rot,
    )
    liftedXmls.push(newXml)
  }

  // Remove the group from the slide
  slide.elements = slide.elements.filter((e) => e.id !== sourceId)

  if (liftedXmls.length === 0) {
    // Empty group or extraction failed; just materialize
    slide.structureDirty = true
    return materializeSlide(opened, slideIndex)
  }

  const result = appendRawElements(opened, slideIndex, liftedXmls)
  return result?.slide ?? null
}

/**
 * Replace the xfrm coordinates in an XML slice with new values directly (a:xfrm
 * or p:xfrm). Only changes <a:off>/<a:ext>, leaving rot/flip alone.
 * Conservative strategy: find the first xfrm block and replace off/ext inside it;
 * do nothing if none is found.
 */
function patchElementXfrmDirect(
  xml: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  rot: number,
): string {
  // Match an a:xfrm or p:xfrm block (non-greedy)
  const xfrmRe = /(<(?:a|p):xfrm\b[^>]*>)([\s\S]*?)(<\/(?:a|p):xfrm>)/
  const m = xfrmRe.exec(xml)
  if (!m) return xml

  const openTag = m[1]!
  const closeTag = m[3]!
  // A nested group's child coordinate system is kept verbatim (losing it scrambles all child coordinates)
  const chOff = /<a:chOff\b[^>]*\/>/.exec(m[2]!)?.[0] ?? ''
  const chExt = /<a:chExt\b[^>]*\/>/.exec(m[2]!)?.[0] ?? ''
  const inner = `<a:off x="${x}" y="${y}"/>` + `<a:ext cx="${cx}" cy="${cy}"/>` + chOff + chExt
  const rotAttr = rot ? ` rot="${rot}"` : ''
  // Keep the flipH/flipV attributes (extracted from openTag)
  const flipH = /flipH="1"/.test(openTag) ? ' flipH="1"' : ''
  const flipV = /flipV="1"/.test(openTag) ? ' flipV="1"' : ''
  const tag = openTag.startsWith('<a:') ? 'a:xfrm' : 'p:xfrm'
  const newOpen = `<${tag}${rotAttr}${flipH}${flipV}>`
  return xml.slice(0, m.index) + newOpen + inner + closeTag + xml.slice(m.index + m[0].length)
}

// ── In-group editing (patching group children; no ungrouping) ────────────
//
// Groups save via whole-originalXml passthrough; children have no independent
// byte anchors. In-group editing applies surgical patches to child slices inside
// originalXml, with structureDirty=true triggering the save rebuild.
// Slices match model children by <p:cNvPr id> (nvId) (document order ≠ children array order).

/** End position of the <tag …> element at start (incl. closing tag; correct for self-closing and same-name nesting). */
function elementEnd(xml: string, start: number, tag: string): number {
  const re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}>`, 'g')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0].startsWith('</')) {
      if (--depth === 0) return m.index + m[0].length
    } else if (m[0].endsWith('/>')) {
      if (depth === 0) return m.index + m[0].length
    } else {
      depth++
    }
  }
  return -1
}

export interface GroupChildSlice {
  start: number
  end: number
  xml: string
  nvId?: string
}

/** Direct child slices of the group XML (document order; a nested group's inner elements are not double-counted). */
export function groupChildSlices(grpXml: string): GroupChildSlice[] {
  // The content region starts after the group's own </p:grpSpPr> (preceded by the group's nv/grpSpPr)
  const prM = /<p:grpSpPr\b[^>]*\/>|<\/p:grpSpPr>/.exec(grpXml)
  let pos = prM ? prM.index + prM[0].length : 0
  const openRe = /<(p:(?:sp|pic|grpSp|graphicFrame|cxnSp)|mc:AlternateContent)(?=[\s/>])/g
  const slices: GroupChildSlice[] = []
  for (;;) {
    openRe.lastIndex = pos
    const m = openRe.exec(grpXml)
    if (!m) break
    const end = elementEnd(grpXml, m.index, m[1]!)
    if (end < 0) break
    // a markup-compatibility block is one child modelled from one branch; never edit its
    // branches as if they were two shapes
    if (m[1] === 'mc:AlternateContent') {
      pos = end
      continue
    }
    const xml = grpXml.slice(m.index, end)
    const nvId = /<p:cNvPr\b[^>]*\bid="([^"]+)"/.exec(xml)?.[1]
    slices.push({ start: m.index, end, xml, ...(nvId != null ? { nvId } : {}) })
    pos = end
  }
  return slices
}

/** Patch the in-group slice matching child.nvId in place; returns true on success. */
export function patchGroupChildXml(
  grp: GroupElement,
  child: SlideElement,
  patch: (xml: string) => string,
): boolean {
  if (!child.nvId) return false
  const grpXml = grp.anchor.originalXml
  const slice = groupChildSlices(grpXml).find((s) => s.nvId === child.nvId)
  if (!slice) return false
  grp.anchor.originalXml = grpXml.slice(0, slice.start) + patch(slice.xml) + grpXml.slice(slice.end)
  return true
}

/** Top-level group and its direct child (in-group editing goes one level; a nested subgroup is edited as a whole). */
export function findGroupChild(
  slide: Slide,
  groupId: string,
  childId: string,
): { grp: GroupElement; child: SlideElement } | null {
  const grp = slide.elements.find((e) => e.id === groupId && e.type === 'group') as
    GroupElement | undefined
  const child = grp?.children.find((c) => c.id === childId)
  return grp && child ? { grp, child } : null
}

/** Group-child geometry editing (offset is in the child EMU coordinate system, incl. chOff). */
export function editGroupChildTransform(
  slide: Slide,
  groupId: string,
  childId: string,
  offset: { x: number; y: number; cx: number; cy: number },
  rotationDeg: number,
): boolean {
  const found = findGroupChild(slide, groupId, childId)
  if (!found) return false
  const { grp, child } = found
  const prev = child.transform
  child.transform = { ...child.transform, offset, rot: Math.round(rotationDeg * 60000) }
  // patchElementXfrm reads the model transform; injects spPr when a placeholder child has no xfrm
  if (!patchGroupChildXml(grp, child, (xml) => patchElementXfrm(child, xml))) {
    child.transform = prev
    return false
  }
  slide.structureDirty = true
  return true
}

/** Group-child text editing: called after model paragraphs are updated; regenerates the slice's txBody. */
export function patchGroupChildText(slide: Slide, groupId: string, child: TextElement): boolean {
  const grp = slide.elements.find((e) => e.id === groupId && e.type === 'group') as
    GroupElement | undefined
  if (!grp) return false
  if (!patchGroupChildXml(grp, child, (xml) => patchTextElementXml(child, xml))) return false
  slide.structureDirty = true
  return true
}

/** Change font/size on a whole group child (same run-level semantics as setElementFont). */
export function setGroupChildFont(
  slide: Slide,
  groupId: string,
  childId: string,
  patch: ElementFontPatch,
  sizeMap?: FontSizeMap,
): boolean {
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  const t = child as TextElement
  if (!t.text?.paragraphs.length) return false
  applyFontPatch(t.text.paragraphs, patch, sizeMap)
  return patchGroupChildText(slide, groupId, t)
}

/** Group-child fill ('none' | #RRGGBB(AA) | gradient). */
export function editGroupChildFill(
  slide: Slide,
  groupId: string,
  childId: string,
  fill: string | GradientFillPatch,
): boolean {
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  ;(child as TextElement).fill =
    typeof fill === 'string'
      ? fill === 'none'
        ? { type: 'none' }
        : { type: 'solid', color: fill }
      : (() => {
          // Mirror the XML patch onto the model (radial is the legacy alias for path: circle),
          // so the canvas re-render shows the right shading without a reload
          const path = fill.path ?? (fill.radial ? ('circle' as const) : undefined)
          return {
            type: 'gradient' as const,
            stops: fill.stops,
            ...(fill.angle != null ? { angle: fill.angle } : {}),
            ...(path ? { path } : {}),
            ...(path && fill.fillTo ? { fillTo: fill.fillTo } : {}),
          }
        })()
  if (!patchGroupChildXml(found!.grp, child, (xml) => patchElementFill(xml, fill))) return false
  slide.structureDirty = true
  return true
}

/** Group-child stroke (null = remove the stroke). */
export function editGroupChildStroke(
  slide: Slide,
  groupId: string,
  childId: string,
  stroke: StrokePatch | null,
): boolean {
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape' && child.type !== 'picture'))
    return false
  const t = child as TextElement
  t.stroke = stroke ? strokePatchToModel(stroke) : undefined
  if (!patchGroupChildXml(found!.grp, child, (xml) => patchElementStroke(xml, stroke))) return false
  slide.structureDirty = true
  return true
}

/** Group-child adjust values (same avLst-swap semantics as setShapeAdjustValues). */
export function setGroupChildShapeAdjustValues(
  slide: Slide,
  groupId: string,
  childId: string,
  adjust: Record<string, number>,
): boolean {
  if (!validAdjust(adjust)) return false
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  let swapped = false
  const ok = patchGroupChildXml(found!.grp, child, (xml) => {
    const next = swapAvLstXml(xml, adjust)
    swapped = next != null
    return next ?? xml
  })
  if (!ok || !swapped) return false
  ;(child as TextElement).adjust = { ...adjust }
  slide.structureDirty = true
  return true
}

/** Group-child "Change Shape" (same geometry-swap semantics as setShapePresetGeometry). */
export function setGroupChildShapePresetGeometry(
  slide: Slide,
  groupId: string,
  childId: string,
  prst: string,
): boolean {
  if (!/^[A-Za-z0-9]+$/.test(prst)) return false
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  let swapped = false
  const ok = patchGroupChildXml(found!.grp, child, (xml) => {
    const next = swapGeometryXml(xml, presetGeomXml(prst))
    swapped = next != null
    return next ?? xml
  })
  if (!ok || !swapped) return false
  const shape = child as TextElement
  shape.presetGeometry = prst
  delete shape.adjust
  delete shape.customGeometry
  slide.structureDirty = true
  return true
}

/** Group-child freeform geometry (same semantics as setShapeCustomGeometry). */
export function setGroupChildShapeCustomGeometry(
  slide: Slide,
  groupId: string,
  childId: string,
  geom: CustGeomPath,
): boolean {
  if (!validCustGeomPath(geom)) return false
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  let written: string | null = null
  const ok = patchGroupChildXml(found!.grp, child, (xml) => {
    written = swapGeometryXml(xml, custGeomXml(geom))
    return written ?? xml
  })
  if (!ok || written == null) return false
  applyCustomGeometryModel(child as TextElement, written)
  slide.structureDirty = true
  return true
}

/** Paragraph formatting for a group child (same semantics as setGroupChildFont; the pPr patch is baked straight into the group bytes). */
export function setGroupChildParagraphFormat(
  slide: Slide,
  groupId: string,
  childId: string,
  patch: ParagraphFormatPatch,
  paraIndices?: number[],
): boolean {
  const found = findGroupChild(slide, groupId, childId)
  const child = found?.child
  if (!child || (child.type !== 'text' && child.type !== 'shape')) return false
  const t = child as TextElement
  if (!t.text?.paragraphs.length) return false
  const target = paraIndices
    ? paraIndices.map((i) => t.text!.paragraphs[i]).filter((p): p is Paragraph => !!p)
    : t.text.paragraphs
  if (!target.length) return false
  const dirty = applyParagraphFormat(target, patch)
  if (!Object.keys(dirty).length) return false
  if (paraIndices) dirty.paraIndices = paraIndices
  if (
    !patchGroupChildXml(
      found!.grp,
      t,
      (xml) => patchElementPPr(t, xml, dirty) ?? rebuildTxBody(t, xml),
    )
  ) {
    return false
  }
  slide.structureDirty = true
  return true
}
