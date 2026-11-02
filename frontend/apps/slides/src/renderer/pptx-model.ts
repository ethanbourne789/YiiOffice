/**
 * Wails-specific: manage OpenedPptx model in the renderer.
 *
 * In Electron the main process holds the parsed deck and renders slides.
 * In Wails the renderer holds OpenedPptx, applies edits via pptx-engine,
 * and renders slides via pptx-render.
 */
import type { OpenedPptx, SlideDeck } from '@yiioffice/pptx-engine'
import { openPptx as openPptxFromBytes, savePptx } from '@yiioffice/pptx-engine'
import { createBlankPptx } from '@yiioffice/pptx-engine'
import { buildRenderSlide } from '@yiioffice/pptx-render'
import type { BuildOptions } from '@yiioffice/pptx-render'
import type { RenderSlide } from '@yiioffice/pptx-render'
import { bytesToBase64, base64ToBytes } from '@yiioffice/pptx-engine/browser-compat'

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
  const slides = deck.slides.map((slide, i) =>
    buildRenderSlide(slide, deck.size, { ...opts, slideNo: i + 1 }),
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
  return buildRenderSlide(slide, opened.deck.size, { ...opts, slideNo: slideIndex + 1 })
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
