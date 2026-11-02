/**
 * Wails-specific: manage OpenedPptx model in the renderer.
 *
 * In Electron the main process holds the parsed deck and renders slides.
 * In Wails the renderer holds OpenedPptx, applies edits via pptx-engine,
 * and renders slides via pptx-render.
 */
import type { OpenedPptx, SlideDeck, PackageArchive } from '@yiioffice/pptx-engine'
import { openPptx as openPptxFromBytes, savePptx } from '@yiioffice/pptx-engine'
import { createBlankPptx } from '@yiioffice/pptx-engine'
import { buildRenderSlide } from '@yiioffice/pptx-render'
import type { BuildOptions, MediaResolver } from '@yiioffice/pptx-render'
import type { RenderSlide } from '@yiioffice/pptx-render'
import { bytesToBase64, base64ToBytes } from '@yiioffice/pptx-engine/browser-compat'

const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

/**
 * viewBox-only SVGs report naturalWidth/Height 0 to <img>, which breaks Konva's
 * drawImage (zero-size source rect). Bake the viewBox size into explicit attributes.
 */
function svgWithSize(text: string): string {
  const m = /<svg\b([^>]*)>/.exec(text)
  if (!m) return text
  const selfClose = /\/\s*$/.test(m[1]!)
  let attrs = selfClose ? m[1]!.replace(/\/\s*$/, '') : m[1]!
  const vb = /viewBox="([^"]+)"/.exec(attrs)?.[1]?.trim()
  if (!vb) return text
  const parts = vb.split(/[\s,]+/).map(Number)
  const w = parts[2]
  const h = parts[3]
  if (!w || !h) return text
  if (!/\swidth=/.test(attrs)) attrs += ` width="${w}"`
  if (!/\sheight=/.test(attrs)) attrs += ` height="${h}"`
  return text.slice(0, m.index) + `<svg${attrs}${selfClose ? '/' : ''}>` + text.slice(m.index + m[0].length)
}

/** One resolver per archive; decoded dataUrls are cached across re-renders. */
const resolverCache = new WeakMap<PackageArchive, MediaResolver>()

function mediaResolverFor(archive: PackageArchive): MediaResolver {
  let resolver = resolverCache.get(archive)
  if (!resolver) {
    const urls = new Map<string, string | undefined>()
    resolver = (mediaRef: string) => {
      if (urls.has(mediaRef)) return urls.get(mediaRef)
      let url: string | undefined
      const bytes = archive.readBytes(mediaRef)
      if (bytes) {
        const ext = /[.]([^.]+)$/.exec(mediaRef)?.[1]?.toLowerCase() ?? ''
        if (ext === 'svg') {
          const text = svgWithSize(new TextDecoder().decode(bytes))
          url = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(text))}`
        } else {
          url = `data:${MEDIA_MIME[ext] ?? 'application/octet-stream'};base64,${bytesToBase64(bytes)}`
        }
      }
      urls.set(mediaRef, url)
      return url
    }
    resolverCache.set(archive, resolver)
  }
  return resolver
}

/** Open a pptx from base64, returning the OpenedPptx model + rendered slides */
export async function openFromBase64(
  base64: string,
  fitWidthPx: number,
): Promise<{ opened: OpenedPptx; slides: RenderSlide[]; defaultFont?: string }> {
  const bytes = base64ToBytes(base64)
  const opened = await openPptxFromBytes(bytes)
  const { slides: rendered } = renderDeck(opened, { fitWidthPx })
  return { opened, slides: rendered }
}

/** Create a new blank presentation */
export async function createNewBlank(
  fitWidthPx: number,
): Promise<{ opened: OpenedPptx; slides: RenderSlide[] }> {
  const bytes = await createBlankPptx()
  const opened = await openPptxFromBytes(bytes)
  const { slides: rendered } = renderDeck(opened, { fitWidthPx })
  return { opened, slides: rendered }
}

/** Render all slides of an OpenedPptx to RenderSlide[] */
export function renderDeck(
  opened: OpenedPptx,
  opts: BuildOptions,
): { slides: RenderSlide[]; size: SlideDeck['size'] } {
  const { deck } = opened
  const media = opts.media ?? mediaResolverFor(opened.archive)
  const slides = deck.slides.map((slide, i) =>
    buildRenderSlide(slide, deck.size, { ...opts, media, slideNo: i + 1 }),
  )
  return { slides, size: deck.size }
}

/** Render a single slide index to RenderSlide */
export function renderSlide(
  opened: OpenedPptx,
  slideIndex: number,
  opts: BuildOptions,
): RenderSlide | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  const media = opts.media ?? mediaResolverFor(opened.archive)
  return buildRenderSlide(slide, opened.deck.size, { ...opts, media, slideNo: slideIndex + 1 })
}

/** Render all slides (for full deck rebuild after structural changes) */
export function renderAllSlides(
  opened: OpenedPptx,
  opts: BuildOptions,
): RenderSlide[] {
  const { slides } = renderDeck(opened, opts)
  return slides
}

/** Serialize the OpenedPptx model to base64 for saving */
export async function serializeToBase64(opened: OpenedPptx): Promise<string> {
  const bytes = await savePptx(opened)
  return bytesToBase64(bytes)
}
