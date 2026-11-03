import { elementSpid } from '../animation'
import { patchedElementXml } from './patch'
import type { Slide, SlideElement } from '../types'

// ── Connector move-following ────────────────────────────────────────────

export type ConnectionSide = 'top' | 'left' | 'bottom' | 'right'

// presetShapeDefinitions cxnLst order: most presets list the four edge
// midpoints as top/left/bottom/right; the ellipse interleaves four diagonal
// sites, so its edge midpoints sit at even indexes
const ELLIPSE_SIDES: Record<ConnectionSide, number> = { top: 0, left: 2, bottom: 4, right: 6 }
const RECT_SIDES: Record<ConnectionSide, number> = { top: 0, left: 1, bottom: 2, right: 3 }

/** Connection-site index of a shape edge midpoint for the element's preset geometry. */
export function connectionSiteForSide(el: SlideElement, side: ConnectionSide): number {
  const prst = el.type === 'shape' || el.type === 'picture' ? el.presetGeometry : undefined
  return (prst === 'ellipse' ? ELLIPSE_SIDES : RECT_SIDES)[side]
}

/** Connection point index → shape edge midpoint (edge sites of the preset geometry, else center). */
function connectionPoint(el: SlideElement, idx: number): { x: number; y: number } {
  const o = el.transform.offset
  const prst = el.type === 'shape' || el.type === 'picture' ? el.presetGeometry : undefined
  const sides = prst === 'ellipse' ? ELLIPSE_SIDES : RECT_SIDES
  if (idx === sides.top) return { x: o.x + o.cx / 2, y: o.y }
  if (idx === sides.left) return { x: o.x, y: o.y + o.cy / 2 }
  if (idx === sides.bottom) return { x: o.x + o.cx / 2, y: o.y + o.cy }
  if (idx === sides.right) return { x: o.x + o.cx, y: o.y + o.cy / 2 }
  if (prst === 'ellipse' && idx >= 1 && idx <= 7) {
    // odd ellipse sites are the 45-degree points: inset (1 - 1/sqrt2)/2 of each extent
    const k = 0.1464
    const left = idx === 1 || idx === 3
    const top = idx === 1 || idx === 7
    return {
      x: o.x + (left ? o.cx * k : o.cx * (1 - k)),
      y: o.y + (top ? o.cy * k : o.cy * (1 - k)),
    }
  }
  return { x: o.x + o.cx / 2, y: o.y + o.cy / 2 }
}

/**
 * Re-lay connectors after connected shapes move: the geometry box = the bounding
 * box of the two endpoints, direction expressed via flip (exact for straight
 * connectors; elbow connectors approximated by the same bounding box). An
 * unattached end keeps its current endpoint. Returns the number of connectors
 * updated (>0 means each is flagged dirtyTransform).
 */
export function updateConnectorsForMoved(slide: Slide, movedIds: string[]): number {
  const movedSpids = new Set<number>()
  for (const id of movedIds) {
    const el = slide.elements.find((e) => e.id === id)
    const spid = el ? elementSpid(el) : null
    if (spid != null) movedSpids.add(spid)
  }
  if (!movedSpids.size) return 0
  const bySpid = new Map<number, SlideElement>()
  for (const e of slide.elements) {
    const spid = elementSpid(e)
    if (spid != null) bySpid.set(spid, e)
  }
  let n = 0
  for (const el of slide.elements) {
    const cxn = el.connection
    if (!cxn) continue
    if (!((cxn.start && movedSpids.has(cxn.start.id)) || (cxn.end && movedSpids.has(cxn.end.id))))
      continue
    const t = el.transform
    const o = t.offset
    const curStart = { x: t.flipH ? o.x + o.cx : o.x, y: t.flipV ? o.y + o.cy : o.y }
    const curEnd = { x: t.flipH ? o.x : o.x + o.cx, y: t.flipV ? o.y : o.y + o.cy }
    const stTarget = cxn.start ? bySpid.get(cxn.start.id) : undefined
    const endTarget = cxn.end ? bySpid.get(cxn.end.id) : undefined
    const p1 = stTarget ? connectionPoint(stTarget, cxn.start!.idx) : curStart
    const p2 = endTarget ? connectionPoint(endTarget, cxn.end!.idx) : curEnd
    t.offset = {
      x: Math.round(Math.min(p1.x, p2.x)),
      y: Math.round(Math.min(p1.y, p2.y)),
      cx: Math.round(Math.abs(p2.x - p1.x)),
      cy: Math.round(Math.abs(p2.y - p1.y)),
    }
    t.flipH = p1.x > p2.x
    t.flipV = p1.y > p2.y
    el.dirtyTransform = true
    n++
  }
  return n
}

/**
 * Write/clear a connector's shape attachments (<a:stCxn>/<a:endCxn> in
 * p:cNvCxnSpPr; id = target shape's cNvPr id, idx = connection point index).
 * undefined leaves that end unchanged, null detaches it. Byte surgery baked
 * directly into originalXml (pending patches are materialized first).
 */
export function setElementConnection(
  slide: Slide,
  elementId: string,
  patch: {
    start?: { id: number; idx: number } | null
    end?: { id: number; idx: number } | null
  },
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el) return false
  let xml = patchedElementXml(el)
  // Normalize self-closing <p:cNvCxnSpPr/> so children can be inserted
  xml = xml.replace(/<p:cNvCxnSpPr([^>]*)\/>/, '<p:cNvCxnSpPr$1></p:cNvCxnSpPr>')
  const m = /<p:cNvCxnSpPr([^>]*)>([\s\S]*?)<\/p:cNvCxnSpPr>/.exec(xml)
  if (!m) return false
  const curSt = /<a:stCxn\b[^>]*\/>/.exec(m[2]!)?.[0] ?? ''
  const curEnd = /<a:endCxn\b[^>]*\/>/.exec(m[2]!)?.[0] ?? ''
  let rest = m[2]!.replace(/<a:stCxn\b[^>]*\/>|<a:endCxn\b[^>]*\/>/g, '')
  // Schema order: cxnSpLocks? stCxn? endCxn? extLst?
  let locks = ''
  const lockM = /<a:cxnSpLocks\b[^>]*(?:\/>|>[\s\S]*?<\/a:cxnSpLocks>)/.exec(rest)
  if (lockM) {
    locks = lockM[0]
    rest = rest.replace(lockM[0], '')
  }
  const tag = (which: 'st' | 'end', v: { id: number; idx: number }) =>
    `<a:${which}Cxn id="${v.id}" idx="${v.idx}"/>`
  const stTag = patch.start === undefined ? curSt : patch.start ? tag('st', patch.start) : ''
  const endTag = patch.end === undefined ? curEnd : patch.end ? tag('end', patch.end) : ''
  xml =
    xml.slice(0, m.index) +
    `<p:cNvCxnSpPr${m[1]}>${locks}${stTag}${endTag}${rest}</p:cNvCxnSpPr>` +
    xml.slice(m.index + m[0].length)
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  const start = patch.start === undefined ? el.connection?.start : (patch.start ?? undefined)
  const end = patch.end === undefined ? el.connection?.end : (patch.end ?? undefined)
  el.connection =
    start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : undefined
  slide.structureDirty = true
  return true
}
