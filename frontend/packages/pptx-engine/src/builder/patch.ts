import {
  alternateContentBranches,
  patchElementFill,
  patchElementPPr,
  patchElementStroke,
  patchElementXfrm,
  patchPictureSrcRect,
  patchTextElementXml,
  rebuildTxBody,
  type FillPatch,
} from '../generate'
import { ensureCreationId } from '../identity'
import { modelStrokeToPatch } from './shared'
import type { Slide, SlideElement, TextElement } from '../types'

/**
 * Rebuild one slideN.xml: dirty elements are patch-regenerated, the rest pass
 * through as original bytes. With no dirty elements the result == originalXml.
 */
export function patchSlideXml(slide: Slide): string {
  const parts: string[] = [slide.bodyPrefix]
  for (const el of slide.elements) {
    parts.push(patchedElementXml(el))
    if (el.anchor.gapAfter) parts.push(el.anchor.gapAfter)
  }
  parts.push(slide.bodySuffix)
  return parts.join('')
}

/**
 * Apply a byte patch to an element's own XML. An element anchored to a whole
 * <mc:AlternateContent> block was modelled from one branch, so the patch lands
 * inside that branch only; spPr-level patches (`mirror`) also go to sibling
 * branches of the same tag so PowerPoint, which renders the Choice, shows the
 * same box/fill/stroke as our Fallback-based renderer. Text patches never
 * mirror: a Choice body may be math or another vocabulary.
 */
export function patchAnchorXml(
  el: SlideElement,
  xml: string,
  patch: (xml: string) => string,
  mirror = false,
): string {
  const branches = alternateContentBranches(xml)
  if (!branches) return patch(xml)
  const fromFallback = el.type === 'text' || el.type === 'shape' || el.type === 'picture'
  const own =
    (fromFallback
      ? branches.find((b) => b.fallback)
      : branches.find((b) => !b.fallback && b.tag === 'p:graphicFrame')) ?? branches[0]!
  let out = ''
  let cursor = 0
  for (const b of branches) {
    if (b !== own && !(mirror && b.tag === own.tag)) continue
    out += xml.slice(cursor, b.start) + patch(xml.slice(b.start, b.end))
    cursor = b.end
  }
  return out + xml.slice(cursor)
}

/** One element's current XML slice (dirty elements patch-regenerated, clean elements original bytes). */
export function patchedElementXml(el: SlideElement): string {
  // Progressive identity hardening: an element whose bytes are being rewritten
  // anyway gets a creationId minted into its anchor (idempotent — repeated calls
  // from commitSaved/buildZip see the same GUID). Clean elements pass through
  // untouched, so unedited decks stay byte-identical on save.
  if (
    el.dirty ||
    el.dirtyTransform ||
    el.dirtyFill ||
    el.dirtyStroke ||
    el.dirtySrcRect ||
    el.dirtyPPr
  ) {
    ensureCreationId(el)
  }
  let xml = el.anchor.originalXml
  if (el.dirty && (el.type === 'text' || el.type === 'shape')) {
    xml = patchAnchorXml(el, xml, (x) => patchTextElementXml(el as TextElement, x))
  }
  // Surgical paragraph-property patch (run bytes untouched); paragraph count mismatch (rare) falls back to a full rebuild
  if (el.dirtyPPr && (el.type === 'text' || el.type === 'shape') && (el as TextElement).text) {
    const t = el as TextElement
    const dirty = el.dirtyPPr
    xml = patchAnchorXml(el, xml, (x) => patchElementPPr(t, x, dirty) ?? rebuildTxBody(t, x))
  }
  // graphicFrame (table/chart/passthrough) uses the p:xfrm patch, everything else a:xfrm
  if (el.dirtyTransform) {
    xml = patchAnchorXml(el, xml, (x) => patchElementXfrm(el, x), true)
  }
  if (el.dirtyFill && (el.type === 'text' || el.type === 'shape')) {
    const fill = (el as TextElement).fill
    const patch: FillPatch | null =
      fill?.type === 'solid'
        ? fill.color
        : fill?.type === 'none'
          ? 'none'
          : fill?.type === 'gradient'
            ? {
                stops: fill.stops,
                ...(fill.angle != null ? { angle: fill.angle } : {}),
                ...(fill.path ? { path: fill.path } : {}),
                ...(fill.path && fill.fillTo ? { fillTo: fill.fillTo } : {}),
              }
            : null
    if (patch !== null) xml = patchAnchorXml(el, xml, (x) => patchElementFill(x, patch), true)
  }
  if (el.dirtyStroke && (el.type === 'text' || el.type === 'shape' || el.type === 'picture')) {
    const stroke = (el as TextElement).stroke
    const patch = stroke ? modelStrokeToPatch(stroke) : null
    xml = patchAnchorXml(el, xml, (x) => patchElementStroke(x, patch), true)
  }
  if (el.dirtySrcRect && el.type === 'picture') {
    const pic = el as import('../types').PictureElement
    xml = patchAnchorXml(el, xml, (x) => patchPictureSrcRect(x, pic.srcRect ?? null), true)
  }
  return xml
}

/**
 * Fetch a slide's patch-rebuilt result directly (Phase 1: with no dirty elements
 * it should equal originalXml). Lets tests verify the scan's
 * prefix/elements/suffix concatenation is lossless.
 */
export function reassembleSlideXml(slide: Slide): string {
  const parts: string[] = [slide.bodyPrefix]
  for (const el of slide.elements) {
    parts.push(el.anchor.originalXml)
    if (el.anchor.gapAfter) parts.push(el.anchor.gapAfter)
  }
  parts.push(slide.bodySuffix)
  return parts.join('')
}
