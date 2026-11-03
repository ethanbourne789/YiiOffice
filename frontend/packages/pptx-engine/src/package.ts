import { textToBytes } from './browser-compat'
import JSZip from 'jszip'
import { PackageArchive, resolveTarget } from './zip'
import { parseClrMap, parseTheme, type Theme } from './theme'
import { parseSlide, parseDecorations, type ParseContext } from './parse'
import {
  parsePlaceholderMap,
  parseMasterTextStyles,
  parseDefaultTextStyle,
  type TextStyleLevels,
} from './placeholder'
import { stripStaleEmbeddedFonts } from './embedded-fonts'
import { patchSlideXml, patchedElementXml } from './builder/patch'
import type { SlideDeck, Slide, SlideElement } from './types'

export interface OpenedPptx {
  deck: SlideDeck
  archive: PackageArchive
}

/** Parse one slide from the archive (assembling the inheritance-chain ctx); shared by openPptx and duplicateSlide. */
export function parseSlideFromArchive(archive: PackageArchive, slidePath: string): Slide | null {
  const slideXml = archive.readText(slidePath)
  if (slideXml == null) return null

  const chain = archive.resolveSlideChain(slidePath)
  const ctx: ParseContext = {}
  // Placeholder geometry + text style inheritance + background inheritance: layout first, master fallback (read-only)
  const layoutXml = (chain.layoutPath ? archive.readText(chain.layoutPath) : undefined) ?? undefined
  const masterXml = (chain.masterPath ? archive.readText(chain.masterPath) : undefined) ?? undefined
  if (chain.themePath) {
    const themeXml = archive.readText(chain.themePath)
    if (themeXml) {
      ctx.theme = parseTheme(themeXml)
      // Dark masters remap schemeClr names (bg1→dk1 …); must be in place before any color resolution below
      ctx.theme.clrMap = parseClrMap(masterXml, layoutXml, slideXml)
      ctx.themeMediaRels = partMediaRels(archive, chain.themePath)
    }
  }
  if (layoutXml) {
    if (chain.layoutPath) ctx.layoutMediaRels = partMediaRels(archive, chain.layoutPath)
    ctx.layoutPlaceholders = parsePlaceholderMap(layoutXml, ctx.theme, ctx.layoutMediaRels)
    ctx.layoutBg = layoutXml
  }
  if (masterXml) {
    if (chain.masterPath) ctx.masterMediaRels = partMediaRels(archive, chain.masterPath)
    ctx.masterPlaceholders = parsePlaceholderMap(masterXml, ctx.theme, ctx.masterMediaRels)
    ctx.masterTextStyles = parseMasterTextStyles(masterXml, ctx.theme, ctx.masterMediaRels)
    ctx.masterBg = masterXml
  }
  // presentation.xml <p:defaultTextStyle>: base text defaults for non-placeholder shapes
  const presXml = archive.readText('ppt/presentation.xml')
  if (presXml) ctx.defaultTextStyle = parseDefaultTextStyle(presXml, ctx.theme)
  // Media rId → zip path; chart rId → chart part content
  const rels = archive.readRels(slidePath)
  const mediaRels = new Map<string, string>()
  const chartXmls = new Map<string, string>()
  const chartMediaRels = new Map<string, Map<string, string>>()
  const chartUserShapes = new Map<string, string>()
  const chartStyleRels = new Set<string>()
  const chartThemeOverrides = new Map<string, string>()
  const avRels = new Map<string, { target: string; external?: boolean }>()
  const diagramDrawings = new Map<string, string>()
  const diagramDatas = new Map<string, string>()
  const diagramMediaRels = new Map<string, Map<string, string>>()
  const diagramLayouts = new Map<string, string>()
  const diagramColors = new Map<string, string>()
  const vmlPreviews = new Map<string, string>()
  const hlinkRels = new Map<string, string>()
  let slideOrder: string[] | undefined
  for (const rel of rels.values()) {
    if (rel.type.endsWith('/hyperlink')) {
      hlinkRels.set(rel.id, rel.target)
    } else if (rel.type.endsWith('/slide')) {
      // Run-level slide jump: resolve the target slide file to its deck index
      slideOrder ??= archive.readPresentation().slidePaths
      const idx = slideOrder.indexOf(resolveTarget(slidePath, rel.target))
      if (idx >= 0) hlinkRels.set(rel.id, `slide:${idx}`)
    } else if (rel.type.endsWith('/image')) {
      mediaRels.set(rel.id, resolveTarget(slidePath, rel.target))
    } else if (rel.type.endsWith('/chart') || rel.type.endsWith('/chartEx')) {
      const target = resolveTarget(slidePath, rel.target)
      const xml = archive.readText(target)
      if (xml) {
        chartXmls.set(rel.id, xml)
        chartMediaRels.set(rel.id, partMediaRels(archive, target))
        // User-drawn overlays live in a chartUserShapes drawing referenced from the chart part's own rels
        for (const sub of archive.readRels(target).values()) {
          if (sub.type.endsWith('/chartUserShapes')) {
            const usXml = archive.readText(resolveTarget(target, sub.target))
            if (usXml) chartUserShapes.set(rel.id, usXml)
          }
          if (sub.type.endsWith('/chartStyle')) chartStyleRels.add(rel.id)
          // Chart-local theme (accents remapped per chart): schemeClr must resolve against it
          if (sub.type.endsWith('/themeOverride')) {
            const ovXml = archive.readText(resolveTarget(target, sub.target))
            if (ovXml) chartThemeOverrides.set(rel.id, ovXml)
          }
        }
      }
    } else if (/\/(?:video|audio|media)$/.test(rel.type)) {
      // Audio/video (r:link of a:videoFile/a:audioFile; embedded or external)
      const external = rel.targetMode === 'External'
      avRels.set(rel.id, {
        target: external ? rel.target : resolveTarget(slidePath, rel.target),
        ...(external ? { external: true } : {}),
      })
    } else if (rel.type.endsWith('/vmlDrawing')) {
      // Legacy OLE previews: v:shape (matched by oleObj spid) → v:imagedata → the VML part's own image rel
      const vmlPath = resolveTarget(slidePath, rel.target)
      const vml = archive.readText(vmlPath)
      if (vml) {
        const vmlRels = archive.readRels(vmlPath)
        for (const m of vml.matchAll(/<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/g)) {
          const relid = /<v:imagedata\b[^>]*\bo:relid="([^"]+)"/.exec(m[2]!)?.[1]
          const imgRel = relid ? vmlRels.get(relid) : undefined
          if (!imgRel) continue
          const target = resolveTarget(vmlPath, imgRel.target)
          for (const key of ['id', 'o:spid']) {
            const v = new RegExp(`\\b${key}="([^"]+)"`).exec(m[1]!)?.[1]
            if (v) vmlPreviews.set(v, target)
          }
        }
      }
    } else if (rel.type.endsWith('/diagramData')) {
      // SmartArt prerendered drawing part: the data part's <dsp:dataModelExt relId="…">
      // points at a diagramDrawing relationship in the container part's (slide's) rels; fall back to the data part's own rels
      const dataPath = resolveTarget(slidePath, rel.target)
      const dataXml = archive.readText(dataPath)
      if (dataXml) diagramDatas.set(rel.id, dataXml)
      const relId = dataXml
        ? /<dsp:dataModelExt\b[^>]*\brelId="([^"]+)"/.exec(dataXml)?.[1]
        : undefined
      if (relId) {
        const drawRel = rels.get(relId) ?? archive.readRels(dataPath).get(relId)
        const basePath = rels.get(relId) ? slidePath : dataPath
        const drawingPath = drawRel ? resolveTarget(basePath, drawRel.target) : undefined
        const drawingXml = drawingPath ? archive.readText(drawingPath) : undefined
        if (drawingXml && drawingPath) {
          diagramDrawings.set(rel.id, drawingXml)
          diagramMediaRels.set(rel.id, partMediaRels(archive, drawingPath))
        }
      }
    } else if (rel.type.endsWith('/diagramLayout')) {
      const xml = archive.readText(resolveTarget(slidePath, rel.target))
      if (xml) diagramLayouts.set(rel.id, xml)
    } else if (rel.type.endsWith('/diagramColors')) {
      const xml = archive.readText(resolveTarget(slidePath, rel.target))
      if (xml) diagramColors.set(rel.id, xml)
    }
  }
  ctx.mediaRels = mediaRels
  ctx.chartXmls = chartXmls
  if (chartMediaRels.size) ctx.chartMediaRels = chartMediaRels
  if (chartUserShapes.size) ctx.chartUserShapes = chartUserShapes
  if (chartStyleRels.size) ctx.chartStyleRels = chartStyleRels
  ctx.chartThemeOverrides = chartThemeOverrides
  if (hlinkRels.size) ctx.hlinkRels = hlinkRels
  if (avRels.size) ctx.avRels = avRels
  if (diagramDrawings.size) ctx.diagramDrawings = diagramDrawings
  if (diagramDatas.size) ctx.diagramDatas = diagramDatas
  if (diagramMediaRels.size) ctx.diagramMediaRels = diagramMediaRels
  if (diagramLayouts.size) ctx.diagramLayouts = diagramLayouts
  if (diagramColors.size) ctx.diagramColors = diagramColors
  if (vmlPreviews.size) ctx.vmlPreviews = vmlPreviews
  // Table style definitions (embedded custom styles; built-in styles handled by table-style as fallback)
  ctx.tableStyles = archive.readText('ppt/tableStyles.xml') ?? undefined

  const slide = parseSlide({
    path: slidePath,
    slideXml,
    layoutPath: chain.layoutPath,
    masterPath: chain.masterPath,
    ctx,
  })

  // master/layout decoration layer (logos/color bars + enabled footer/slide number/date), read-only render
  const decorations = buildDecorations(archive, slidePath, slideXml, slide, layoutXml, masterXml, {
    layoutPath: chain.layoutPath,
    masterPath: chain.masterPath,
    theme: ctx.theme,
    masterPlaceholders: ctx.masterPlaceholders,
    masterTextStyles: ctx.masterTextStyles,
    defaultTextStyle: ctx.defaultTextStyle,
  })
  if (decorations.length) slide.decorations = decorations

  return slide
}

/** A part's (layout/master) own image rels (for decoration-layer picture parsing). */
export function partMediaRels(archive: PackageArchive, partPath: string): Map<string, string> {
  const media = new Map<string, string>()
  for (const rel of archive.readRels(partPath).values()) {
    if (rel.type.endsWith('/image')) media.set(rel.id, resolveTarget(partPath, rel.target))
  }
  return media
}

/**
 * <p:hf> footer-family toggle state.
 * Actual PowerPoint behavior: enabling footers writes ftr/sldNum/dt placeholders
 * into every slide (rendered as normal elements); same-type placeholders on
 * layout/master are just templates. So the decoration layer doesn't render them
 * by default (unset), and only draws them when hf explicitly enables them (a few
 * generators depend on this).
 */
function hfState(xml: string | undefined, attr: 'ftr' | 'sldNum' | 'dt'): 'on' | 'off' | 'unset' {
  if (!xml) return 'unset'
  const hf = /<p:hf\b[^>]*\/?>/.exec(xml)?.[0]
  if (!hf) return 'unset'
  if (new RegExp(`\\b${attr}="(?:1|true)"`).test(hf)) return 'on'
  if (new RegExp(`\\b${attr}="(?:0|false)"`).test(hf)) return 'off'
  return 'unset'
}

/**
 * Assemble a slide's decoration layer: master concrete shapes (bottom-most) →
 * layout concrete shapes.
 * - showMasterSp="0" on the slide/layout disables the master layer;
 * - Footer-family placeholders (ftr/sldNum/dt) follow the <p:hf> toggles + nearest
 *   override (present on the slide → skip the layout's; present on the layout →
 *   skip the master's);
 * - The slide-number field is replaced with the slide's actual index.
 */
export function buildDecorations(
  archive: PackageArchive,
  slidePath: string,
  slideXml: string,
  slide: Slide,
  layoutXml: string | undefined,
  masterXml: string | undefined,
  parts: {
    layoutPath?: string
    masterPath?: string
    theme?: Theme
    masterPlaceholders?: ReturnType<typeof parsePlaceholderMap>
    masterTextStyles?: ReturnType<typeof parseMasterTextStyles>
    defaultTextStyle?: TextStyleLevels
  },
): SlideElement[] {
  const out: SlideElement[] = []
  // Slide number: this slide's index in presentation.xml's sldIdLst
  let slideNum: number | undefined
  try {
    const idx = archive.readPresentation().slidePaths.indexOf(slidePath)
    if (idx >= 0) slideNum = idx + 1
  } catch {
    /* missing slide-number substitution is acceptable */
  }

  const HF_ALL = ['ftr', 'sldNum', 'dt'] as const
  const enabled = new Set(
    HF_ALL.filter((k) => {
      const l = hfState(layoutXml, k)
      const m = hfState(masterXml, k)
      if (l === 'off' || m === 'off') return false
      return l === 'on' || m === 'on'
    }),
  )
  // Footer-family placeholders the slide already has (nearest override, no longer taken from layout/master)
  const slidePh = new Set(
    slide.elements.map((e) => (e as { placeholder?: string }).placeholder).filter(Boolean),
  )
  const hasPh = (xml: string | undefined, type: string) =>
    !!xml && new RegExp(`<p:ph\\b[^>]*type="${type}"`).test(xml)

  // Slide-level showMasterSp="0" ("hide background graphics") hides both master and layout
  // decoration shapes; layout-level only stops the master's from showing through. Footer
  // placeholders are not background graphics and keep following the <p:hf> toggles.
  const slideHidesInherited = /<p:sld\b[^>]*showMasterSp=(?:"(?:0|false)"|'(?:0|false)')/.test(
    slideXml,
  )
  const masterShown =
    !slideHidesInherited &&
    !(
      layoutXml && /<p:sldLayout\b[^>]*showMasterSp=(?:"(?:0|false)"|'(?:0|false)')/.test(layoutXml)
    )

  if (masterXml && parts.masterPath) {
    const hfTypes = new Set([...enabled].filter((k) => !slidePh.has(k) && !hasPh(layoutXml, k)))
    if (masterShown || hfTypes.size) {
      const ctx: ParseContext = {
        theme: parts.theme,
        mediaRels: partMediaRels(archive, parts.masterPath),
        defaultTextStyle: parts.defaultTextStyle,
      }
      out.push(
        ...parseDecorations(masterXml, ctx, {
          hfTypes,
          hideShapes: !masterShown,
          ...(slideNum != null ? { slideNum } : {}),
        }),
      )
    }
  }
  if (layoutXml && parts.layoutPath) {
    const hfTypes = new Set([...enabled].filter((k) => !slidePh.has(k)))
    if (!slideHidesInherited || hfTypes.size) {
      // Layout footer placeholders often omit xfrm/font size, inheriting from the master
      const ctx: ParseContext = {
        theme: parts.theme,
        mediaRels: partMediaRels(archive, parts.layoutPath),
        masterPlaceholders: parts.masterPlaceholders,
        masterTextStyles: parts.masterTextStyles,
        defaultTextStyle: parts.defaultTextStyle,
      }
      out.push(
        ...parseDecorations(layoutXml, ctx, {
          hfTypes,
          hideShapes: slideHidesInherited,
          ...(slideNum != null ? { slideNum } : {}),
        }),
      )
    }
  }
  return out
}

export async function openPptx(bytes: Uint8Array): Promise<OpenedPptx> {
  const archive = await PackageArchive.open(bytes)
  const { size, slidePaths } = archive.readPresentation()

  const slides: Slide[] = []
  for (const slidePath of slidePaths) {
    const slide = parseSlideFromArchive(archive, slidePath)
    if (slide) slides.push(slide)
  }

  const deck: SlideDeck = { slides, size, originalHash: archive.originalHash }
  return { deck, archive }
}

/**
 * Rebuild the deck model from the archive's current entries — same result as
 * openPptx(await savePptx(opened)) without materializing the zip, whose contiguous
 * output buffer fails outright on large decks. Pending edits must already be baked
 * into the entries (commitSaved).
 */
export function reparseDeck(opened: OpenedPptx): OpenedPptx {
  const { archive } = opened
  const { size, slidePaths } = archive.readPresentation()
  const slides: Slide[] = []
  for (const slidePath of slidePaths) {
    const slide = parseSlideFromArchive(archive, slidePath)
    if (slide) slides.push(slide)
  }
  return { deck: { slides, size, originalHash: archive.originalHash }, archive }
}

/**
 * Save (element-level patches, Phase 3.3).
 *
 * - With no dirty elements: write original entries back byte-for-byte, producing a
 *   slideN.xml 100% identical to the original.
 * - Slides with dirty elements: rebuild that slideN.xml = bodyPrefix + each element
 *   (dirty ? patch-regenerated : original byte slice) + bodySuffix; all other
 *   entries are copied byte-for-byte.
 * - Non-text elements (pictures/passthrough) don't support content editing yet;
 *   even flagged dirty they use original bytes.
 */
export async function savePptx(opened: OpenedPptx): Promise<Uint8Array> {
  try {
    return await buildZip(opened).generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  } catch (err) {
    // A save that never landed cannot vouch for any edit: drop the snapshot so
    // a later commitSaved bakes the deck instead of clearing it.
    saveSnapshot.delete(opened)
    throw err
  }
}

/**
 * Same output as savePptx, written straight to `filePath`.
 *
 * Prefer this for anything that lands on disk: savePptx has to assemble the whole
 * package into one contiguous buffer, which on a large deck fails outright with
 * "Array buffer allocation failed". Streaming keeps peak memory to a chunk at a
 * time. JSZip throws stream errors from inside its own scheduled callbacks, so the
 * stream's 'error' event — not just the returned promise — has to be handled or the
 * throw escapes as an uncaught exception and takes the process down.
 */
/**
 * NOTE: Node.js only — uses `node:fs` and `node:stream/promises`.
 * This function will not work in a browser environment. The dynamic
 * `import('node:fs')` will naturally fail at runtime in the browser.
 */
export async function savePptxToFile(opened: OpenedPptx, filePath: string): Promise<void> {
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  const source = buildZip(opened).generateNodeStream({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: true,
  })
  try {
    await pipeline(source, createWriteStream(filePath))
  } catch (err) {
    saveSnapshot.delete(opened)
    throw err
  }
}

/**
 * The slide XML each in-flight save pulled into its package, keyed by the
 * opened deck. buildZip records it before the stream starts, and commitSaved
 * clears dirty state only for the slides it matches — a slide that was clean
 * at snapshot time, or whose XML moved afterwards, holds edits the finished
 * write never contained.
 */
const saveSnapshot = new WeakMap<OpenedPptx, Map<string, string>>()

/**
 * Sync the in-memory model with what savePptx/savePptxToFile just wrote, without
 * the full reopen (readFile + sha256 + unzip + reparse) that used to double save
 * latency and peak memory on large decks.
 *
 * For every dirty slide this bakes the patched XML back into archive.entries and
 * anchor.originalXml, then clears the dirty flags — exactly the state a reopen
 * would produce, minus new element ids. Uses the same patchSlideXml /
 * patchedElementXml pair as buildZip, so memory and disk are byte-identical and
 * the next save's byte slices are safe to reuse.
 *
 * Only slides the finished save actually carried are cleared, so an edit
 * committed while the stream was running stays dirty and lands in the next save.
 * Call only after a successful save; on failure keep the dirty state so the next
 * save retries the patches.
 */
export function commitSaved(opened: OpenedPptx): void {
  const { deck, archive } = opened
  const snapshot = saveSnapshot.get(opened)
  for (const slide of deck.slides) {
    if (!slideIsDirty(slide)) continue
    const xml = patchSlideXml(slide)
    if (snapshot && snapshot.get(slide.path) !== xml) continue
    for (const el of slide.elements) {
      el.anchor.originalXml = patchedElementXml(el)
      delete el.dirty
      delete el.dirtyTransform
      delete el.dirtyFill
      delete el.dirtyStroke
      delete el.dirtySrcRect
      delete el.dirtyPPr
    }
    slide.originalXml = xml
    delete slide.structureDirty
    archive.entries.set(slide.path, textToBytes(xml))
  }
  saveSnapshot.delete(opened)
}

/**
 * Only XML text parts benefit from deflate. Everything else (media, fonts, OLE
 * blobs) is already compressed or opaque binary: deflating it burns seconds of
 * CPU on large decks for no size win, so it is stored verbatim.
 */
const COMPRESSED_EXTENSIONS = new Set(['xml', 'rels'])

function slideIsDirty(s: Slide): boolean {
  return (
    !!s.structureDirty ||
    s.elements.some(
      (e) =>
        e.dirty || e.dirtyTransform || e.dirtyFill || e.dirtyStroke || e.dirtySrcRect || e.dirtyPPr,
    )
  )
}

function buildZip(opened: OpenedPptx): JSZip {
  const { deck, archive } = opened
  stripStaleEmbeddedFonts(deck, archive)
  const patched = new Map<string, string>()
  for (const s of deck.slides) {
    if (slideIsDirty(s)) patched.set(s.path, patchSlideXml(s))
  }
  saveSnapshot.set(opened, patched)

  const zip = new JSZip()
  for (const [path, data] of archive.entries) {
    const xml = patched.get(path)
    if (xml !== undefined) {
      zip.file(path, xml)
      continue
    }
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    zip.file(path, data, COMPRESSED_EXTENSIONS.has(ext) ? {} : { compression: 'STORE' })
  }
  return zip
}
