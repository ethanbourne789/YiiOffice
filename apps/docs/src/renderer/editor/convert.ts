/**
 * Block[] -> ProseMirror doc: the open direction of the editor conversion.
 *
 * Publishes `blocksToPmDoc` / `pmDocOptions` and the table-width helpers the
 * editor needs at parse time. The save direction lives in `pm-save-plan.ts`;
 * both lean on the primitives in `pm-shared.ts`. Everything that used to live
 * here is still importable from this module — the surface is re-exported below
 * so callers do not have to care which file a symbol ended up in.
 */

import {
  symDisplayText,
  tableFormattingSignature,
  tableStructureSignature,
} from './pm-shared'
import type { PmMark, PmNode } from './pm-shared'
import {
  ommlToLatex,
  type Block,
  type ParaFormat,
  type Run,
  type SectionInfo,
  type TableCell,
  type TableModel,
  type TableParagraph,
  type TextboxDisplay,
} from '@yiioffice/docx-engine'
import {
  canvasMetrics,
  charScaleEm,
  maxWordWidthPx,
  textHasComplexScript,
  type FontMetricsProvider,
  wordKerns,
} from '../line-metrics'
import { firstStrongDir } from './direction'
import { splitCellBoxGroup } from './protected-render'
import { inlineMathML } from './equation'
import { borderDrawnPx, borderTotalPt, collapsedEdgePx } from './border-metrics'
import { charScaleXAttr } from './text-effects'

/** document-level layout switches for the display models built here */
export interface PmDocOptions {
  /** settings.xml compatibilityMode < 15: w:tblInd measures to the cell text, so
   *  the table border sits one left cell margin further out (Word 2013+ measures
   *  to the border) */
  legacyTableIndent?: boolean
  /** rPrDefault size and Latin face: runs inheriting them carry neither */
  defaultRun?: RunDefaults
}

export interface RunDefaults {
  sizeHalfPoints?: number
  font?: string
}

export function pmDocOptions(parsed: {
  compatibilityMode?: number
  docDefaults?: { sizeHalfPoints?: number; asciiFont?: string }
}): PmDocOptions {
  const { sizeHalfPoints, asciiFont } = parsed.docDefaults ?? {}
  return {
    legacyTableIndent: (parsed.compatibilityMode ?? 0) < 15,
    defaultRun: {
      ...(sizeHalfPoints ? { sizeHalfPoints } : {}),
      ...(asciiFont ? { font: asciiFont } : {}),
    },
  }
}

export function blocksToPmDoc(
  blocks: Block[],
  sections?: SectionInfo[],
  options: PmDocOptions = {},
): PmNode {
  const content: PmNode[] = []
  for (const block of blocks) {
    if (block.hidden) continue
    content.push(
      blockToPmNode(
        block,
        sectionRowCapTwips(sections, block.docxIndex),
        sectionWidthBudget(sections, block.docxIndex),
        options,
      ),
    )
  }
  if (content.length === 0) {
    content.push({
      type: 'docParagraph',
      attrs: { docxIndex: null, styleId: null, aiChanged: false },
    })
  }
  return { type: 'doc', content }
}

/** Word lays out RTL-script / run-rtl paragraphs with an RTL base direction even
 * without w:bidi (HTML-converted docs omit it). The first strong character wins
 * (dir=auto semantics); run w:rtl only decides weak-only text. Render-only: never
 * written back, and never subject to the explicit-bidi jc left/right swap. */

/** Word lays out RTL-script / run-rtl paragraphs with an RTL base direction even
 * without w:bidi (HTML-converted docs omit it). The first strong character wins
 * (dir=auto semantics); run w:rtl only decides weak-only text. Render-only: never
 * written back, and never subject to the explicit-bidi jc left/right swap. */
export function inferredBidi(format: ParaFormat | undefined, runs: Run[] | undefined): boolean {
  if (format?.bidi || !runs?.length) return false
  const strong = firstStrongDir(runs.map((r) => r.text).join(''))
  if (strong) return strong === 'rtl'
  return runs.some((r) => r.rtl)
}

function formatAttrs(format: ParaFormat | undefined, runs?: Run[]): Record<string, unknown> {
  return {
    align: format?.align ?? null,
    lineSpacing: format?.lineSpacing ?? null,
    lineRule: format?.lineRule ?? null,
    lineRawTwips: format?.lineRawTwips ?? null,
    indentLeft: format?.indentLeft ?? null,
    indentRight: format?.indentRight ?? null,
    indentFirstLine: format?.indentFirstLine ?? null,
    // only the paragraph's OWN character unit becomes direct formatting — a
    // a character-unit indent inherited from the style chain shows through and
    // must not be copied onto the pPr as direct formatting
    indentFirstLineChars: format?.directCharIndents?.firstLine ?? null,
    spaceBefore: format?.spaceBefore ?? null,
    spaceAfter: format?.spaceAfter ?? null,
    spaceBeforeAuto: format?.spaceBeforeAuto ?? null,
    spaceAfterAuto: format?.spaceAfterAuto ?? null,
    contextualSpacing: format?.contextualSpacing ?? null,
    keepNext: format?.keepNext ?? null,
    keepLines: format?.keepLines ?? null,
    widowControl: format?.widowControl ?? null,
    suppressLineNumbers: format?.suppressLineNumbers ?? null,
    pageBreakBefore: format?.pageBreakBefore ?? false,
    shadingFill: format?.shadingFill ?? null,
    shadingDisplay: format?.shadingDisplay ?? null,
    shadingClear: format?.shadingClear ?? null,
    borderReset: format?.borderReset ?? null,
    borders: format?.borders ?? null,
    borderLines: format?.borderLines ? JSON.stringify(format.borderLines) : null,
    borderPad: format?.borderPad ? JSON.stringify(format.borderPad) : null,
    tabStops: format?.tabStops ? JSON.stringify(format.tabStops) : null,
    dropCap: format?.dropCap ? JSON.stringify(format.dropCap) : null,
    frame: format?.frame ? JSON.stringify(format.frame) : null,
    frameBox: format?.frameBox ? JSON.stringify(format.frameBox) : null,
    textDirection: format?.textDirection ?? null,
    bidi: format?.bidi ?? false,
    bidiInferred: inferredBidi(format, runs),
    autoSpace: format?.autoSpace ?? null,
    wordWrap: format?.wordWrap ?? null,
    overflowPunct: format?.overflowPunct ?? null,
    eaLang: format?.eastAsiaLang ?? null,
    snapToGrid: format?.snapToGrid ?? null,
    emptyRunSize: format?.emptyRunSizeHalfPoints ?? null,
    emptyRunFont: format?.emptyRunFontFamily ?? null,
    markSize: format?.markSizeHalfPoints ?? null,
  }
}

/** Effective row-height ceiling: one page of section content (Word truncates taller rows within the page) */

/** Effective row-height ceiling: one page of section content (Word truncates taller rows within the page) */
function sectionRowCapTwips(
  sections: SectionInfo[] | undefined,
  docxIndex: number | null,
): number | null {
  if (!sections?.length || docxIndex == null) return null
  const sec =
    sections.find((s) => docxIndex >= s.firstBlockIndex && docxIndex <= s.lastBlockIndex) ??
    sections[sections.length - 1]
  const cap = sec.settings.pageHeight - sec.settings.marginTop - sec.settings.marginBottom
  return cap > 0 ? cap : null
}

/** table width budget: Word fixed layout lets over-wide tables overflow the
 * text column — left-aligned ones spill right up to the paper edge (avail =
 * left page margin to the paper's right edge), centered ones spill both
 * margins symmetrically (paper = full page width, the hard compression cap);
 * fit = text column width, the target autofit growth is reclaimed back to */

/** table width budget: Word fixed layout lets over-wide tables overflow the
 * text column — left-aligned ones spill right up to the paper edge (avail =
 * left page margin to the paper's right edge), centered ones spill both
 * margins symmetrically (paper = full page width, the hard compression cap);
 * fit = text column width, the target autofit growth is reclaimed back to */
export interface TableWidthBudget {
  avail: number
  fit: number
  paper: number
}

function sectionWidthBudget(
  sections: SectionInfo[] | undefined,
  docxIndex: number | null,
): TableWidthBudget | null {
  if (!sections?.length || docxIndex == null) return null
  const sec =
    sections.find((s) => docxIndex >= s.firstBlockIndex && docxIndex <= s.lastBlockIndex) ??
    sections[sections.length - 1]
  const paper = sec.settings.pageWidth
  const avail = paper - sec.settings.marginLeft
  if (avail <= 0) return null
  const fit = avail - sec.settings.marginRight
  return { avail, fit: fit > 0 ? fit : avail, paper }
}

/** centered tables (w:jc or w:tblpXSpec) spill both margins, so their growth bound is the paper width */

/** centered tables (w:jc or w:tblpXSpec) spill both margins, so their growth bound is the paper width */
function budgetAvail(model: TableModel, budget: TableWidthBudget): number {
  return model.align === 'center' || model.floatPos?.xSpec === 'center'
    ? budget.paper
    : budget.avail
}

/** Cap declared row heights (incl. nested tables); returns the input model when nothing exceeds the cap */

/** Cap declared row heights (incl. nested tables); returns the input model when nothing exceeds the cap */
export function capTableRowHeights(model: TableModel, capTwips: number): TableModel {
  let changed = false
  const rowHeightsTwips = model.rowHeightsTwips?.map((h) => {
    if (h != null && h > capTwips) {
      changed = true
      return capTwips
    }
    return h
  })
  const rows = model.rows.map((row) =>
    row.map((cell) => {
      if (!cell.nestedTables?.length) return cell
      const nested = cell.nestedTables.map((nt) => capTableRowHeights(nt, capTwips))
      if (nested.every((nt, i) => nt === cell.nestedTables![i])) return cell
      changed = true
      return { ...cell, nestedTables: nested }
    }),
  )
  return changed ? { ...model, rows, rowHeightsTwips } : model
}

const DEFAULT_CELL_MAR = 108
/** compression floor for real columns (24px); sliver grid slots below it keep their width */

/** compression floor for real columns (24px); sliver grid slots below it keep their width */
const MIN_COL_TWIPS = 360

function tableIndentTwips(model: TableModel): number {
  return model.align !== 'center' && model.align !== 'right' && (model.indentTwips ?? 0) > 0
    ? model.indentTwips!
    : 0
}

/** nested tables are bounded by their cell's content width (grid slice minus
 * side padding); without a usable grid the outer budget still bounds them */

/** nested tables are bounded by their cell's content width (grid slice minus
 * side padding); without a usable grid the outer budget still bounds them */
function mapNestedTables(
  model: TableModel,
  widths: number[] | undefined,
  budget: number,
  transform: (nt: TableModel, availTwips: number) => TableModel,
): { rows: TableModel['rows']; changed: boolean } {
  let changed = false
  const rows = model.rows.map((row) => {
    let column = 0
    let cellChanged = false
    const cells = row.map((cell) => {
      const start = column
      const span = cell.colSpan ?? 1
      column += span
      if (!cell.nestedTables?.length) return cell
      const cols = widths?.slice(start, start + span) ?? []
      const mar = cell.cellMarTwips ?? model.cellMarTwips
      const pad = (mar?.left ?? DEFAULT_CELL_MAR) + (mar?.right ?? DEFAULT_CELL_MAR)
      const cellWidth = cols.length === span ? cols.reduce((a, b) => a + b, 0) - pad : budget
      if (cellWidth <= 0) return cell
      const nested = cell.nestedTables.map((nt) => transform(nt, cellWidth))
      if (nested.every((nt, i) => nt === cell.nestedTables![i])) return cell
      cellChanged = true
      return { ...cell, nestedTables: nested }
    })
    if (!cellChanged) return row
    changed = true
    return cells
  })
  return { rows, changed }
}

function withColWidths(
  model: TableModel,
  rows: TableModel['rows'],
  widths: number[] | undefined,
): TableModel {
  if (!widths) return { ...model, rows }
  const total = widths.reduce((a, b) => a + b, 0)
  return {
    ...model,
    rows,
    colWidthsTwips: widths,
    ...(total > 0 ? { colWidthsPct: widths.map((w) => (w / total) * 100) } : {}),
  }
}

/**
 * Last-resort display clamp for grids wider than the hard cap (the paper width
 * for top-level tables, the cell content width for nested ones — Word lets
 * over-wide tables spill into the page margins, clipped at the paper, so
 * merely exceeding the text column must not narrow columns and wrap their
 * text onto extra lines). The cut comes proportionally out of the surplus
 * over each column's min-content, so a garbage gridCol absorbs it while real
 * columns keep their words unbroken. Fixed table layout grows past
 * width/max-width to the sum of absolute column widths, so an unclamped
 * garbage gridCol pushes content megapixels off page. Display-only like
 * capTableRowHeights: untouched tables still save their original bytes, and
 * structural rebuilds already regenerate the grid from these display widths
 * (same as user column resizes, which are clamped too).
 */

/**
 * Last-resort display clamp for grids wider than the hard cap (the paper width
 * for top-level tables, the cell content width for nested ones — Word lets
 * over-wide tables spill into the page margins, clipped at the paper, so
 * merely exceeding the text column must not narrow columns and wrap their
 * text onto extra lines). The cut comes proportionally out of the surplus
 * over each column's min-content, so a garbage gridCol absorbs it while real
 * columns keep their words unbroken. Fixed table layout grows past
 * width/max-width to the sum of absolute column widths, so an unclamped
 * garbage gridCol pushes content megapixels off page. Display-only like
 * capTableRowHeights: untouched tables still save their original bytes, and
 * structural rebuilds already regenerate the grid from these display widths
 * (same as user column resizes, which are clamped too).
 */
export function clampTableColWidths(
  model: TableModel,
  capTwips: number,
  metrics: FontMetricsProvider | null = canvasMetrics(),
): TableModel {
  const budget = capTwips - tableIndentTwips(model)
  let widths = model.colWidthsTwips
  let widthsChanged = false
  if (widths && budget > 0 && widths.reduce((a, b) => a + b, 0) > budget) {
    const mins = minContentColTwips(model, widths.length, metrics).map((m, i) =>
      Math.min(Math.max(m, MIN_COL_TWIPS), budget, widths![i]),
    )
    const overflow = widths.reduce((a, b) => a + b, 0) - budget
    const surplus = widths.map((w, i) => w - mins[i])
    const totalSurplus = surplus.reduce((a, b) => a + b, 0)
    if (totalSurplus > 0) {
      const take = Math.min(overflow, totalSurplus)
      widths = widths.map((w, i) => w - Math.round((surplus[i] / totalSurplus) * take))
    }
    // min-contents alone can exceed the cap: compress proportionally
    const sum = widths.reduce((a, b) => a + b, 0)
    if (sum > budget) {
      const scale = budget / sum
      widths = widths.map((w) => Math.max(1, Math.round(w * scale)))
    }
    widthsChanged = true
  }
  const { rows, changed: rowsChanged } = mapNestedTables(model, widths, budget, (nt, cap) =>
    clampTableColWidths(nt, cap, metrics),
  )
  if (!widthsChanged && !rowsChanged) return model
  return withColWidths(model, rows, widthsChanged ? widths : undefined)
}

/**
 * Browser fallback faces run wider than the 0.52em heuristic average (Arial /
 * Helvetica digits and most lowercase advance 0.556em, +7%); an under-floored
 * column re-shatters the very word the floor exists for (RFP sample: two-digit
 * row numbers broke one digit per line; Word grants that column ~11% over the
 * estimate). Measured widths only need rounding headroom.
 */

/**
 * Browser fallback faces run wider than the 0.52em heuristic average (Arial /
 * Helvetica digits and most lowercase advance 0.556em, +7%); an under-floored
 * column re-shatters the very word the floor exists for (RFP sample: two-digit
 * row numbers broke one digit per line; Word grants that column ~11% over the
 * estimate). Measured widths only need rounding headroom.
 */
const MIN_CONTENT_SLACK = 1.08

const MEASURED_SLACK = 1.02
/** collapsed half-borders plus px rounding eat ~1px per side of the measured word (CI cap tables shattered "Board") */

/** collapsed half-borders plus px rounding eat ~1px per side of the measured word (CI cap tables shattered "Board") */
const MEASURED_EDGE_PX = 2

/** per grid column (twips): widest unbreakable word in single-span cells, plus side
 * padding; `bare` drops the slack (a grid Word laid out already holds its words) */

/** per grid column (twips): widest unbreakable word in single-span cells, plus side
 * padding; `bare` drops the slack (a grid Word laid out already holds its words) */
function minContentColTwips(
  model: TableModel,
  colCount: number,
  metrics: FontMetricsProvider | null,
  bare = false,
  defaults?: RunDefaults,
): number[] {
  const slack = bare ? 1 : metrics ? MEASURED_SLACK : MIN_CONTENT_SLACK
  const mins = new Array<number>(colCount).fill(0)
  for (const row of model.rows) {
    let column = 0
    for (const cell of row) {
      const start = column
      column += cell.colSpan ?? 1
      if ((cell.colSpan ?? 1) !== 1 || start >= colCount) continue
      // merged-away and vertical-text cells don't demand word width
      if (cell.vMerge === 'continue' || cell.textDirection) continue
      const mar = cell.cellMarTwips ?? model.cellMarTwips
      const pad = (mar?.left ?? DEFAULT_CELL_MAR) + (mar?.right ?? DEFAULT_CELL_MAR)
      for (const nt of cell.nestedTables ?? []) {
        const ntMin = nestedTableMinTwips(nt, metrics, defaults)
        if (ntMin > 0) mins[start] = Math.max(mins[start], ntMin + pad)
      }
      let wordPx = cellMaxWordPx(cell, metrics, defaults)
      if (wordPx <= 0) continue
      if (metrics && !bare) wordPx += MEASURED_EDGE_PX
      mins[start] = Math.max(mins[start], Math.ceil(wordPx * slack * 15) + pad)
    }
  }
  return mins
}

/** the autofit reclaim pass never compresses a column below its min-content
 * or MIN_COL_TWIPS; sliver slots already under that keep their width */

/** the autofit reclaim pass never compresses a column below its min-content
 * or MIN_COL_TWIPS; sliver slots already under that keep their width */
function reclaimFloorTwips(width: number, minContent: number): number {
  return Math.max(minContent, Math.min(width, MIN_COL_TWIPS))
}

/** w:tblCellSpacing: the table spans its w:tblGrid and the (n + 1) gaps of 2s come
 * out of the columns as 2s each plus s more on the two outer ones (Word-saved grids:
 * 45/30/30/45 for s = 15, 60 for a single column) */

/** w:tblCellSpacing: the table spans its w:tblGrid and the (n + 1) gaps of 2s come
 * out of the columns as 2s each plus s more on the two outer ones (Word-saved grids:
 * 45/30/30/45 for s = 15, 60 for a single column) */
export function cellSpacingGridSharesTwips(colCount: number, spacingTwips: number): number[] {
  const n = Math.max(1, colCount)
  return Array.from(
    { length: n },
    (_, i) => 2 * spacingTwips + (i === 0 ? spacingTwips : 0) + (i === n - 1 ? spacingTwips : 0),
  )
}

/** drawn px of the vertical cell borders per column of a w:tblCellSpacing table: Word
 * draws them outside the cell box (probe: centre lines 0.25 pt out), so the text keeps
 * its full margin inset and the box grows by the border on each side */

/** drawn px of the vertical cell borders per column of a w:tblCellSpacing table: Word
 * draws them outside the cell box (probe: centre lines 0.25 pt out), so the text keeps
 * its full margin inset and the box grows by the border on each side */
export function cellSpacingBorderPx(colCount: number, borders: TableModel['borders']): number[] {
  const n = Math.max(1, colCount)
  const inside = borderDrawnPx(borders?.insideV)
  return Array.from(
    { length: n },
    (_, i) =>
      (i === 0 ? borderDrawnPx(borders?.left) : inside) +
      (i === n - 1 ? borderDrawnPx(borders?.right) : inside),
  )
}

/** a left-aligned explicit dxa w:tblW without w:tblLayout fixed is drawn at its declared
 * widths even past the paper edge (Word clips there); centred and right-aligned ones
 * still compress to the paper */

/** a left-aligned explicit dxa w:tblW without w:tblLayout fixed is drawn at its declared
 * widths even past the paper edge (Word clips there); centred and right-aligned ones
 * still compress to the paper */
export function holdsDeclaredWidth(model: TableModel): boolean {
  return (
    model.dxaWidth === true &&
    !model.autoLayout &&
    !model.widthPct &&
    !model.floatSide &&
    !model.bidiVisual &&
    model.align !== 'center' &&
    model.align !== 'right' &&
    !!model.colWidthsTwips?.length
  )
}

/** side cell margins of a table's own cells (twips) */

/** side cell margins of a table's own cells (twips) */
function sideMarginTwips(model: TableModel): number {
  const mar = model.cellMarTwips
  return (mar?.left ?? DEFAULT_CELL_MAR) + (mar?.right ?? DEFAULT_CELL_MAR)
}

/** narrowest width a nested table can take inside its cell: fixed grids keep
 * their declared width, pct tables follow the cell, autofit ones shrink to
 * every column's min-content (an empty cell keeps its side margins). Word
 * straddles the outer vertical borders, so the box is half a border wider on
 * each side (a regression sample: eight nesting levels, each parent column
 * = nested grid + 216 + 10 twips for sz 4 borders). */

/** narrowest width a nested table can take inside its cell: fixed grids keep
 * their declared width, pct tables follow the cell, autofit ones shrink to
 * every column's min-content (an empty cell keeps its side margins). Word
 * straddles the outer vertical borders, so the box is half a border wider on
 * each side (a regression sample: eight nesting levels, each parent column
 * = nested grid + 216 + 10 twips for sz 4 borders). */
function nestedTableMinTwips(
  nt: TableModel,
  metrics: FontMetricsProvider | null,
  defaults?: RunDefaults,
): number {
  const widths = nt.colWidthsTwips
  if (!widths?.length || nt.widthPct) return 0
  const indent = tableIndentTwips(nt)
  const border = ((borderTotalPt(nt.borders?.left) + borderTotalPt(nt.borders?.right)) / 2) * 20
  if (nt.fixedLayout) return widths.reduce((a, b) => a + b, 0) + indent + border
  const mins = minContentColTwips(nt, widths.length, metrics, false, defaults)
  return (
    mins.reduce((sum, m, i) => sum + nestedFloorTwips(widths[i], m, sideMarginTwips(nt)), 0) +
    indent +
    border
  )
}

/** a nested table over its cell width shrinks each column to its min-content;
 * an empty column keeps its side margins (Word: tcW 360/360 holding a nested
 * table and "8" in a 544-twip cell -> 222/328), sliver grid slots keep their width */

/** a nested table over its cell width shrinks each column to its min-content;
 * an empty column keeps its side margins (Word: tcW 360/360 holding a nested
 * table and "8" in a 544-twip cell -> 222/328), sliver grid slots keep their width */
function nestedFloorTwips(width: number, minContent: number, sideMar: number): number {
  return Math.max(minContent, Math.min(width, sideMar))
}

/** paragraph indent inside a cell eats line width like the word itself does;
 * list fallbacks mirror the .doc-li per-level CSS defaults (0.55in + 0.3in/level) */

/** paragraph indent inside a cell eats line width like the word itself does;
 * list fallbacks mirror the .doc-li per-level CSS defaults (0.55in + 0.3in/level) */
function paraIndentPx(para: TableParagraph): number {
  const leftTw = para.indentLeft ?? (para.list ? 792 + 432 * (para.list.ilvl || 0) : 0)
  const firstTw = Math.max(para.indentFirstLine ?? 0, 0)
  return Math.max(leftTw + firstTw, 0) / 15
}

function cellMaxWordPx(
  cell: TableCell,
  metrics: FontMetricsProvider | null,
  defaults?: RunDefaults,
): number {
  const measure = (runs: Parameters<typeof maxWordWidthPx>[0]) =>
    metrics ? maxWordWidthPx(runs, metrics) : maxWordWidthPx(runs)
  let max = 0
  if (cell.richParas?.length) {
    for (const para of cell.richParas) {
      const runs: Parameters<typeof maxWordWidthPx>[0] = []
      for (const r of para.runs) {
        if (!r.text) continue
        // Latin words render in the ascii slot; `font` may be the East Asian face
        const family = r.fontAscii ?? r.font ?? defaults?.font
        const size = r.sizeHalfPoints ?? defaults?.sizeHalfPoints
        runs.push({
          text: r.text,
          ...(family ? { fontFamily: family } : {}),
          ...(size ? { sizeHalfPoints: size } : {}),
          ...(r.bold ? { bold: true } : {}),
          ...(r.italic ? { italic: true } : {}),
        })
      }
      if (!runs.length) continue
      max = Math.max(max, measure(runs) + paraIndentPx(para))
    }
  } else {
    for (const text of cell.paras) {
      if (!text) continue
      max = Math.max(
        max,
        measure([
          {
            text,
            ...(cell.bold ? { bold: true } : {}),
            ...(defaults?.font ? { fontFamily: defaults.font } : {}),
            ...(defaults?.sizeHalfPoints ? { sizeHalfPoints: defaults.sizeHalfPoints } : {}),
          },
        ]),
      )
    }
  }
  return max
}

/**
 * Word autofit (tblW auto/absent, no fixed tblLayout): a column grows to its
 * min-content — the widest unbreakable word — so narrow declared widths don't
 * shatter words char by char (heuristic estimate, see maxWordWidthPx). Growth
 * past the fit width, like a declared total already past it, is reclaimed
 * proportionally from columns with surplus over their own min-content; any
 * remainder spills and is bounded by clampTableColWidths. Display-only, like
 * the clamp.
 */

/**
 * Word autofit (tblW auto/absent, no fixed tblLayout): a column grows to its
 * min-content — the widest unbreakable word — so narrow declared widths don't
 * shatter words char by char (heuristic estimate, see maxWordWidthPx). Growth
 * past the fit width, like a declared total already past it, is reclaimed
 * proportionally from columns with surplus over their own min-content; any
 * remainder spills and is bounded by clampTableColWidths. Display-only, like
 * the clamp.
 */
export function expandAutofitColWidths(
  model: TableModel,
  availTwips: number,
  fitTwips: number = availTwips,
  metrics: FontMetricsProvider | null = canvasMetrics(),
  nested = false,
  legacy = false,
  defaults?: RunDefaults,
): TableModel {
  const indent = tableIndentTwips(model)
  const budget = availTwips - indent
  let widths = model.colWidthsTwips
  let widthsChanged = false
  // a dxa tblW is only a preferred width: without w:tblLayout fixed Word still
  // grows a column to its widest unbreakable word and reclaims the growth from
  // the other columns' surplus, keeping the declared total (measured: a long
  // merge-field token grew its tcW 2835 -> 3000, neighbours shrank)
  const autofit = model.autoLayout || (!model.fixedLayout && !model.widthPct)
  // pct-width autofit tables: the min-content floor applies to the resolved
  // widths (Word never wraps below the widest word even when w:tblW is a tiny
  // percentage); growth converts the table to absolute widths for display.
  // pct resolves against the full text column — the render path draws
  // width:N% of the content box and applies the indent as a margin
  let resolvedPct = false
  if (autofit && model.widthPct && model.colWidthsPct?.length && budget > 0) {
    const tableW = (Math.min(fitTwips, availTwips) * model.widthPct) / 100
    if (tableW > 0) {
      widths = model.colWidthsPct.map((p) => Math.round((p / 100) * tableW))
      resolvedPct = true
    }
  }
  if (autofit && (resolvedPct || !model.widthPct) && widths?.length && budget > 0) {
    const mins = minContentColTwips(
      model,
      widths.length,
      metrics,
      !!model.layoutGrid,
      defaults,
    ).map((m) => Math.min(m, budget))
    const declared = widths.reduce((a, b) => a + b, 0)
    const fit = Math.min(fitTwips, availTwips)
    const target = fit - indent
    // Over-wide tblW-auto preferred widths compress to the column less the
    // signed table indent (Word probe 2026-09-17, compat 14 and 15: tblInd -108
    // widens the box by 108, +558 narrows it by 558, the right edge stays on
    // the margin). Compat < 15 measures the indent to the cell text, so the
    // border box hangs by the side cell margins - the left one is already in
    // the legacy indent shift, the right one is added here (centered tables
    // shift nothing and hang on both sides). A nested table sits inside the
    // cell padding, so it never hangs. An explicit dxa tblW is honoured
    // (measured: landscape and portrait forms 7-22% wider than the column,
    // negative tblInd, drawn at full width; a left-aligned 531 pt grid on a
    // 451 pt column ran 8 pt past the paper edge, clipped, rows single-line).
    const sideMar = sideMarginTwips(model)
    const leftAligned = model.align !== 'center' && model.align !== 'right'
    const legacyHang = !legacy
      ? 0
      : leftAligned && !model.floatSide
        ? (model.cellMarTwips?.right ?? DEFAULT_CELL_MAR)
        : sideMar
    const box = fit - (leftAligned ? (model.indentTwips ?? 0) : 0) + legacyHang
    const hang = leftAligned ? Math.min(model.indentTwips ?? 0, 0) : 0
    const explicitDxa =
      !model.autoLayout &&
      !nested &&
      ((model.dxaWidth && leftAligned && !model.floatSide) || declared + hang <= budget)
    const kept =
      resolvedPct || nested
        ? target
        : Math.max(target, explicitDxa ? declared : Math.min(declared, box))
    if (mins.some((m, i) => m > widths![i]) || (!resolvedPct && declared > kept)) {
      const grown = widths.map((w, i) => Math.max(w, mins[i]))
      const overflow = grown.reduce((a, b) => a + b, 0) - kept
      if (overflow > 0) {
        const floors = grown.map((w, i) =>
          nested ? nestedFloorTwips(w, mins[i], sideMar) : reclaimFloorTwips(w, mins[i]),
        )
        const surplus = grown.map((w, i) => Math.max(0, w - floors[i]))
        const totalSurplus = surplus.reduce((a, b) => a + b, 0)
        if (totalSurplus > 0) {
          const take = Math.min(overflow, totalSurplus)
          for (let i = 0; i < grown.length; i++)
            grown[i] -= Math.round((surplus[i] / totalSurplus) * take)
        }
        // min-contents alone can exceed the budget (one huge unbreakable
        // token): compress proportionally like Word instead of handing the
        // excess to clampTableColWidths, which zeroes trailing columns
        const sum = grown.reduce((a, b) => a + b, 0)
        if (sum > kept) {
          const scale = kept / sum
          for (let i = 0; i < grown.length; i++)
            grown[i] = Math.max(1, Math.round(grown[i] * scale))
        }
      }
      widths = grown
      widthsChanged = true
    }
  }
  const { rows, changed: rowsChanged } = mapNestedTables(model, widths, budget, (nt, avail) =>
    expandAutofitColWidths(nt, avail, avail, metrics, true, false, defaults),
  )
  if (!widthsChanged && !rowsChanged) return model
  const result = withColWidths(model, rows, widthsChanged ? widths : undefined)
  if (widthsChanged && resolvedPct) delete result.widthPct
  return result
}

/** a floating table hung on the left margin without an offset: Word places
 *  its cell text at the margin like an inline table (compat < 15 probe) */

/** a floating table hung on the left margin without an offset: Word places
 *  its cell text at the margin like an inline table (compat < 15 probe) */
function marginHungFloat(model: TableModel): boolean {
  const pos = model.floatPos
  return model.floatSide === 'left' && pos?.horzAnchor === 'margin' && !pos.xSpec && !pos.xTwips
}

/** legacy tblInd (measured to the cell text) as a border-edge indent; display-only */

/** legacy tblInd (measured to the cell text) as a border-edge indent; display-only */
export function legacyIndentTable(model: TableModel): TableModel {
  if (model.align === 'center' || model.align === 'right') return model
  if (model.floatSide && !marginHungFloat(model)) return model
  // measured to the first cell's text: its own w:tcMar, then the 2s gap and
  // the whole (uncollapsed) border a w:tblCellSpacing table draws before it
  const first = model.rows[0]?.[0]
  const spacing = model.cellSpacingTwips ?? 0
  const shift =
    (first?.cellMarTwips?.left ?? model.cellMarTwips?.left ?? DEFAULT_CELL_MAR) +
    (spacing > 0
      ? 2 * spacing + borderDrawnPx(first?.borders?.left ?? model.borders?.left) * 15
      : 0)
  if (shift <= 0) return model
  // w:tblpPr supersedes w:tblInd, so a float hangs by the cell margin alone
  return { ...model, indentTwips: (model.floatSide ? 0 : (model.indentTwips ?? 0)) - shift }
}

function displayTable(
  table: TableModel | null,
  rowCapTwips: number | null,
  budget: TableWidthBudget | null,
  options: PmDocOptions = {},
): TableModel | null {
  if (!table) return null
  let t = table
  if (options.legacyTableIndent) t = legacyIndentTable(t)
  if (rowCapTwips != null) t = capTableRowHeights(t, rowCapTwips)
  if (budget != null) {
    t = expandAutofitColWidths(
      t,
      budgetAvail(t, budget),
      budget.fit,
      undefined,
      false,
      options.legacyTableIndent ?? false,
      options.defaultRun,
    )
    if (!holdsDeclaredWidth(t)) t = clampTableColWidths(t, budget.paper)
  }
  return t
}

function blockToPmNode(
  block: Block,
  rowCapTwips: number | null = null,
  budget: TableWidthBudget | null = null,
  options: PmDocOptions = {},
): PmNode {
  if (block.altChunk && options.legacyTableIndent)
    options = { ...options, legacyTableIndent: false }
  switch (block.type) {
    case 'heading':
      return {
        type: 'docHeading',
        attrs: {
          docxIndex: block.docxIndex,
          styleId: block.styleId ?? null,
          aiChanged: false,
          level: block.level ?? 1,
          outlineOnly: block.outlineOnly ?? null,
          bookmarks: block.bookmarks ?? null,
          hiddenBookmarks: block.hiddenBookmarks ?? null,
          commentStarts: block.commentStarts ?? null,
          commentEnds: block.commentEnds ?? null,
          pPrChange: block.pPrChangeInfo ? JSON.stringify(block.pPrChangeInfo) : null,
          paraMarkDel: block.paraMarkDel ? JSON.stringify(block.paraMarkDel) : null,
          blockRevision: block.blockRevision ?? null,
          ...formatAttrs(block.format, block.runs),
        },
        content: runsToInline(block.runs ?? []),
      }
    case 'listItem':
      return {
        type: 'docListItem',
        attrs: {
          docxIndex: block.docxIndex,
          styleId: block.styleId ?? null,
          aiChanged: false,
          kind: block.list?.kind ?? 'bullet',
          numId: block.list?.numId ?? null,
          ilvl: block.list?.ilvl ?? 0,
          bookmarks: block.bookmarks ?? null,
          hiddenBookmarks: block.hiddenBookmarks ?? null,
          commentStarts: block.commentStarts ?? null,
          commentEnds: block.commentEnds ?? null,
          pPrChange: block.pPrChangeInfo ? JSON.stringify(block.pPrChangeInfo) : null,
          paraMarkDel: block.paraMarkDel ? JSON.stringify(block.paraMarkDel) : null,
          blockRevision: block.blockRevision ?? null,
          ...formatAttrs(block.format, block.runs),
        },
        content: runsToInline(block.runs ?? []),
      }
    case 'paragraph':
      return {
        type: 'docParagraph',
        attrs: {
          docxIndex: block.docxIndex,
          styleId: block.styleId ?? null,
          aiChanged: false,
          bookmarks: block.bookmarks ?? null,
          hiddenBookmarks: block.hiddenBookmarks ?? null,
          commentStarts: block.commentStarts ?? null,
          commentEnds: block.commentEnds ?? null,
          sdtShell: block.sdtShell ? JSON.stringify(block.sdtShell) : null,
          moveRevision: block.moveRevision ?? null,
          pPrChange: block.pPrChangeInfo ? JSON.stringify(block.pPrChangeInfo) : null,
          paraMarkDel: block.paraMarkDel ? JSON.stringify(block.paraMarkDel) : null,
          blockRevision: block.blockRevision ?? null,
          ...formatAttrs(block.format, block.runs),
        },
        content: runsToInline(block.runs ?? []),
      }
    case 'table': {
      const table = block.table ?? { rows: [[{ paras: [''] }]] }
      const node = tableModelToPmNode(
        table,
        block.docxIndex,
        block.blockRevision ?? null,
        rowCapTwips,
        budget ? budgetAvail(table, budget) : null,
        budget?.fit ?? null,
        budget?.paper ?? null,
        options.legacyTableIndent ?? false,
        options.defaultRun,
      )
      // content-control member tables need the shell for chrome hit-testing
      if (block.sdtShell) node.attrs = { ...node.attrs, sdtShell: JSON.stringify(block.sdtShell) }
      return node
    }
    default:
      // image / passthrough: protected whole-unit blocks
      return {
        type: 'docProtected',
        attrs: {
          docxIndex: block.docxIndex,
          blockRevision: block.blockRevision ?? null,
          blockType: block.type,
          styleId: block.styleId ?? null,
          pageBreakBefore: block.format?.pageBreakBefore ?? false,
          label: block.label ?? block.type,
          previewText: block.previewText ?? '',
          imageDataUrl: block.imageDataUrl ?? null,
          oleProgId: block.oleProgId ?? null,
          imageWidthPx: block.imageWidthPx ?? null,
          imageHeightPx: block.imageHeightPx ?? null,
          imageCrop: block.imageCrop ?? null,
          imageEffects: block.imageEffects ?? null,
          imageFillRect: block.imageFillRect ?? null,
          imageLeadingText: block.imageLeadingText ?? null,
          imageLeadingFont: block.imageLeadingFont ?? null,
          imageLeadingExplicitSpaceWidthPx: block.imageLeadingExplicitSpaceWidthPx ?? null,
          imageLeadingImplicitSpaceCount: block.imageLeadingImplicitSpaceCount ?? null,
          imageParagraphIndentLeft: block.imageParagraphIndentLeft ?? null,
          imageParagraphIndentRight: block.imageParagraphIndentRight ?? null,
          imageParagraphIndentFirstLine: block.imageParagraphIndentFirstLine ?? null,
          imageParagraphSpaceBefore: block.imageParagraphSpaceBefore ?? null,
          imageParagraphSpaceAfter: block.imageParagraphSpaceAfter ?? null,
          imageParagraphLineTwips: block.imageParagraphLineTwips ?? null,
          imageParagraphLineRule: block.imageParagraphLineRule ?? null,
          imageMarkFont: block.imageMarkFont ?? null,
          imageMarkFontEastAsia: block.imageMarkFontEastAsia ?? null,
          imageMarkSizeHalfPoints: block.imageMarkSizeHalfPoints ?? null,
          imageEffectExtentTopPx: block.imageEffectExtentTopPx ?? null,
          imageEffectExtentBottomPx: block.imageEffectExtentBottomPx ?? null,
          imageAlign: block.imageAlign ?? null,
          imageWrap: block.imageWrap ?? null,
          imageBand: block.imageBand ?? false,
          imageWrapDistTopEmu: block.imageWrapDistTopEmu ?? null,
          imageWrapDistBottomEmu: block.imageWrapDistBottomEmu ?? null,
          imageWrapDistLeftEmu: block.imageWrapDistLeftEmu ?? null,
          imageWrapDistRightEmu: block.imageWrapDistRightEmu ?? null,
          imageZOrder: block.imageZOrder ?? null,
          imageOffsetXEmu: block.imageOffsetXEmu ?? null,
          imageOffsetYEmu: block.imageOffsetYEmu ?? null,
          imageRelV: block.imageRelV ?? null,
          imageRelH: block.imageRelH ?? null,
          imageAnchorLocked: block.imageAnchorLocked ?? false,
          imagePosH: block.imagePosH ?? null,
          imagePosV: block.imagePosV ?? null,
          imageRotDeg: block.imageRotDeg ?? null,
          imageFlipH: block.imageFlipH ?? false,
          imageFlipV: block.imageFlipV ?? false,
          imageBorder: block.imageBorder ?? null,
          table: displayTable(block.table ?? null, rowCapTwips, budget, options),
          fieldDisplay: block.fieldDisplay ?? null,
          diagramDisplay: block.diagramDisplay ?? null,
          decorative: block.decorative ?? false,
          ruleColorHex: block.ruleColorHex ?? null,
          ruleThicknessPx: block.ruleThicknessPx ?? null,
          ruleWidthPx: block.ruleWidthPx ?? null,
          brokenImage: block.brokenImage ?? false,
          invisibleMarker: block.invisibleMarker ?? false,
          anchorLine: block.anchorLine
            ? {
                styleId: block.anchorLine.styleId ?? null,
                ...formatAttrs(block.anchorLine.format),
                ...(block.anchorLine.clear ? { clear: block.anchorLine.clear } : {}),
              }
            : null,
          textboxes: block.textboxes ?? null,
          anchorSnapToGrid: block.anchorSnapToGrid ?? null,
          strayRuns: block.strayRuns ?? null,
          strayStyleId: block.strayStyleId ?? null,
          strayIndent: block.strayIndent ?? null,
          strayAlign: block.strayAlign ?? null,
          strayList: block.strayList ?? null,
          formulaDisplay: block.formulaDisplay ?? null,
          chartDisplay: block.chartDisplay ?? null,
        },
      }
  }
}

function cellRowSpan(model: TableModel, row: number, cell: number, positions: number[][]): number {
  const current = model.rows[row][cell]
  if (current.vMerge !== 'restart') return 1
  const gridColumn = positions[row][cell]
  let span = 1
  for (let r = row + 1; r < model.rows.length; r++) {
    const index = positions[r].indexOf(gridColumn)
    if (index === -1 || model.rows[r][index].vMerge !== 'continue') break
    span++
  }
  return span
}

const cellBorderPx = borderDrawnPx

/** Inner clip-box height (twips) for cells of hRule="exact" rows — Word clips overflow
 *  instead of growing the row. null = not exact, or the cell spans rows (its clip height
 *  would be the sum of the spanned rows; not handled yet). */
/** collapsed left/right line widths (drawn px) a cell's text inset must absorb, the
 *  neighbours' lines included; null when both sides fall back to the table-level default */

/** Inner clip-box height (twips) for cells of hRule="exact" rows — Word clips overflow
 *  instead of growing the row. null = not exact, or the cell spans rows (its clip height
 *  would be the sum of the spanned rows; not handled yet). */
/** collapsed left/right line widths (drawn px) a cell's text inset must absorb, the
 *  neighbours' lines included; null when both sides fall back to the table-level default */
export function collapsedCellBw(
  row: TableModel['rows'][number],
  index: number,
): { l?: number; r?: number } | null {
  const cell = row[index]
  const l = collapsedEdgePx(cell.borders?.left, row[index - 1]?.borders?.right)
  const r = collapsedEdgePx(cell.borders?.right, row[index + 1]?.borders?.left)
  if (l === undefined && r === undefined) return null
  return { ...(l !== undefined ? { l } : {}), ...(r !== undefined ? { r } : {}) }
}

export function cellClipTwips(
  model: TableModel,
  rowIndex: number,
  cell: TableCell,
  rowSpan: number,
): number | null {
  if (rowSpan > 1 || model.rowHeightRules?.[rowIndex] !== 'exact') return null
  const h = model.rowHeightsTwips?.[rowIndex]
  if (!h) return null
  const padTop = cell.cellMarTwips?.top ?? model.cellMarTwips?.top ?? 0
  const padBottom = cell.cellMarTwips?.bottom ?? model.cellMarTwips?.bottom ?? 0
  // collapsed borders straddle the row edges: half of each eats into the row height
  const bTop = cell.borders?.top ?? (rowIndex === 0 ? model.borders?.top : model.borders?.insideH)
  const bBottom =
    cell.borders?.bottom ??
    (rowIndex === model.rows.length - 1 ? model.borders?.bottom : model.borders?.insideH)
  const borderTwips = Math.round(((cellBorderPx(bTop) + cellBorderPx(bBottom)) / 2) * 15)
  return Math.max(0, h - padTop - padBottom - borderTwips)
}

/** free side beside a text-anchored float below which Word's side text is only word fragments */

/** free side beside a text-anchored float below which Word's side text is only word fragments */
const FLOAT_SIDE_MIN_TWIPS = 1440

export function tableModelToPmNode(
  model: TableModel,
  docxIndex: number | null = null,
  blockRevision: Block['blockRevision'] | null = null,
  rowCapTwips: number | null = null,
  availTwips: number | null = null,
  fitTwips: number | null = null,
  paperTwips: number | null = null,
  legacyIndent = false,
  defaults?: RunDefaults,
): PmNode {
  if (legacyIndent) model = legacyIndentTable(model)
  if (rowCapTwips != null) model = capTableRowHeights(model, rowCapTwips)
  if (availTwips != null) {
    model = expandAutofitColWidths(
      model,
      availTwips,
      fitTwips ?? availTwips,
      undefined,
      false,
      legacyIndent,
      defaults,
    )
    if (!holdsDeclaredWidth(model)) model = clampTableColWidths(model, paperTwips ?? availTwips)
  }
  const positions = model.rows.map((row) => {
    let column = 0
    return row.map((cell) => {
      const at = column
      column += cell.colSpan ?? 1
      return at
    })
  })
  // 1 px = 15 twips (96dpi); use real values when absolute grid widths exist, fall back to percentage approximation otherwise.
  // No px floor on real grids: form grids hold dozens of sliver columns that only sit inside spanned cells
  const widthPx = model.colWidthsTwips
    ? model.colWidthsTwips.map((width) => Math.max(1, Math.round(width / 15)))
    : model.colWidthsPct?.map((width) => Math.max(24, Math.round(width * 6.24)))
  const hasHeaderRow =
    model.rows.length > 1 && model.rows[0].every((cell) => cell.bold || cell.fill !== undefined)
  // w:tblpPr tables taller than any single page cannot float: Word flows/splits
  // them across pages, while the zero-flow-height float model collapses the
  // whole document to one page (137-row glossary, LO batch2 sample 0219).
  // Minimum height = one 12pt line per row; 12960 twips ≈ the shortest common
  // usable page (Letter, 1in margins).
  const minHeightTwips = model.rows.reduce(
    (sum, _row, i) => sum + Math.max(model.rowHeightsTwips?.[i] ?? 0, 240),
    0,
  )
  const tblFloatSource = model.floatSide ?? null
  // Word splits text-anchored floating tables across page boundaries instead of
  // pushing them whole; a float that leaves less than ~1in beside it hosts a
  // few word fragments at most (Word probe 2026-09-04), so flowing it inline
  // reproduces the split and stops the push from opening a near-blank page
  // (prod100r4/68). It also keeps the next block's line boxes, which CSS drops
  // below a float they cannot sit beside, from turning that block into one
  // float-spanning over-page line that clips away a page of content (SAS
  // batch 2 sample 028). Only the subset that STARTS at the column's left edge
  // (within ~1in of the paper edge for page anchors, at the margin otherwise):
  // inline flow reproduces its geometry, while a mid-page X keeps the
  // clamped-float rendering (#1111 cap-table corpus).
  const floatX = model.floatPos?.xTwips ?? 0
  const floatSpan =
    (model.floatPos?.horzAnchor === 'page' ? 0 : floatX) +
    (model.colWidthsTwips?.reduce((a, b) => a + b, 0) ?? 0) +
    (model.floatPos?.distanceTwips?.right ?? 0)
  // a short table hung a positive w:tblpY below its anchor keeps floating: Word
  // fills that band with the anchor paragraph's lines, which only the float
  // (shape-outside inset) reproduces
  const bandFloat = (model.floatPos?.yTwips ?? 0) > 0 && minHeightTwips <= 6480
  const floatNoSideRoom =
    (model.floatPos?.vertAnchor ?? 'text') === 'text' &&
    (model.floatPos?.horzAnchor === 'page' ? floatX <= 1440 : floatX <= 720) &&
    fitTwips != null &&
    floatSpan > fitTwips - FLOAT_SIDE_MIN_TWIPS &&
    !bandFloat
  const tblFloatSuppressed = tblFloatSource !== null && (minHeightTwips > 12960 || floatNoSideRoom)
  const tblFloat = tblFloatSuppressed ? null : tblFloatSource
  const table: PmNode = {
    type: 'docTable',
    attrs: {
      docxIndex,
      blockRevision,
      colWidthsPct: model.colWidthsPct ?? null,
      // never narrower than the grid: Word's autofit columns hold their widest
      // line with zero slack, so rounding the table down wraps that line
      widthPx:
        !model.widthPct && model.colWidthsTwips && widthPx
          ? Math.max(
              widthPx.length,
              Math.ceil(model.colWidthsTwips.reduce((sum, width) => sum + width, 0) / 15 - 1e-6),
            )
          : null,
      widthPct: model.widthPct ?? null,
      cellMar: model.cellMarTwips ?? null,
      cellSpacingTwips: model.cellSpacingTwips ?? null,
      tblFill: model.fill ?? null,
      cellMarEdited: false,
      borders: model.borders ?? null,
      tblAlign: model.align ?? null,
      tblFloat,
      tblFloatSource,
      tblFloatSuppressed,
      tblFloatXTwips: model.floatPos?.xTwips ?? null,
      tblFloatYTwips: model.floatPos?.yTwips ?? null,
      tblFloatHorzAnchor: model.floatPos?.horzAnchor ?? null,
      tblFloatVertAnchor: model.floatPos?.vertAnchor ?? null,
      tblFloatXSpec: model.floatPos?.xSpec ?? null,
      tblFloatYSpec: model.floatPos?.ySpec ?? null,
      tblFloatDistance: model.floatPos?.distanceTwips ?? null,
      tblFloatWidthPx:
        tblFloatSource && widthPx ? widthPx.reduce((sum, width) => sum + width, 0) : null,
      tblFloatEdited: false,
      tblAutoFit: model.autoFit ?? (model.autoLayout ? 'contents' : 'fixed'),
      tblAutoFitEdited: false,
      tblFixedLayout: model.fixedLayout ?? false,
      tblDxaWidth: model.dxaWidth ?? false,
      // w:tblpPr supersedes w:tblInd: a float keeps only the legacy cell-margin hang
      indentTwips:
        tblFloat && !(legacyIndent && marginHungFloat(model)) ? null : (model.indentTwips ?? null),
      tblStyleId: model.tblStyleId ?? null,
      tblLook: model.tableLook ?? null,
      tblLookEdited: false,
      bidiVisual: model.bidiVisual ?? false,
      tblCaption: model.caption ?? null,
      tblDescription: model.description ?? null,
      tblAltEdited: false,
      originalStructure: null,
      originalFormatting: null,
    },
    content: model.rows.map((row, rowIndex) => ({
      type: 'docTableRow',
      attrs: {
        heightTwips: model.rowHeightsTwips?.[rowIndex] ?? null,
        heightRule: model.rowHeightRules?.[rowIndex] ?? null,
        repeatHeader: model.repeatHeaderRows?.[rowIndex] ?? false,
        repeatHeaderEdited: false,
        cantSplit: model.rowCantSplit?.[rowIndex] ?? false,
        cantSplitEdited: false,
        rawTrPr: model.rawTrPrs?.[rowIndex] ?? null,
        rowRevision: model.rowRevisions?.[rowIndex] ?? null,
      },
      content: row.flatMap((cell, cellIndex) => {
        if (cell.vMerge === 'continue') return []
        const start = positions[rowIndex][cellIndex]
        const colspan = cell.colSpan ?? 1
        const rowspan = cellRowSpan(model, rowIndex, cellIndex, positions)
        return [
          {
            type: hasHeaderRow && rowIndex === 0 ? 'docTableHeader' : 'docTableCell',
            attrs: {
              colspan,
              rowspan,
              clipHeightTwips: cellClipTwips(model, rowIndex, cell, rowspan),
              colwidth: widthPx ? widthPx.slice(start, start + colspan) : null,
              gridGap: cell.gridGap ?? false,
              cellMar: cell.cellMarTwips ?? null,
              textDirection: cell.textDirection ?? null,
              noWrap: cell.noWrap ?? null,
              tcPrEdited: false,
              fill: cell.fill ?? null,
              color: cell.styleColor ?? null,
              bold: cell.styleBold ?? false,
              align: cell.align ?? null,
              vAlign: cell.vAlign ?? null,
              borders: cell.borders ?? null,
              collapsedBw: collapsedCellBw(row, cellIndex),
              rawTcPr: cell.rawTcPr ?? null,
              cellRevision: cell.cellRevision ?? null,
            },
            content: cellContentNodes(cell),
          },
        ]
      }),
    })),
  }
  table.attrs!.originalStructure = tableStructureSignature(table)
  table.attrs!.originalFormatting = tableFormattingSignature(table)
  return table
}

/** cell paragraphs with nested tables (read-only atoms) spliced in at their anchors */

/** cell paragraphs with nested tables (read-only atoms) spliced in at their anchors */
function cellContentNodes(cell: TableCell): PmNode[] {
  const paraNodes: PmNode[] = (
    cell.richParas?.length
      ? cell.richParas
      : (cell.paras.length > 0 ? cell.paras : ['']).map((text) => ({
          align: cell.align,
          runs: text === '' ? [] : [{ text, bold: cell.bold, color: cell.color }],
        }))
  ).map((paragraph) => {
    const list = 'list' in paragraph ? paragraph.list : undefined
    const styleId = ('styleId' in paragraph ? paragraph.styleId : undefined) ?? null
    return list
      ? {
          type: 'docListItem',
          attrs: {
            ...formatAttrs(paragraph, paragraph.runs),
            styleId,
            kind: list.kind,
            numId: list.numId,
            ilvl: list.ilvl,
          },
          content: runsToInline(paragraph.runs),
        }
      : {
          type: 'docParagraph',
          attrs: { ...formatAttrs(paragraph, paragraph.runs), styleId },
          content: runsToInline(paragraph.runs),
        }
  })
  // fidelity on save comes from the outer table's bytes; reverse insertion keeps anchors valid
  const inserts: Array<{ at: number; node: PmNode }> = []
  const nested = cell.nestedTables ?? []
  for (let i = 0; i < nested.length; i++) {
    inserts.push({
      at: Math.min(cell.nestedTableAnchors?.[i] ?? paraNodes.length, paraNodes.length),
      node: { type: 'docNestedTable', attrs: { model: nested[i] } },
    })
  }
  // anchored shapes/textboxes (display-only): a zero-width float strut before
  // each group's anchor paragraph, so the boxes' positionV offsets resolve from
  // that paragraph like Word and the row grows to max(text, boxes)
  const boxes = cell.anchoredBoxes ?? []
  const boxGroups = new Map<number, TextboxDisplay[]>()
  for (let i = 0; i < boxes.length; i++) {
    const at = Math.min(cell.anchoredBoxAnchors?.[i] ?? 0, paraNodes.length)
    const group = boxGroups.get(at)
    if (group) group.push(boxes[i])
    else boxGroups.set(at, [boxes[i]])
  }
  for (const [at, group] of boxGroups) {
    for (const boxes of splitCellBoxGroup(group)) {
      inserts.push({ at, node: { type: 'docCellBoxes', attrs: { boxes } } })
    }
  }
  const content = [...paraNodes]
  inserts.sort((a, b) => a.at - b.at)
  for (let i = inserts.length - 1; i >= 0; i--) {
    content.splice(inserts[i].at, 0, inserts[i].node)
  }
  return content
}

export function runsToInline(runs: Run[]): PmNode[] {
  const nodes: PmNode[] = []
  for (const run of runs) {
    if (run.math) {
      nodes.push({
        type: 'docInlineMath',
        attrs: {
          omml: run.math.omml,
          mathml: inlineMathML(run.math.omml),
          // recovered LaTeX makes parsed formulas re-editable; null = atom only
          latex: ommlToLatex(run.math.omml),
          text: run.text,
          sizeHalfPoints: run.sizeHalfPoints ?? null,
        },
      })
      continue
    }
    if (run.ruby) {
      nodes.push({
        type: 'docRuby',
        attrs: { base: run.text, rt: run.ruby.rt, xml: run.ruby.xml },
      })
      continue
    }
    if (run.noteRef) {
      nodes.push({
        type: 'docNoteRef',
        attrs: {
          kind: run.noteRef.kind,
          id: run.noteRef.id,
          num: parseInt(run.text, 10) || 1,
        },
      })
      continue
    }
    const marks = runMarks(run)
    // \n = soft line break, \f = in-paragraph page break, \v = column break, \u001e = text wrapping break
    const breakMarks = marks.length > 0 ? { marks } : {}
    // eslint-disable-next-line no-control-regex
    for (const segment of symDisplayText(run).split(/([\n\f\v\u001e])/)) {
      if (segment === '\n') nodes.push({ type: 'hardBreak', ...breakMarks })
      else if (segment === '\f')
        nodes.push({ type: 'hardBreak', attrs: { pageBreak: true }, ...breakMarks })
      else if (segment === '\v')
        nodes.push({ type: 'hardBreak', attrs: { colBreak: true }, ...breakMarks })
      else if (segment === '\u001e')
        nodes.push({ type: 'hardBreak', attrs: { wrapBreak: true }, ...breakMarks })
      else if (segment !== '') {
        nodes.push({ type: 'text', text: segment, ...(marks.length > 0 ? { marks } : {}) })
      }
    }
    // A run can carry both w:t text and a w:drawing; generate.ts writes the
    // text before the drawing, so emit the image after the text segments
    if (run.image) {
      nodes.push({
        type: 'docInlineImage',
        attrs: {
          dataUrl: run.image.dataUrl,
          widthPx: run.image.widthPx ?? null,
          heightPx: run.image.heightPx ?? null,
          xml: run.image.xml,
          wrap: run.image.wrap ?? null,
          offsetXEmu: run.image.offsetXEmu ?? null,
          offsetYEmu: run.image.offsetYEmu ?? null,
          relV: run.image.relV ?? null,
          relH: run.image.relH ?? null,
          wrapDistTopEmu: run.image.wrapDistTopEmu ?? null,
          wrapDistBottomEmu: run.image.wrapDistBottomEmu ?? null,
          wrapDistLeftEmu: run.image.wrapDistLeftEmu ?? null,
          wrapDistRightEmu: run.image.wrapDistRightEmu ?? null,
          border: run.image.border ?? null,
          lineCenterV: run.image.lineCenterV ?? false,
          rotDeg: run.image.rotDeg ?? null,
          flipH: run.image.flipH ?? false,
          flipV: run.image.flipV ?? false,
          rule: run.image.rule
            ? {
                ...run.image.rule,
                ...(run.sizeHalfPoints ? { sizeHalfPoints: run.sizeHalfPoints } : {}),
              }
            : null,
          rawRPr: run.rawRPr ?? null,
        },
      })
    }
    if (run.xeTerm !== undefined) {
      nodes.push({ type: 'docXeMark', attrs: { term: run.xeTerm } })
    }
  }
  markLeadRule(nodes)
  return nodes
}

const isRuleNode = (n: PmNode): boolean => n.type === 'docInlineImage' && !!n.attrs?.rule

/** a rule opening a paragraph that goes on with content sits on a compact line in
 *  Word (rule height + ~5.5pt), unlike a rule alone or after text (a full line) */

/** a rule opening a paragraph that goes on with content sits on a compact line in
 *  Word (rule height + ~5.5pt), unlike a rule alone or after text (a full line) */
function markLeadRule(nodes: PmNode[]): void {
  const first = nodes[0]
  if (!first || !isRuleNode(first)) return
  if (nodes.slice(1).some((n) => !isRuleNode(n))) first.attrs = { ...first.attrs, leadRule: true }
}

function runMarks(run: Run): PmMark[] {
  const marks: PmMark[] = []
  if (run.bold) marks.push({ type: 'bold' })
  if (run.italic) marks.push({ type: 'italic' })
  if (run.underline) marks.push({ type: 'underline' })
  if (run.strike) marks.push({ type: 'strike' })
  if (run.link)
    marks.push({
      type: 'link',
      attrs: {
        href: run.link.href,
        rId: run.link.rId ?? null,
        tooltip: run.link.tooltip ?? null,
        plain: run.link.plain === true,
      },
    })
  if (run.refField !== undefined)
    marks.push({
      type: 'refField',
      attrs: { name: run.refField, instr: run.refInstr ?? null, dirty: run.fldDirty === true },
    })
  if (run.sym) marks.push({ type: 'docSym', attrs: { font: run.sym.font, char: run.sym.char } })
  if (run.instrField !== undefined) {
    marks.push({
      type: 'instrField',
      attrs: {
        instr: run.instrField,
        beginXml: run.fldBeginXml ?? null,
        dirty: run.fldDirty === true,
      },
    })
  }
  if (run.sdtCheckboxXml !== undefined)
    marks.push({ type: 'ctrlCheckbox', attrs: { sdtPr: run.sdtCheckboxXml } })
  if (run.commentIds?.length)
    marks.push({ type: 'comment', attrs: { ids: run.commentIds.join(' ') } })
  if (run.ins) {
    marks.push({
      type: 'ins',
      attrs: { author: run.ins.author, date: run.ins.date ?? null, id: run.ins.id ?? null },
    })
  }
  if (run.del) {
    marks.push({
      type: 'del',
      attrs: { author: run.del.author, date: run.del.date ?? null, id: run.del.id ?? null },
    })
  }
  if (run.rPrChange) {
    marks.push({
      type: 'rprChange',
      attrs: {
        author: run.rPrChange.author,
        date: run.rPrChange.date ?? null,
        id: run.rPrChange.id ?? null,
        old: run.rPrChange.old ?? null,
      },
    })
  }
  if (
    run.color ||
    run.sizeHalfPoints ||
    run.font ||
    run.fontAscii ||
    run.charSpacingTwips !== undefined ||
    run.charScalePct ||
    run.kernHalfPoints !== undefined ||
    run.highlight ||
    run.shading ||
    run.shadingDisplay ||
    run.textOutline ||
    run.textEffect ||
    run.dstrike ||
    run.glow ||
    run.positionHalfPoints ||
    run.bdr ||
    run.vertAlign ||
    run.em ||
    run.bold === false ||
    run.italic === false ||
    run.caps ||
    run.vanish ||
    run.eastAsiaLang ||
    run.cs ||
    run.rtl !== undefined ||
    run.styleId ||
    run.rawRPr
  ) {
    // an inline-block cannot wrap and drops inherited underlines: only
    // whitespace-free, undecorated runs get the real glyph compression
    const scaleX =
      run.charScalePct && !/\s/.test(run.text) && !run.underline && !run.strike && !run.link
        ? charScaleXAttr(run.text, run.charScalePct, charScaleEm(run.text, run.charScalePct))
        : null
    marks.push({
      type: 'docTextStyle',
      attrs: {
        color: run.color ?? null,
        sizeHalfPoints: run.sizeHalfPoints ?? null,
        font: run.font ?? null,
        eaSlotEmpty: run.eaSlotEmpty ?? null,
        fontAscii: run.fontAscii ?? null,
        eastAsiaFont: run.eastAsiaFont ?? null,
        // cs chain only kicks in for complex-script text (Word's w:cs semantics)
        csFont: run.csFont && textHasComplexScript(run.text) ? run.csFont : null,
        charSpacingTwips: run.charSpacingTwips ?? null,
        charScaleEm: run.charScalePct && !scaleX ? charScaleEm(run.text, run.charScalePct) : null,
        charScaleX: scaleX,
        charScalePct: run.charScalePct ?? null,
        kern: wordKerns(run.kernHalfPoints, run.sizeHalfPoints) ?? null,
        kernHalfPoints: run.kernHalfPoints ?? null,
        highlight: run.highlight ?? null,
        shading: run.shading ?? null,
        shadingDisplay: run.shadingDisplay ?? null,
        textOutline: run.textOutline ? JSON.stringify(run.textOutline) : null,
        textEffect: run.textEffect ?? null,
        dstrike: run.dstrike ?? null,
        glow: run.glow ? JSON.stringify(run.glow) : null,
        positionHalfPoints: run.positionHalfPoints ?? null,
        bdr: run.bdr ? JSON.stringify(run.bdr) : null,
        vertAlign: run.vertAlign ?? null,
        em: run.em ?? null,
        boldOff: run.bold === false || null,
        italicOff: run.italic === false || null,
        caps: run.caps ?? null,
        vanish: run.vanish ?? null,
        vanishOwn: run.vanishOwn ?? null,
        eaLang: run.eastAsiaLang ?? null,
        cs: run.cs ?? null,
        rtl: run.rtl ?? null,
        styleId: run.styleId ?? null,
        rawRPr: run.rawRPr ?? null,
        themeRFonts: run.themeRFonts ? JSON.stringify(run.themeRFonts) : null,
        themeColor: run.themeColor ?? null,
      },
    })
  }
  return marks
}

// ---- re-exported surface (callers keep importing from './convert') ----

export type { PmMark, PmNode } from './pm-shared'
export { inlineToRuns, pmTableToModel } from './pm-shared'
export { pmDocToSavePlan, pmNodeToGeneratedBlock, textboxParaSignature } from './pm-save-plan'
export { signatureOfBlock, signatureOfGenerated } from './pm-save-plan'
export type { SavePlan } from './pm-save-plan'
