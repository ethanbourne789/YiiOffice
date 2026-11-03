import { textToBytes } from '../browser-compat'
import { relsPathFor, resolveTarget } from '../zip'
import { buildChartSpaceXml, type NewChartKind, type NewChartOptions } from '../chart-insert'
import { type OpenedPptx } from '../package'
import type { Slide, ChartElement } from '../types'

/**
 * Chart editing (charts created by this app, rebuilding the chart part):
 * find the element's chart part path (via slide rels), rebuild the XML with the
 * new data/type/colors, and write it back to the archive. structureDirty=true
 * triggers a reparse.
 */
export function editChartElement(
  opened: OpenedPptx,
  slideIndex: number,
  elementId: string,
  patch: {
    kind?: NewChartKind
    /** Bar direction for an explicit type change ('bar' = horizontal) */
    barDir?: 'col' | 'bar'
    categories?: string[]
    series?: Array<{ name: string; values: number[] }>
    title?: string
    colorScheme?: string[]
    legendPos?: 'b' | 't' | 'r' | 'l' | 'none'
    dataLabels?: boolean
    gridlines?: boolean
    /** '' = clear */
    catAxisTitle?: string
    valAxisTitle?: string
    gapWidthPct?: number
    /** Doughnut hole size percent (kept from the existing chart when unspecified) */
    holeSizePct?: number
    /** Swap rows/columns: categories ↔ series (mutually exclusive with categories/series patches, triggered separately in the UI) */
    switchRowCol?: boolean
    /** Per-point fill overrides, seriesIdx → pointIdx → color; null clears back to the series color */
    pointColors?: Record<number, Record<number, string | null>>
  },
): boolean {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return false
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'chart') return false
  const chartEl = el as ChartElement
  if (chartEl.descr !== 'aislides-chart') return false // only charts created by this app are editable

  // Find the chart part path (looked up from the slide rels)
  const { archive } = opened
  const relsPath = relsPathFor(slide.path)
  const rels = archive.readText(relsPath)
  if (!rels) return false

  // Find the r:id in originalXml
  const rIdInFrame = /r:id=["']([^"']+)["']/.exec(el.anchor.originalXml)
  if (!rIdInFrame) return false
  const rId = rIdInFrame[1]!

  // Find the chart part path in the rels
  const relRe = new RegExp(`Id=["']${escapeRegex(rId)}["'][^>]*Target=["']([^"']+)["']`)
  const relMatch = relRe.exec(rels)
  if (!relMatch) return false
  const chartPath = resolveTarget(slide.path, relMatch[1]!)

  // Read existing chart data (used to fill unspecified fields)
  const existing = chartEl.chart
  // Combo charts (bar+line) parse with main kind 'bar' and line series carrying plotKind='line':
  // when the type isn't explicitly changed, rebuild as comboBarLine so data/color-only edits
  // don't degrade combos into plain bar charts; likewise stacked bar → barStacked and pie with
  // a hole → doughnut, so style-only edits don't lose the type subvariant
  const isCombo = existing.kind === 'bar' && existing.series.some((s) => s.plotKind === 'line')
  const derivedKind: NewChartKind =
    existing.kind === 'unknown'
      ? 'bar'
      : isCombo
        ? 'comboBarLine'
        : existing.kind === 'bar'
          ? existing.grouping === 'percentStacked'
            ? 'barPercentStacked'
            : existing.grouping === 'stacked'
              ? 'barStacked'
              : existing.pseudo3D // 3-D column survives data/style-only rebuilds (stacked 3-D degrades to 2-D stacked)
                ? 'bar3D'
                : 'bar'
          : existing.kind === 'pie'
            ? (existing.holePct ?? 0) > 0
              ? 'doughnut'
              : existing.pseudo3D
                ? 'pie3D'
                : 'pie'
            : (existing.kind as NewChartKind)
  const kind: NewChartKind = patch.kind ?? derivedKind
  // Horizontal bar direction is preserved through rebuilds; an explicit type change resets it unless the patch asks for barDir 'bar' (the gallery's horizontal-bar entry)
  const barDir =
    patch.barDir ??
    (patch.kind == null && existing.kind === 'bar' && existing.barDir === 'bar' && !isCombo
      ? ('bar' as const)
      : undefined)
  let categories = patch.categories ?? existing.categories
  let series =
    patch.series ??
    existing.series.map((s) => ({
      name: s.name ?? '',
      values: s.values.map((v) => v ?? 0),
    }))
  // Per-point colors survive every rebuild (parsed <c:dPt> back-fill), with patch overrides on top
  let pointColors: Array<Array<string | undefined> | undefined> = existing.series.map((s) =>
    s.pointColors ? [...s.pointColors] : undefined,
  )
  if (patch.pointColors) {
    for (const [si, pts] of Object.entries(patch.pointColors)) {
      const row = (pointColors[Number(si)] ??= [])
      for (const [pi, c] of Object.entries(pts)) row[Number(pi)] = c ?? undefined
    }
  }
  if (patch.switchRowCol) {
    const cats = categories
    categories = series.map((s) => s.name)
    const transposed: typeof pointColors = cats.map((_, ci) =>
      pointColors.some((row) => row?.[ci] != null)
        ? pointColors.map((row) => row?.[ci])
        : undefined,
    )
    series = cats.map((cat, ci) => ({ name: cat, values: series.map((s) => s.values[ci] ?? 0) }))
    pointColors = transposed
  }
  const title = patch.title ?? existing.title

  // Style: fields not in the patch keep the values parsed from the existing part (rebuild loses no style)
  const legendPos =
    patch.legendPos ??
    (existing.legendPos == null ? 'none' : existing.legendPos === 'tr' ? 'r' : existing.legendPos)
  const dataLabels = patch.dataLabels ?? !!existing.dataLabels
  const gridlines = patch.gridlines ?? !!existing.valAxis?.gridColor
  const catAxisTitle = patch.catAxisTitle ?? existing.catAxis?.title
  const valAxisTitle = patch.valAxisTitle ?? existing.valAxis?.title
  const gapWidthPct = patch.gapWidthPct ?? existing.gapWidthPct
  // Colors: when unspecified and every existing series has an explicit color, rebuild with those colors (type/data changes keep the palette)
  const existingColors = existing.series.map((s) => s.color)
  const colorScheme =
    patch.colorScheme ??
    (existingColors.every((c): c is string => !!c) ? existingColors : undefined)
  // A custom doughnut hole used to reset to the build default on every rebuild.
  // A plain pie parses as holePct 0 — forwarding that would clamp a pie→doughnut
  // switch to a 1% hole, so only a real (nonzero) hole is preserved.
  const holeSizePct = patch.holeSizePct ?? (existing.holePct || undefined)

  const opts: NewChartOptions = {
    kind,
    ...(title !== undefined ? { title } : {}),
    categories,
    series,
    offset: { x: 0, y: 0, cx: 0, cy: 0 },
    legendPos,
    dataLabels,
    gridlines,
    ...(catAxisTitle ? { catAxisTitle } : {}),
    ...(valAxisTitle ? { valAxisTitle } : {}),
    ...(gapWidthPct != null ? { gapWidthPct } : {}),
    ...(barDir ? { barDir } : {}),
    ...(pointColors.some((row) => row?.some((c) => c != null)) ? { pointColors } : {}),
    ...(colorScheme ? { colorScheme } : {}),
    ...(holeSizePct != null ? { holeSizePct } : {}),
  }
  const newXml = buildChartSpaceXml(opts)
  archive.entries.set(chartPath, textToBytes(newXml))
  slide.structureDirty = true
  return true
}

/**
 * Mark a chart not created by this app as editable (cNvPr descr="aislides-chart"):
 * only tags it without rewriting the chart part (the conversion itself is
 * lossless); subsequent edits go through editChartElement's rebuild template, and
 * fine-grained formatting beyond the parsed model (number formats/per-point
 * styles etc.) is dropped at that point.
 */
export function markChartEditable(slide: Slide, elementId: string): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'chart') return false
  const chartEl = el as ChartElement
  if (chartEl.descr === 'aislides-chart') return true
  const xml = el.anchor.originalXml
  const m = /<p:cNvPr\b[^>]*\/?>/.exec(xml)
  if (!m) return false
  const tag = m[0].includes('descr="')
    ? m[0].replace(/descr="[^"]*"/, 'descr="aislides-chart"')
    : m[0].replace(/(\/?>)$/, ' descr="aislides-chart"$1')
  el.anchor.originalXml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length)
  chartEl.descr = 'aislides-chart'
  slide.structureDirty = true
  return true
}

/** Escape RegExp special characters. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Read a chart element's current data (for dialog echo-back). */
export function getChartElementData(
  slide: Slide,
  elementId: string,
): {
  kind: string
  title: string
  categories: string[]
  series: Array<{ name: string; values: number[] }>
  seriesColors: Array<string | undefined>
  pointColors: Array<Array<string | undefined> | undefined>
} | null {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'chart') return null
  const chartEl = el as ChartElement
  return {
    kind: chartEl.chart.kind,
    title: chartEl.chart.title ?? '',
    categories: chartEl.chart.categories,
    series: chartEl.chart.series.map((s) => ({
      name: s.name ?? '',
      values: s.values.map((v) => v ?? 0),
    })),
    seriesColors: chartEl.chart.series.map((s) => s.color),
    pointColors: chartEl.chart.series.map((s) => (s.pointColors ? [...s.pointColors] : undefined)),
  }
}
