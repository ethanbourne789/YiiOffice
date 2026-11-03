import { textToBytes } from '../browser-compat'
import { relsPathFor } from '../zip'
import { type OpenedPptx } from '../package'
import { patchSlideXml, patchedElementXml } from './patch'
import { appendRawElements, materializeSlide, LAYOUT_REL_TYPE } from './slide-ops'
import { parseLayoutPlaceholders, placeholderSpXml } from '../layout'
import { escapeXmlAttr, maxRelationshipIdNumber } from '../xml-utils'
import { listMasterParts, parseMasterPart } from '../master-edit'
import type { Slide } from '../types'

// title/ctrTitle share one slot; content placeholders (body/obj/subTitle/untyped) match by idx
function phSlotKey(type: string, idx: string): string {
  return type === 'title' || type === 'ctrTitle' ? 'title' : `body:${idx}`
}

/**
 * Switch an existing slide's layout: point the slide rels' slideLayout
 * relationship at the new layout, then reparse (inheritance chain/decoration
 * layer/placeholder default styles all refreshed). Placeholder positions are kept
 * (existing shapes stay put; use resetSlideLayout to snap
 * them back). Layout placeholders with no counterpart on the slide are added as
 * empty prompt boxes (PowerPoint semantics).
 */
export function setSlideLayout(
  opened: OpenedPptx,
  slideIndex: number,
  layoutPath: string,
): Slide | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  if (!opened.archive.readText(layoutPath)) return null
  const relsPath = relsPathFor(slide.path)
  const rels = opened.archive.readText(relsPath)
  if (!rels) return null
  const relTarget = `../${layoutPath.slice('ppt/'.length)}`
  const existing = new RegExp(
    `<Relationship\\b[^>]*Type="${LAYOUT_REL_TYPE}"[^>]*/>|<Relationship\\b[^>]*/>`,
    'g',
  )
  let next: string | null = null
  for (const m of rels.matchAll(existing)) {
    if (!m[0].includes('slideLayout')) continue
    next =
      rels.slice(0, m.index) +
      m[0].replace(/\bTarget="[^"]*"/, `Target="${escapeXmlAttr(relTarget)}"`) +
      rels.slice(m.index! + m[0].length)
    break
  }
  if (!next) {
    const maxRid = maxRelationshipIdNumber(rels)
    next = rels.replace(
      '</Relationships>',
      `<Relationship Id="rId${maxRid + 1}" Type="${LAYOUT_REL_TYPE}" Target="${escapeXmlAttr(relTarget)}"/></Relationships>`,
    )
  }
  opened.archive.entries.set(relsPath, textToBytes(next))

  const layoutPhs = parseLayoutPlaceholders(opened.archive.readText(layoutPath) ?? '')
  const taken = new Set<string>()
  let maxId = 1
  for (const el of slide.elements) {
    const xml = patchedElementXml(el)
    const m = /<p:ph\b([^>]*?)\/?>/.exec(xml)
    const type = m ? (/\btype="([^"]*)"/.exec(m[1]!)?.[1] ?? '') : ''
    // ftr/sldNum/dt live outside the content-slot namespace (their idx 2/3/4 must not block body slots)
    if (m && !['ftr', 'sldNum', 'dt'].includes(type))
      taken.add(phSlotKey(type, /\bidx="([^"]*)"/.exec(m[1]!)?.[1] ?? ''))
    for (const idm of xml.matchAll(/<p:cNvPr\s[^>]*\bid=["'](\d+)["']/g))
      maxId = Math.max(maxId, Number(idm[1]))
  }
  const missing = layoutPhs.filter((ph) => !taken.has(phSlotKey(ph.type, ph.idx)))
  if (missing.length) {
    const r = appendRawElements(
      opened,
      slideIndex,
      missing.map((ph, i) => placeholderSpXml(ph, maxId + 1 + i)),
    )
    if (r) return r.slide
  }
  return materializeSlide(opened, slideIndex)
}

/**
 * Reset layout: placeholder elements drop their explicit <a:xfrm>, geometry falls
 * back to layout/master inheritance (restoring the inherited
 * position/size).
 */
export function resetSlideLayout(opened: OpenedPptx, slideIndex: number): Slide | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  let changed = false
  for (const el of slide.elements) {
    if (!el.placeholder || (el.type !== 'text' && el.type !== 'shape')) continue
    const xml = patchedElementXml(el)
    // spPr's xfrm is the first <a:xfrm> in the <p:sp> (txBody has no xfrm)
    const stripped = xml.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, '')
    if (stripped === xml) continue
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
    el.dirtyPPr = undefined
    el.anchor.originalXml = stripped
    changed = true
  }
  if (!changed) return slide
  slide.structureDirty = true
  return materializeSlide(opened, slideIndex)
}

/**
 * Slide size (16:9 ↔ 4:3 etc.): edits <p:sldSz> in presentation.xml.
 * Content reflows with the canvas: each axis scales independently
 * (sx = cx/oldCx, sy = cy/oldCy), like PowerPoint's stretch on size change.
 * Anisotropic on purpose — it fills the new canvas with no letterbox bands
 * and makes A→B→A a true round-trip (within 1 EMU of rounding), which a
 * uniform fit-and-center scale cannot be. Font sizes are left alone.
 */
export function setSlideSize(opened: OpenedPptx, cx: number, cy: number): boolean {
  const { deck, archive } = opened
  const old = deck.size
  if (old.cx === cx && old.cy === cy) return false
  const presPath = 'ppt/presentation.xml'
  const pres = archive.readText(presPath)
  if (!pres) return false
  const sldSz = /<p:sldSz\b[^>]*?\/?>/.exec(pres)?.[0]
  if (!sldSz) return false
  // re-emit the tag from its parsed attributes: cx=/cy= are rewritten whatever
  // quote style they were written in, and a tag carrying neither cannot be
  // resized — reporting success would rescale the model while the saved file
  // kept the old size
  const hasCx = /\bcx=["']\d+["']/.test(sldSz)
  const hasCy = /\bcy=["']\d+["']/.test(sldSz)
  if (!hasCx && !hasCy) return false
  const next = pres.replace(sldSz, () =>
    sldSz.replace(/\bcx=["']\d+["']/, `cx="${cx}"`).replace(/\bcy=["']\d+["']/, `cy="${cy}"`),
  )
  archive.entries.set(presPath, textToBytes(next))
  deck.size = { cx, cy }

  const sx = cx / old.cx
  const sy = cy / old.cy
  const scaleOffset = (o: { x: number; y: number; cx: number; cy: number }) => {
    o.x = Math.round(o.x * sx)
    o.y = Math.round(o.y * sy)
    o.cx = Math.round(o.cx * sx)
    o.cy = Math.round(o.cy * sy)
  }
  for (const slide of deck.slides) {
    for (const el of slide.elements) {
      const o = el.transform.offset
      if (!o.cx && !o.cy) continue
      scaleOffset(o)
      el.dirtyTransform = true
    }
  }

  // layout/master scaled in sync (PowerPoint also rewrites masters on resize;
  // otherwise decorations/inherited placeholders still lay out at the old size).
  // A deliberate user action that is the exception to the never-write-masters rule.
  for (const part of listMasterParts(archive)) {
    const partSlide = parseMasterPart(archive, part.partPath)
    if (!partSlide) continue
    let touched = false
    for (const el of partSlide.elements) {
      const o = el.transform.offset
      if (!o.cx && !o.cy) continue
      scaleOffset(o)
      el.dirtyTransform = true
      touched = true
    }
    if (touched) archive.entries.set(part.partPath, textToBytes(patchSlideXml(partSlide)))
  }
  deck.slides.forEach((_, i) => materializeSlide(opened, i))
  return true
}
