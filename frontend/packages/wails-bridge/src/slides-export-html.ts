/**
 * Print-HTML assembly for Slides PDF export. The renderer owns slide rendering
 * (vector SVG per page, PNG fallback); this module turns the page list into the
 * standalone document that Go ExportService.ExportPdf feeds to headless Edge.
 *
 * Layout contract with internal/platform withPageCSS: the document must contain
 * a literal `<head>` tag (the sheet size @page rule is injected right after it),
 * and every page is one fixed-size `.slide-page` box that breaks the sheet.
 */

/** One exported page: vector SVG markup (root carries xmlns/width/height) or a base64 PNG (no data: prefix). */
export type SlidesExportPage = { svg: string } | { png: string }

/** Clickable link overlay: rect as fractions of the page box (0..1), href = URL or in-document "#pgN" anchor. */
export interface SlidesExportLink {
  x: number
  y: number
  w: number
  h: number
  href: string
}

/** The exportPdf op the slides renderer sends (mirrors apps/slides src/shared/ipc.ts ExportPdfOp without filePath). */
export interface SlidesExportHtmlOp {
  pages: SlidesExportPage[]
  widthPx: number
  heightPx: number
  /** Per-page link overlays in the same order as pages; a missing/short entry means "no links". */
  links?: SlidesExportLink[][]
  /** @font-face rules (data: URLs) for faces the SVG text uses that the print window lacks. */
  fontCss?: string
}

/** Image export op the slides renderer sends (mirrors ipc.ts ExportImagesOp). */
export interface SlidesExportImagesOp {
  /** Absolute target directory (from pickExportDir). */
  dir: string
  /** File base name without extension; pages land as <baseName>-01.png, -02.png … */
  baseName: string
  /** base64 PNG per page (no data: prefix), in page order. */
  pngsBase64: string[]
}

/** CSS px → sheet inches at the 96 dpi CSS reference (1280x720 → 13.3333x7.5). */
export function slidePageSizeInches(widthPx: number, heightPx: number): { widthIn: number; heightIn: number } {
  return { widthIn: widthPx / 96, heightIn: heightPx / 96 }
}

/** Escape a value for a double-quoted HTML attribute (hrefs carry raw user URLs). */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
}

/** Percent string for overlay rects, trimmed to a print-accurate 4 decimals. */
function pct(fraction: number): string {
  return `${+(fraction * 100).toFixed(4)}%`
}

function pageBody(page: SlidesExportPage): string {
  if ('png' in page) return `<img src="data:image/png;base64,${page.png}" alt="">`
  return page.svg
}

function linkOverlays(links: SlidesExportLink[] | undefined): string {
  if (!links?.length) return ''
  return links
    .map(
      (l) =>
        `<a class="slide-link" href="${escapeAttr(l.href)}"` +
        ` style="left:${pct(l.x)};top:${pct(l.y)};width:${pct(l.w)};height:${pct(l.h)}"></a>`,
    )
    .join('')
}

/**
 * Assemble the whole deck as one print document: each page is a fixed-size
 * box (id `pgN`, 1-based, so "#pgN" in-document links resolve) followed by a
 * sheet break; links ride on top as transparent anchors that printToPDF turns
 * into PDF link annotations.
 */
export function buildSlidesExportHtml(op: SlidesExportHtmlOp): string {
  const widthPx = Math.max(1, Math.round(op.widthPx))
  const heightPx = Math.max(1, Math.round(op.heightPx))
  const css =
    `html,body{margin:0;padding:0;background:#fff}` +
    `.slide-page{position:relative;overflow:hidden;width:${widthPx}px;height:${heightPx}px;` +
    `page-break-after:always;break-after:page;break-inside:avoid}` +
    `.slide-page:last-child{page-break-after:auto;break-after:auto}` +
    `.slide-page>svg,.slide-page>img{display:block;width:100%;height:100%}` +
    `.slide-link{position:absolute;display:block;background:transparent;text-decoration:none}` +
    (op.fontCss ? op.fontCss : '')
  const pages = op.pages
    .map((page, i) => {
      const n = i + 1
      return `<div class="slide-page" id="pg${n}">${pageBody(page)}${linkOverlays(op.links?.[i])}</div>`
    })
    .join('')
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<style>${css}</style></head><body>${pages}</body></html>`
  )
}
