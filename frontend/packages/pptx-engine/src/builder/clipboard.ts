import { textToBytes } from '../browser-compat'
import { relsPathFor, resolveTarget } from '../zip'
import { collectPart, importClipboardParts } from '../slide-transfer'
import { nextCNvPrId } from '../insert'
import { escapeXmlAttr, maxRelationshipIdNumber } from '../xml-utils'
import { patchedElementXml } from './patch'
import { appendRawElements } from './slide-ops'
import { type OpenedPptx } from '../package'
import type { Slide, SlideElement } from '../types'

// ── Element clipboard ───────────────────────────────────────────────────

export interface ElementClipboardItem {
  /** The element's current XML slice (incl. unsaved patches) */
  xml: string
  /** rId referenced by the xml → absolute part path (External relationships keep the target verbatim) */
  rels: Array<{ rid: string; type: string; target: string; external?: boolean }>
  /** Dependency part bytes (base64, keyed by absolute path), so the paste target can be a different deck */
  parts?: Readonly<Record<string, string>>
  /** ContentType per dependency: keyed by lower-case extension or by part path */
  contentTypes?: Readonly<Record<string, string>>
}

const RID_ATTR_RE = /\br:(?:embed|link|id)="(rId\d+)"/g

/** Copy: grab the element's current XML and the relationships it references (part paths that pictures/charts etc. point at). */
export function copyElementData(
  opened: OpenedPptx,
  slide: Slide,
  el: SlideElement,
): ElementClipboardItem {
  const xml = patchedElementXml(el)
  const slideRels = opened.archive.readRels(slide.path)
  const rels: ElementClipboardItem['rels'] = []
  const parts: Record<string, string> = {}
  const contentTypes: Record<string, string> = {}
  const seen = new Set<string>()
  for (const m of xml.matchAll(RID_ATTR_RE)) {
    const rid = m[1]!
    if (seen.has(rid)) continue
    seen.add(rid)
    const rel = slideRels.get(rid)
    if (!rel) continue
    const external = rel.targetMode === 'External'
    const target = external ? rel.target : resolveTarget(slide.path, rel.target)
    // Slide-jump hyperlinks reference a whole slide; bundling it would drag in its
    // layout/master/theme graph, so keep those as path-only references
    if (!external && !rel.type.endsWith('/slide')) {
      collectPart(opened.archive, target, parts, contentTypes)
    }
    rels.push({
      rid,
      type: rel.type,
      target,
      ...(external ? { external: true } : {}),
    })
  }
  return { xml, rels, ...(Object.keys(parts).length ? { parts, contentTypes } : {}) }
}

/** 'ppt/media/image1.png' → the relative Target '../media/image1.png' in the slide rels */
function relTargetFromSlide(absTarget: string): string {
  return absTarget.startsWith('ppt/') ? `../${absTarget.slice(4)}` : `/${absTarget}`
}

/**
 * Paste: land bundled dependency parts (byte-identical ones already in the
 * target are shared, so a same-deck paste copies no media), rels surgery
 * (reuse the rId when the target slide already has a relationship with the
 * same type+target), renumber cNvPr ids, offset the whole thing, append, and
 * reparse.
 */
export function pasteElements(
  opened: OpenedPptx,
  slideIndex: number,
  items: ElementClipboardItem[],
  shiftEmu: { dx: number; dy: number },
): { slide: Slide; elementIds: string[] } | null {
  const { archive, deck } = opened
  const slide = deck.slides[slideIndex]
  if (!slide || !items.length) return null

  const relsPath = relsPathFor(slide.path)
  let relsXml =
    archive.readText(relsPath) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  let relsDirty = false
  let maxRid = maxRelationshipIdNumber(relsXml)
  // The target slide's existing relationships (type+resolved target → rId); ones created during the paste count too
  const byKey = new Map<string, string>()
  for (const rel of archive.readRels(slide.path).values()) {
    const abs = rel.targetMode === 'External' ? rel.target : resolveTarget(slide.path, rel.target)
    byKey.set(`${rel.type} ${abs}`, rel.id)
  }

  // Land dependency parts the target deck is missing (all items at once, so shared media imports once)
  const bundledParts: Record<string, string> = {}
  const bundledCT: Record<string, string> = {}
  for (const item of items) {
    Object.assign(bundledParts, item.parts ?? {})
    Object.assign(bundledCT, item.contentTypes ?? {})
  }
  const pathMap = Object.keys(bundledParts).length
    ? importClipboardParts(archive, bundledParts, bundledCT)
    : null

  let nextId = nextCNvPrId(slide)
  const xmls = items.map((item) => {
    let xml = item.xml
    for (const rel of item.rels) {
      const landed = rel.external ? rel.target : (pathMap?.get(rel.target) ?? rel.target)
      const key = `${rel.type} ${landed}`
      let rid = byKey.get(key)
      if (!rid) {
        rid = `rId${++maxRid}`
        const target = rel.external ? rel.target : relTargetFromSlide(landed)
        const mode = rel.external ? ' TargetMode="External"' : ''
        // Replacement must be a function: a string replacement expands $&, $`,
        // $' and $$, and an external target is a user-supplied URL, so a $& in
        // it substituted the matched </Relationships> into the middle of the
        // Target attribute and left the part malformed. Several other
        // relationship writers here already pass a function.
        relsXml = relsXml.replace(
          '</Relationships>',
          () =>
            `<Relationship Id="${rid}" Type="${rel.type}" Target="${escapeXmlAttr(target)}"${mode}/></Relationships>`,
        )
        relsDirty = true
        byKey.set(key, rid)
      }
      if (rid !== rel.rid) {
        xml = xml.replace(new RegExp(`\\br:(embed|link|id)="${rel.rid}"`, 'g'), `r:$1="${rid}"`)
      }
    }
    xml = xml.replace(
      /(<p:cNvPr\s[^>]*\bid=["'])\d+(["'])/g,
      (_a, pre: string, post: string) => `${pre}${nextId++}${post}`,
    )
    // Pasted elements are new identities: mint fresh creationIds so durable ids
    // never collide with their source elements on the same slide
    xml = xml.replace(
      /(<a16:creationId[^>]*\bid=")\{?[0-9A-Fa-f-]{36}\}?(")/g,
      (_a, pre: string, post: string) =>
        `${pre}{${globalThis.crypto.randomUUID().toUpperCase()}}${post}`,
    )
    // Offset only the outermost xfrm's off (group child coordinate systems stay put)
    xml = xml.replace(/<a:off\b[^>]*\/>/, (tag) =>
      tag
        .replace(/\bx="(-?\d+)"/, (_m, v: string) => `x="${Number(v) + shiftEmu.dx}"`)
        .replace(/\by="(-?\d+)"/, (_m, v: string) => `y="${Number(v) + shiftEmu.dy}"`),
    )
    return xml
  })

  if (relsDirty) archive.entries.set(relsPath, textToBytes(relsXml))
  return appendRawElements(opened, slideIndex, xmls)
}
