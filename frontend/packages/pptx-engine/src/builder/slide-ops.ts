import { textToBytes } from '../browser-compat'
import { PackageArchive, relsPathFor, resolveTarget, type Relationship } from '../zip'
import { parseSlideFromArchive, type OpenedPptx } from '../package'
import { patchSlideXml } from './patch'
import {
  patchSlideAdvanceTimeXml,
  patchSlideHiddenXml,
  patchSlideTransitionXml,
  readSlideAdvanceTimeXml,
  readSlideHiddenXml,
  readSlideTransitionXml,
  type SlideTransitionKind,
} from '../generate'
import {
  chooseLayout,
  collectSlideBundle,
  importSourceLayout,
  materializeSlideBundle,
  type SlideBundle,
} from '../slide-transfer'
import { moveSlide } from '../sections'
import { removePartWithOwnedResources } from '../resource-cleanup'
import { prepareInsertSlideWithLayout } from '../layout'
import { BLANK_SLIDE_XML } from '../blank'
import { escapeXmlAttr, maxRelationshipIdNumber } from '../xml-utils'
import { nextSlideId } from '../slide-ids'
import type { Slide, TextElement } from '../types'

// ── New slides (duplicate an existing slide / blank slide) ────────────

const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'

/** New slide part path: number = existing max + 1. */
function nextSlidePath(archive: PackageArchive): string {
  let maxNum = 0
  for (const path of archive.entries.keys()) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)
    if (m) maxNum = Math.max(maxNum, Number(m[1]))
  }
  return `ppt/slides/slide${maxNum + 1}.xml`
}

/**
 * Register a new slide part (already written into the archive) with the package
 * and insert it into the deck: add an Override to [Content_Types].xml, register a
 * new sldId/rId in presentation.xml(.rels) (inserted after the sourceIndex slide's
 * sldId), and splice the parsed new slide model into deck.slides.
 */
function registerNewSlide(opened: OpenedPptx, sourceIndex: number, newPath: string): Slide | null {
  const { deck, archive } = opened
  const src = deck.slides[sourceIndex]
  if (!src) return null

  const ctPath = '[Content_Types].xml'
  const ct = archive.readText(ctPath)
  if (ct) {
    const override = `<Override PartName="/${newPath}" ContentType="${SLIDE_CONTENT_TYPE}"/>`
    archive.entries.set(
      ctPath,
      textToBytes(ct.replace('</Types>', () => `${override}</Types>`)),
    )
  }

  const presRelsPath = 'ppt/_rels/presentation.xml.rels'
  const presRels = archive.readText(presRelsPath)
  const presPath = 'ppt/presentation.xml'
  const pres = archive.readText(presPath)
  if (!presRels || !pres) return null
  const maxRid = maxRelationshipIdNumber(presRels)
  const newRid = `rId${maxRid + 1}`
  const relXml = `<Relationship Id="${newRid}" Type="${SLIDE_REL_TYPE}" Target="${newPath.slice('ppt/'.length)}"/>`
  archive.entries.set(
    presRelsPath,
    textToBytes(presRels.replace('</Relationships>', () => `${relXml}</Relationships>`)),
  )

  const newSldId = `<p:sldId id="${nextSlideId(pres)}" r:id="${newRid}"/>`
  // Insert after the source slide's sldId; append to the end of the list when not found
  const srcRid = [...archive.readRels(presPath).values()].find(
    (r) => resolveTarget(presPath, r.target) === src.path,
  )?.id
  const srcTag = srcRid
    ? new RegExp(`<p:sldId\\s[^>]*r:id="${srcRid}"[^>]*/>`).exec(pres)?.[0]
    : undefined
  const nextPres = srcTag
    ? pres.replace(srcTag, () => `${srcTag}${newSldId}`)
    : pres.replace('</p:sldIdLst>', () => `${newSldId}</p:sldIdLst>`)
  archive.entries.set(presPath, textToBytes(nextPres))

  const slide = parseSlideFromArchive(archive, newPath)
  if (!slide) return null
  deck.slides.splice(sourceIndex + 1, 0, slide)
  return slide
}

/**
 * Duplicate the sourceIndex slide as a new slide inserted after it; returns the
 * new slide model.
 *
 * The new slideK.xml includes the source slide's unsaved patches; rels are copied
 * verbatim but with notesSlide removed, so two slides don't share the same notes.
 */
export function duplicateSlide(
  opened: OpenedPptx,
  sourceIndex: number,
  opts?: { clearText?: boolean },
): Slide | null {
  const { deck, archive } = opened
  const src = deck.slides[sourceIndex]
  if (!src) return null

  const newPath = nextSlidePath(archive)
  archive.entries.set(newPath, textToBytes(patchSlideXml(src)))

  const srcRels = archive.readText(relsPathFor(src.path))
  if (srcRels) {
    const cleaned = srcRels.replace(/<Relationship\s[^>]*\/notesSlide"[^>]*\/>/g, '')
    archive.entries.set(relsPathFor(newPath), textToBytes(cleaned))
  }

  const slide = registerNewSlide(opened, sourceIndex, newPath)
  if (!slide) return null
  if (opts?.clearText) {
    for (const el of slide.elements) {
      if ((el.type === 'text' || el.type === 'shape') && (el as TextElement).text) {
        ;(el as TextElement).text!.paragraphs = [{ runs: [{ text: '' }] }]
        el.dirty = true
      }
    }
  }
  return slide
}

/**
 * Snapshot a slide for pasting into another deck (or back into this one),
 * including its unsaved edits and every part it references.
 */
export function copySlide(opened: OpenedPptx, sourceIndex: number): SlideBundle | null {
  const slide = opened.deck.slides[sourceIndex]
  if (!slide) return null
  return collectSlideBundle(opened.archive, slide.path, patchSlideXml(slide))
}

/**
 * Paste a bundle after `afterIndex` (-1 pastes at the front). By default the
 * slide adopts a layout from this deck — matched by the source layout's name,
 * else the neighbour's — so it takes on the destination theme ("use destination
 * theme"). With `keepSourceFormatting` the bundled layout→master→theme chain is
 * imported instead, so the slide keeps its source look; falls back to the
 * destination theme when the bundle carries no chain.
 */
export function pasteSlide(
  opened: OpenedPptx,
  afterIndex: number,
  bundle: SlideBundle,
  opts?: { keepSourceFormatting?: boolean },
): Slide | null {
  const { deck, archive } = opened
  if (deck.slides.length === 0) return null
  const anchorIndex = Math.min(Math.max(afterIndex, -1), deck.slides.length - 1)
  const neighbour = deck.slides[anchorIndex] ?? deck.slides[0]
  const layoutPath =
    (opts?.keepSourceFormatting ? importSourceLayout(archive, bundle) : null) ??
    chooseLayout(archive, bundle, neighbour?.path)
  if (!layoutPath) return null

  const newPath = nextSlidePath(archive)
  const relsXml = materializeSlideBundle(archive, bundle, newPath, layoutPath)
  archive.entries.set(newPath, textToBytes(bundle.slideXml))
  archive.entries.set(relsPathFor(newPath), textToBytes(relsXml))

  if (anchorIndex < 0) {
    // registerNewSlide can only insert after a slide, so land at 1 and move up
    const slide = registerNewSlide(opened, 0, newPath)
    if (slide) moveSlide(opened, deck.slides.indexOf(slide), 0)
    return slide
  }
  return registerNewSlide(opened, anchorIndex, newPath)
}

/**
 * Insert a truly blank slide after the sourceIndex slide: content is an empty
 * spTree, rels only point at the source slide's slideLayout — layout/master
 * background and decorations carry over, slide elements are empty.
 */
export function insertBlankSlide(opened: OpenedPptx, sourceIndex: number): Slide | null {
  const { deck, archive } = opened
  const src = deck.slides[sourceIndex]
  if (!src) return null

  const newPath = nextSlidePath(archive)
  archive.entries.set(newPath, textToBytes(BLANK_SLIDE_XML))

  // Both slides live under ppt/slides/, so the source layout relationship's relative Target can be reused directly
  const layout = [...archive.readRels(src.path).values()].find((r) =>
    r.type.endsWith('/slideLayout'),
  )
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    (layout
      ? `<Relationship Id="rId1" Type="${layout.type}" Target="${escapeXmlAttr(layout.target)}"/>`
      : '') +
    '</Relationships>'
  archive.entries.set(relsPathFor(newPath), textToBytes(rels))

  return registerNewSlide(opened, sourceIndex, newPath)
}

const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
export const LAYOUT_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout'
const MEDIA_REL_SUFFIXES = ['/image', '/video', '/audio', '/media']

/** Next non-conflicting media path in the target archive (keeping the extension). */
function nextMediaPath(archive: PackageArchive, ext: string): string {
  let maxNum = 0
  for (const path of archive.entries.keys()) {
    const m = /^ppt\/media\/merged(\d+)\./.exec(path)
    if (m) maxNum = Math.max(maxNum, Number(m[1]))
  }
  return `ppt/media/merged${maxNum + 1}.${ext}`
}

/** Ensure [Content_Types].xml has a Default for this extension (required for images/media). */
function ensureDefaultContentType(archive: PackageArchive, ext: string, contentType: string): void {
  const ctPath = '[Content_Types].xml'
  const ct = archive.readText(ctPath)
  if (!ct) return
  if (new RegExp(`<Default\\s[^>]*Extension="${ext}"`, 'i').test(ct)) return
  // Insert before </Types>. indexOf('>') finds the XML declaration's closing
  // angle bracket first, so splicing there would put the Default between the
  // declaration and <Types> — outside the root element — and every OPC reader
  // would then reject the package (yiioffice#1518).
  const def = `<Default Extension="${ext}" ContentType="${contentType}"/>`
  archive.entries.set(
    ctPath,
    textToBytes(ct.replace('</Types>', () => `${def}</Types>`)),
  )
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

/**
 * Merge the single slide of a one-slide pptx into the target deck (appended at
 * the end).
 *
 * Used by the html→pptx pipeline's per-slide independent conversion: each slide's
 * HTML converts into its own single-slide pptx, and on landing that slide is moved
 * into the existing deck **without reconverting earlier slides**.
 *
 * Precondition (pipeline homogeneity): all single-slide pptx files share the same
 * layout/master/theme structure, so the appended slide reuses the target's
 * existing slideLayout (the source's layout/master/theme is not imported); only
 * the slide XML + the media it references are moved (rIds reassigned to avoid
 * cross-slide name clashes), notesSlide dropped.
 */
export async function mergeSlideFromPptx(
  target: OpenedPptx,
  sourceBytes: Uint8Array,
  opts: MergeSlideOptions = {},
): Promise<Slide | null> {
  const source = await extractMergeSlideSource(sourceBytes)
  return source ? mergeSlideFromSource(target, source, opts) : null
}

export interface MergeSlideOptions {
  /** Target slide whose layout the merged slide takes (default: the last slide) */
  layoutFrom?: Slide
}

/**
 * A single-slide pptx reduced to the plain data the merge needs: slide XML, its
 * relationships, referenced media bytes, and the source layout chain for the
 * empty-deck fallback. Fully serializable, so ops and journals can carry it.
 */
export interface MergeSlideSource {
  srcSlidePath: string
  slideXml: string
  rels: Relationship[]
  /** Referenced media bytes keyed by their resolved source path */
  media: Array<{ path: string; bytes: Uint8Array }>
  /** Source layout→master→theme chain parts (used only when the target has no layout) */
  layoutChain: Array<{ path: string; bytes: Uint8Array; rels?: Uint8Array }>
}

/** Async half of the merge: unzip the source and extract everything the sync half needs. Pure read. */
export async function extractMergeSlideSource(
  sourceBytes: Uint8Array,
): Promise<MergeSlideSource | null> {
  const src = await PackageArchive.open(sourceBytes)
  const { slidePaths } = src.readPresentation()
  const srcSlidePath = slidePaths[0]
  if (!srcSlidePath) return null
  const slideXml = src.readText(srcSlidePath)
  if (slideXml == null) return null
  const rels = [...src.readRels(srcSlidePath).values()]
  const media: MergeSlideSource['media'] = []
  for (const rel of rels) {
    if (!MEDIA_REL_SUFFIXES.some((s) => rel.type.endsWith(s))) continue
    const path = resolveTarget(srcSlidePath, rel.target)
    const bytes = src.readBytes(path)
    if (bytes) media.push({ path, bytes })
  }
  const layoutChain: MergeSlideSource['layoutChain'] = []
  const chain = src.resolveSlideChain(srcSlidePath)
  for (const p of [chain.layoutPath, chain.masterPath, chain.themePath]) {
    if (!p) continue
    const bytes = src.readBytes(p)
    if (!bytes) continue
    const relsBytes = src.readBytes(relsPathFor(p))
    layoutChain.push({ path: p, bytes, ...(relsBytes ? { rels: relsBytes } : {}) })
  }
  return { srcSlidePath, slideXml, rels, media, layoutChain }
}

/** Sync half of the merge: land an extracted source into the target deck (appended at the end). */
export function mergeSlideFromSource(
  target: OpenedPptx,
  source: MergeSlideSource,
  opts: MergeSlideOptions = {},
): Slide | null {
  const { deck, archive } = target
  let slideXml = source.slideXml
  const mediaByPath = new Map(source.media.map((m) => [m.path, m.bytes]))

  // Relative Target of an existing target slide's slideLayout (the appended slide reuses the same layout)
  const anchorSlide = opts.layoutFrom ?? deck.slides[deck.slides.length - 1]
  const layoutTarget = anchorSlide
    ? [...archive.readRels(anchorSlide.path).values()].find((r) => r.type.endsWith('/slideLayout'))
        ?.target
    : undefined

  const newPath = nextSlidePath(archive)
  const newRelsLines: string[] = []
  let ridSeq = 0
  const nextRid = () => `rId${++ridSeq}`

  for (const rel of source.rels) {
    if (MEDIA_REL_SUFFIXES.some((s) => rel.type.endsWith(s))) {
      // Media: move source bytes into the target, assign a non-conflicting path, remap the rId
      const srcMediaPath = resolveTarget(source.srcSlidePath, rel.target)
      const bytes = mediaByPath.get(srcMediaPath)
      if (!bytes) continue
      const ext = (srcMediaPath.split('.').pop() || 'png').toLowerCase()
      const destPath = nextMediaPath(archive, ext)
      archive.entries.set(destPath, bytes)
      ensureDefaultContentType(archive, ext, MIME_BY_EXT[ext] ?? 'application/octet-stream')
      const oldRid = rel.id
      const newRid = nextRid()
      // Rewrite r:embed / r:link references in the slide XML to the new rId
      slideXml = slideXml.replace(
        new RegExp(`(r:(?:embed|link)=")${oldRid}(")`, 'g'),
        `$1${newRid}$2`,
      )
      const relTarget = '../media/' + destPath.slice('ppt/media/'.length)
      newRelsLines.push(
        `<Relationship Id="${newRid}" Type="${IMAGE_REL_TYPE}" Target="${escapeXmlAttr(relTarget)}"/>`,
      )
    } else if (rel.type.endsWith('/slideLayout')) {
      // Reuse the target's existing layout; the source slide XML doesn't reference the layout's rId (layout lives only in rels),
      // but the slide part must have one slideLayout relationship. Use the target's layoutTarget (or the source's when absent).
      const t = layoutTarget ?? rel.target
      newRelsLines.push(
        `<Relationship Id="${nextRid()}" Type="${LAYOUT_REL_TYPE}" Target="${escapeXmlAttr(t)}"/>`,
      )
      // With no target layout (rare: empty deck), move the source's whole layout→master→theme chain over
      if (!layoutTarget) importLayoutChain(archive, source)
    }
    // notesSlide and others (e.g. comments) are dropped
  }

  // Write the new slide XML + rels
  archive.entries.set(newPath, textToBytes(slideXml))
  const relsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    newRelsLines.join('') +
    '</Relationships>'
  archive.entries.set(relsPathFor(newPath), textToBytes(relsXml))

  // Register with the package: Content_Types Override + new sldId/rId in presentation.xml(.rels), inserted at the end
  return registerNewSlide(target, deck.slides.length - 1, newPath)
}

/** Starting from an empty deck: move the source single slide's layout→master→theme chain into the target verbatim (rare branch). */
function importLayoutChain(archive: PackageArchive, source: MergeSlideSource): void {
  for (const part of source.layoutChain) {
    if (!archive.has(part.path)) archive.entries.set(part.path, part.bytes)
    const rp = relsPathFor(part.path)
    if (part.rels && !archive.has(rp)) archive.entries.set(rp, part.rels)
  }
}

/**
 * Insert a blank slide after the sourceIndex slide, with rels pointing at the
 * given layoutPath (from listSlideLayouts). The layout itself is read-only, never
 * written back. Returns the new Slide, or null on failure.
 */
export function insertSlideWithLayout(
  opened: OpenedPptx,
  sourceIndex: number,
  layoutPath: string,
): Slide | null {
  const newPath = prepareInsertSlideWithLayout(opened.archive, opened.deck, sourceIndex, layoutPath)
  if (!newPath) return null
  const slide = parseSlideFromArchive(opened.archive, newPath)
  if (!slide) return null
  // prepareInsertSlideWithLayout already registered presentation.xml
  // Here we only splice into deck.slides (no further archive changes needed)
  opened.deck.slides.splice(sourceIndex + 1, 0, slide)
  return slide
}

/**
 * Delete a slide: the sldId in presentation.xml, the presentation rels, the
 * [Content_Types] Override, the slide part and its rels are all removed;
 * deck.slides synced. Refused when only one slide remains.
 */
export function deleteSlide(opened: OpenedPptx, index: number): boolean {
  const { deck, archive } = opened
  const slide = deck.slides[index]
  if (!slide || deck.slides.length <= 1) return false

  const presPath = 'ppt/presentation.xml'
  const presRelsPath = 'ppt/_rels/presentation.xml.rels'
  const pres = archive.readText(presPath)
  const presRels = archive.readText(presRelsPath)
  if (!pres || !presRels) return false
  const rid = [...archive.readRels(presPath).values()].find(
    (r) => resolveTarget(presPath, r.target) === slide.path,
  )?.id
  if (!rid) return false

  const sldTag = new RegExp(`<p:sldId\\s[^>]*r:id=["']${rid}["'][^>]*/>`).exec(pres)?.[0]
  if (!sldTag) return false
  archive.entries.set(presPath, textToBytes(pres.replace(sldTag, '')))
  const relTag = new RegExp(`<Relationship\\s[^>]*Id=["']${rid}["'][^>]*/>`).exec(presRels)?.[0]
  if (relTag) {
    archive.entries.set(presRelsPath, textToBytes(presRels.replace(relTag, '')))
  }

  removePartWithOwnedResources(archive, slide.path)
  deck.slides.splice(index, 1)
  return true
}

export type ReorderDirection = 'front' | 'back' | 'forward' | 'backward'

/** Adjust an element's z-order (the elements array order is the spTree order); returns whether anything changed. */
export function reorderElement(slide: Slide, elementId: string, dir: ReorderDirection): boolean {
  const idx = slide.elements.findIndex((e) => e.id === elementId)
  if (idx < 0) return false
  const to =
    dir === 'front'
      ? slide.elements.length - 1
      : dir === 'back'
        ? 0
        : dir === 'forward'
          ? idx + 1
          : idx - 1
  if (to === idx || to < 0 || to >= slide.elements.length) return false
  const [el] = slide.elements.splice(idx, 1)
  slide.elements.splice(to, 0, el!)
  slide.structureDirty = true
  return true
}

// ── Raw slice append + whole-slide reparse (shared by paste/table insert) ──

/**
 * Write the slide's current state (incl. unsaved patches) back to the archive and
 * reparse, replacing the model in the deck. New elements appended as raw XML
 * slices go through here, gaining a full semantic model for any element type.
 * Note: after reparse all element ids on the slide change; the caller must rebuild
 * the render tree for the whole slide.
 */
export function materializeSlide(opened: OpenedPptx, slideIndex: number): Slide | null {
  const { deck, archive } = opened
  const slide = deck.slides[slideIndex]
  if (!slide) return null
  archive.entries.set(slide.path, textToBytes(patchSlideXml(slide)))
  const fresh = parseSlideFromArchive(archive, slide.path)
  if (!fresh) return null
  deck.slides[slideIndex] = fresh
  return fresh
}

/** Append a batch of raw shape slices at the slide end and materialize; returns the new slide and new element ids (in append order). */
export function appendRawElements(
  opened: OpenedPptx,
  slideIndex: number,
  xmls: string[],
): { slide: Slide; elementIds: string[] } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide || !xmls.length) return null
  const before = slide.elements.length
  for (const xml of xmls) {
    slide.elements.push({
      id: `rawnew_${slide.elements.length}`,
      type: 'passthrough',
      kind: 'unknown',
      anchor: { spIndex: slide.elements.length, originalXml: xml, range: [0, 0] },
      transform: { offset: { x: 0, y: 0, cx: 0, cy: 0 }, rot: 0, flipH: false, flipV: false },
    })
  }
  slide.structureDirty = true
  const fresh = materializeSlide(opened, slideIndex)
  if (!fresh) return null
  return { slide: fresh, elementIds: fresh.elements.slice(before).map((e) => e.id) }
}

// ── Slide transitions ───────────────────────────────────────────────────

/** Set/clear the transition (writes bodySuffix, persisted with the whole-slide rebuild on save). */
export function setSlideTransition(slide: Slide, kind: SlideTransitionKind): void {
  slide.bodySuffix = patchSlideTransitionXml(slide.bodySuffix, kind)
  slide.structureDirty = true
}

/** Read the current transition. */
export function getSlideTransition(slide: Slide): SlideTransitionKind {
  return readSlideTransitionXml(slide.bodySuffix)
}

/** Set/clear the auto-advance time (advTm, ms; saved by rehearsal timing, auto-advances in PowerPoint slideshows). */
export function setSlideAdvanceTime(slide: Slide, ms: number | null): void {
  slide.bodySuffix = patchSlideAdvanceTimeXml(slide.bodySuffix, ms)
  slide.structureDirty = true
}

/** Read the auto-advance time (ms; null when unset). */
export function getSlideAdvanceTime(slide: Slide): number | null {
  return readSlideAdvanceTimeXml(slide.bodySuffix)
}

// ── Hidden slides ───────────────────────────────────────────────────────

/** Hide/unhide a slide (<p:sld show="0">, skipped in PowerPoint slideshows). */
export function setSlideHidden(slide: Slide, hidden: boolean): void {
  slide.bodyPrefix = patchSlideHiddenXml(slide.bodyPrefix, hidden)
  slide.structureDirty = true
}

/** Read whether the slide is hidden. */
export function getSlideHidden(slide: Slide): boolean {
  return readSlideHiddenXml(slide.bodyPrefix)
}
