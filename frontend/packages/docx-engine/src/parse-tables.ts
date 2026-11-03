// Table domain: w:tbl -> TableModel/TableCell display models, grid column
// reconciliation, style display resolution and the recursive cell builder.

import { splitXmlChildren } from './generate'
import {
  type CellMargins,
  type RevisionInfo,
  type SectionSettings,
  type TableCell,
  type TableModel,
} from './types'
import {
  attrsOf,
  boolProp,
  childrenOf,
  childrenThroughSdt,
  findChild,
  findChildren,
  nameOf,
  serializeXNode,
  textOf,
  deepXmlParser,
  xmlParser,
  type XNode,
} from './xml-utils'
import { colorFrom, plainText } from './parse-xml-text'
import { topLevelDrawings } from './parse-drawing-geometry'
import {
  cellMarginsOf,
  emptyParaMarkFont,
  emptyParaSizeHalfPoints,
  hasLayoutRunContent,
  spaceOnlyRuns,
  mergedBorderLinesOf,
  rowBandSizeOf,
  shdDisplayFill,
  tableLookOf,
} from './parse-props'
import { inheritStyleBreakFlags } from './parse-styles'
import { type BuildContext } from './parse-shared'
import { listKindOf, listRefOf } from './parse-numbering'
import { extractParaFormat, extractRuns, withCharIndents } from './parse-paragraph'
import { ANCHOR_HOSTS, hasDeepChild } from './parse-hf'
import { extractTextboxes } from './parse-textboxes'

export function tableSummary(xml: string): { label: string; previewText: string } {
  const rows = (xml.match(/<w:tr[\s>]/g) ?? []).length
  const firstRow = /<w:tr[\s>][\s\S]*?<\/w:tr>/.exec(xml)?.[0] ?? ''
  const cols = (firstRow.match(/<w:tc[\s>]/g) ?? []).length
  return { label: `Table ${rows}×${cols}`, previewText: plainText(xml).slice(0, 120) }
}

/**
 * Display-only table structure. Nested tables render as read-only sub-tables
 * inside their cell; the exact original bytes are what get saved, so lossiness
 * here only affects on-screen rendering.
 *
 * @param docOffset the table's document.xml offset: cell paragraphs resolve
 *   their character-unit indents under that section's document grid
 */
export function extractTable(xml: string, ctx: BuildContext, docOffset?: number): TableModel | undefined {
  // whole try: hostile depth inside a cell paragraph can overflow the
  // run-extraction recursion — degrade to a protected block, not a failed document
  try {
    const parsed = deepXmlParser.parse(xml) as XNode[]
    const tbl = parsed.find((n) => nameOf(n) === 'w:tbl')
    if (!tbl) return undefined
    const model = extractTableModel(tbl, ctx, 1, docOffset)
    if (!model) return undefined
    const rawTrPrs: Array<string | null> = model.rows.map(() => null)
    attachRawTablePr(xml, model.rows, rawTrPrs)
    if (rawTrPrs.some((r) => r !== null)) model.rawTrPrs = rawTrPrs
    return model
  } catch {
    return undefined
  }
}

/** One w:tbl node → display model (shared by top-level tables and tables nested in cells) */
/**
 * Per-column widths reconstructed from cell w:tcW (dxa) across all rows: the widest
 * un-spanned cell per grid slot wins (Word widens a column to fit later rows, never
 * narrows it). Undefined unless every column got a value — partial data would skew
 * the ratio worse than the tblGrid fallback.
 */
function tcwColumnWidths(tbl: XNode): number[] | undefined {
  const cols: number[] = []
  let colCount = 0
  for (const tr of childrenThroughSdt(tbl, 'w:tr')) {
    const edges = rowGridEdges(tr)
    let idx = edges.before
    for (const tc of childrenThroughSdt(tr, 'w:tc')) {
      const tcPr = findChild(tc, 'w:tcPr')
      const span = Math.max(
        1,
        Number(attrsOf(findChild(tcPr ?? {}, 'w:gridSpan') ?? {})['w:val']) || 1,
      )
      // duplicated w:tcW: Word keeps the last occurrence (generators leave stale first values)
      const a = attrsOf(findChildren(tcPr ?? {}, 'w:tcW').at(-1) ?? {})
      const w = !a['w:type'] || a['w:type'] === 'dxa' ? Number(a['w:w']) || 0 : 0
      if (span === 1 && w > 0) cols[idx] = Math.max(cols[idx] || 0, w)
      idx += span
    }
    colCount = Math.max(colCount, idx + edges.after)
  }
  if (colCount === 0) return undefined
  for (let i = 0; i < colCount; i++) if (!(cols[i] > 0)) return undefined
  return cols.slice(0, colCount)
}

/** trPr w:gridBefore/w:gridAfter column counts plus their w:wBefore/w:wAfter widths (twips) */
function rowGridEdges(tr: XNode): {
  before: number
  after: number
  wBefore?: number
  wAfter?: number
} {
  const trPr = findChild(tr, 'w:trPr')
  if (!trPr) return { before: 0, after: 0 }
  const count = (name: string) => {
    const v = Number(attrsOf(findChild(trPr, name) ?? {})['w:val'])
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  }
  const width = (name: string) => {
    const a = attrsOf(findChild(trPr, name) ?? {})
    const w = !a['w:type'] || a['w:type'] === 'dxa' ? Number(a['w:w']) : NaN
    return w > 0 ? w : undefined
  }
  return {
    before: count('w:gridBefore'),
    after: count('w:gridAfter'),
    wBefore: width('w:wBefore'),
    wAfter: width('w:wAfter'),
  }
}

/** boundary positions within TOL twips fuse into one grid line (rounding drift across generator-written rows) */
const GRID_SNAP_TOL = 20

/**
 * Repair grids whose rows do not all span the declared column count (legacy
 * generators emit gridSpan/tblGrid pairs that disagree with the cells' w:tcW).
 * Word lays each such row out from the cells' preferred widths, so the true
 * grid is the union of every row's tcW boundaries; without this, a cell mapped
 * onto a leftover sliver column collapses to one character per line.
 * Mutates the cells' colSpan and returns the rebuilt column widths, or
 * undefined when the grid is already consistent or a width is unresolvable.
 */
export function reconcileGridColumns(
  rows: TableCell[][],
  rowTcws: Array<Array<number | undefined>>,
  gridCols: number[] | undefined,
): number[] | undefined {
  const spanSums = rows.map((row) => row.reduce((sum, c) => sum + (c.colSpan ?? 1), 0))
  let widestSpan = 0
  for (const sum of spanSums) {
    if (sum > widestSpan) widestSpan = sum
  }
  const colCount = gridCols?.length ?? widestSpan
  if (spanSums.every((sum) => sum === colCount)) return undefined
  const rowBounds: number[][] = []
  for (let r = 0; r < rows.length; r++) {
    const bounds: number[] = []
    let x = 0
    let pos = 0
    for (let c = 0; c < rows[r].length; c++) {
      const span = rows[r][c].colSpan ?? 1
      let w = rowTcws[r][c]
      if (!(w !== undefined && w > 0)) {
        w = gridCols?.slice(pos, pos + span).reduce((sum, v) => sum + v, 0)
      }
      if (!(w !== undefined && w > 0)) return undefined
      x += w
      bounds.push(x)
      pos += span
    }
    rowBounds.push(bounds)
  }
  const sorted = rowBounds.flat().sort((a, b) => a - b)
  const reps: number[] = []
  for (const b of sorted) {
    if (reps.length === 0 || b - reps[reps.length - 1] > GRID_SNAP_TOL) reps.push(b)
  }
  // Word caps table grids at 63 columns; a wider union means garbage input
  if (reps.length === 0 || reps.length > 96) return undefined
  const repIndex = (b: number) => {
    let lo = 0
    let hi = reps.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (reps[mid] <= b) lo = mid
      else hi = mid - 1
    }
    return reps[lo] <= b && b - reps[lo] <= GRID_SNAP_TOL ? lo : -1
  }
  const newSpans: number[][] = []
  for (const bounds of rowBounds) {
    const spans: number[] = []
    let prev = -1
    for (const b of bounds) {
      const idx = repIndex(b)
      if (idx <= prev) return undefined
      spans.push(idx - prev)
      prev = idx
    }
    newSpans.push(spans)
  }
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (newSpans[r][c] > 1) cell.colSpan = newSpans[r][c]
      else delete cell.colSpan
    }),
  )
  return reps.map((v, i) => v - (i > 0 ? reps[i - 1] : 0))
}

/** Real documents rarely nest past 3-4 levels; below the cap the subtree flattens so stress files (POI nests 5000) cannot blank the page. */
const MAX_TABLE_NEST_DEPTH = 8

/** Whole subtree → 1×1 sub-table of plain paragraph texts (iterative: the subtree can be thousands of levels deep). */
function flattenedTableModel(tbl: XNode): TableModel | undefined {
  const paras: string[] = []
  const PARA_END: XNode = {}
  let buf: string | null = null
  const stack: XNode[] = [tbl]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === PARA_END) {
      paras.push(buf ?? '')
      buf = null
      continue
    }
    if ('#text' in node) {
      if (buf !== null) buf += String(node['#text'])
      continue
    }
    if (buf === null && nameOf(node) === 'w:p') {
      buf = ''
      stack.push(PARA_END)
    }
    const kids = childrenOf(node)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  if (paras.length === 0) return undefined
  const cell: TableCell = {
    paras,
    richParas: paras.map((text) => ({ runs: text === '' ? [] : [{ text }] })),
  }
  // autofit: without it the synthetic table collapses to a sliver and wraps every word
  return { rows: [[cell]], autoLayout: true }
}

/**
 * Widths Word shrinks an over-wide autofit table to: the text column, one
 * newspaper column in a multi-column section, each less the signed table indent
 * (a negative indent widens the box to the left, the right edge stays on the
 * margin); compat < 15 measures the indent to the cell text, so the border box hangs by
 * the side cell margins (probe 2026-09-17: compat 14 tblInd 558 in an 8550
 * column -> 8208 = 8550 - 558 + 216; compat 15 -> 7992).
 */
function usableTableWidths(sect: SectionSettings, tblIndTwips: number, hangTwips = 0): number[] {
  const text = sect.pageWidth - sect.marginLeft - sect.marginRight
  const perColumn =
    sect.columns > 1
      ? sect.colWidths?.length === sect.columns
        ? sect.colWidths
        : [(text - (sect.colSpace ?? 720) * (sect.columns - 1)) / sect.columns]
      : []
  const indent = Number.isFinite(tblIndTwips) ? tblIndTwips : 0
  const bases = [text, ...perColumn]
  const spans = [...bases, ...bases.map((w) => w - indent)]
  if (hangTwips > 0) spans.push(...spans.map((w) => w + hangTwips))
  return [...new Set(spans)].filter((w) => w > 0)
}

const DEFAULT_TABLE_CELL_MAR = 108

/** every gridCol within 1% of the mean: a generator placeholder, not a laid-out grid */
function isUniformGrid(widths: number[] | undefined): boolean {
  if (!widths) return true
  const total = widths.reduce((a, b) => a + b, 0)
  return widths.every((w) => Math.abs(w * widths.length - total) <= Math.max(2, total * 0.01))
}

function extractTableModel(
  tbl: XNode,
  ctx: BuildContext,
  depth = 1,
  docOffset?: number,
): TableModel | undefined {
  const grid = findChild(tbl, 'w:tblGrid')
  let colWidthsPct: number[] | undefined
  let colWidthsTwips: number[] | undefined
  let gridWidthsRaw: number[] | undefined
  if (grid) {
    const widths = findChildren(grid, 'w:gridCol').map((c) => Number(attrsOf(c)['w:w']) || 0)
    const total = widths.reduce((a, b) => a + b, 0)
    if (total > 0) {
      gridWidthsRaw = widths
      colWidthsPct = widths.map((w) => (w / total) * 100)
      if (widths.every((w) => w > 0)) colWidthsTwips = widths
    }
  }
  const tblPrNode = findChild(tbl, 'w:tblPr')
  const fixedLayout = attrsOf(findChild(tblPrNode ?? {}, 'w:tblLayout') ?? {})['w:type'] === 'fixed'
  const tblWNode = findChild(tblPrNode ?? {}, 'w:tblW')
  const tblW = attrsOf(tblWNode ?? {})
  const tblInd = attrsOf(findChild(tblPrNode ?? {}, 'w:tblInd') ?? {})
  const tblIndTwips = !tblInd['w:type'] || tblInd['w:type'] === 'dxa' ? Number(tblInd['w:w']) : NaN
  const cellMar = cellMarginsOf(findChild(tblPrNode ?? {}, 'w:tblCellMar'))
  // Borders/margins from the table style (styles.xml, basedOn chain included): fallback
  // when the document level declares none
  const styleIdEarly = attrsOf(findChild(tblPrNode ?? {}, 'w:tblStyle') ?? {})['w:val']
  const styleTable = styleIdEarly ? ctx.styles.get(styleIdEarly)?.tableDisplay : undefined
  const effCellMar = cellMar ?? styleTable?.cellMarTwips
  const legacyHang =
    (ctx.compatibilityMode ?? 0) < 15
      ? (effCellMar?.left ?? DEFAULT_TABLE_CELL_MAR) + (effCellMar?.right ?? DEFAULT_TABLE_CELL_MAR)
      : 0
  const spacingOf = (node: XNode | undefined) => {
    const a = attrsOf(findChild(node ?? {}, 'w:tblCellSpacing') ?? {})
    const w = !a['w:type'] || a['w:type'] === 'dxa' ? Number(a['w:w']) : NaN
    return w > 0 ? w : undefined
  }
  const firstTr = childrenThroughSdt(tbl, 'w:tr')[0]
  const tblSpacing =
    spacingOf(tblPrNode) ?? (firstTr ? spacingOf(findChild(firstTr, 'w:trPr')) : undefined)
  const uniformGrid = isUniformGrid(colWidthsTwips)
  // Cell-level w:tcW is Word's actual layout input for auto tables; generators often
  // leave a stale evenly-split tblGrid behind. When the two disagree, tcW wins.
  const tcwWidths = tcwColumnWidths(tbl)
  let tcwWins = false
  if (tcwWidths) {
    const tcwTotal = tcwWidths.reduce((a, b) => a + b, 0)
    const tcwPct = tcwWidths.map((w) => (w / tcwTotal) * 100)
    // Fixed layout sizes columns from tcW alone, so a matching ratio with a
    // different absolute sum still means the grid is stale. So does a table with
    // no declared width (tblW auto): Word sizes it from the cells' preferred widths,
    // unless those overflow the text column - then Word shrinks the table to the
    // column and the saved grid already is that shrunk layout, so a grid spanning
    // the column stays (a narrower same-ratio grid is still a stale placeholder).
    const gridTotal = (colWidthsTwips ?? []).reduce((a, b) => a + b, 0)
    // an autofit grid with unequal columns is Word's finished layout (Word
    // draws it on open even when tcW disagree); only an evenly split
    // placeholder grid yields to tcW
    const tblWAuto =
      tblW['w:type'] === 'auto' ||
      ((!tblW['w:type'] || tblW['w:type'] === 'dxa') && !(Number(tblW['w:w']) > 0))
    const sect = docOffset !== undefined ? ctx.sectionAt?.(docOffset) : undefined
    const gridIsShrunkLayout = (sect ? usableTableWidths(sect, tblIndTwips, legacyHang) : []).some(
      (usable) =>
        tcwTotal > usable + tcwWidths.length && Math.abs(gridTotal - usable) <= usable * 0.03,
    )
    // with w:tblCellSpacing the grid also holds the gaps that w:tcW leaves out
    // (Word saves 2s per column plus s on the outer two, other generators 3s
    // each); Word draws that wider grid, so it is not a stale one
    const gridExcess = gridTotal - tcwTotal
    const spacingRoom = tblSpacing ? 3 * tblSpacing * tcwWidths.length : 0
    const disagree =
      !colWidthsPct ||
      colWidthsPct.length !== tcwPct.length ||
      ((fixedLayout || uniformGrid) && colWidthsPct.some((w, i) => Math.abs(w - tcwPct[i]) > 2)) ||
      ((fixedLayout || (tblWAuto && !gridIsShrunkLayout)) &&
        (gridExcess < -tcwWidths.length || gridExcess > tcwWidths.length + spacingRoom))
    if (disagree) {
      colWidthsPct = tcwPct
      colWidthsTwips = tcwWidths
      tcwWins = true
    }
  }
  let widthPct: number | undefined
  if (tblW['w:type'] === 'pct') {
    const raw = String(tblW['w:w'] ?? '')
    // The pct unit is 1/50 of a percentage point; some generators write a literal "NN%"
    const pct = raw.endsWith('%') ? parseFloat(raw) : Number(raw) / 50
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) widthPct = pct
  }
  // Placeholder grids (generators emit 100-twip gridCols without computing a
  // layout) collapse the table to a strip. Word lays autofit tables out from
  // tblW/tcW, so a grid summing below the declared dxa width stretches to it.
  if (!fixedLayout && colWidthsTwips) {
    const tblWDxa = !tblW['w:type'] || tblW['w:type'] === 'dxa' ? Number(tblW['w:w']) : NaN
    const gridTotal = colWidthsTwips.reduce((a, b) => a + b, 0)
    if (tblWDxa > 0 && gridTotal > 0 && gridTotal < tblWDxa - colWidthsTwips.length) {
      const scale = tblWDxa / gridTotal
      colWidthsTwips = colWidthsTwips.map((w) => Math.round(w * scale))
    }
  }
  const tblBorders = mergedBorderLinesOf(tblPrNode, 'w:tblBorders', true)
  const tblJc = attrsOf(findChild(tblPrNode ?? {}, 'w:jc') ?? {})['w:val']
  const tblAlign =
    tblJc === 'center' ? 'center' : tblJc === 'right' || tblJc === 'end' ? 'right' : undefined
  const tblpPr = attrsOf(findChild(tblPrNode ?? {}, 'w:tblpPr') ?? {})
  let floatSide: TableModel['floatSide']
  let floatPos: TableModel['floatPos']
  if (Object.keys(tblpPr).length > 0) {
    const xSpec = tblpPr['w:tblpXSpec']
    // no alignment keyword: an absolute X past mid-body (~9360 twips of usable
    // width on Letter/A4) means the table hugs the right side
    floatSide =
      xSpec === 'right' || xSpec === 'outside' || (!xSpec && Number(tblpPr['w:tblpX']) > 4680)
        ? 'right'
        : 'left'
    const x = Number(tblpPr['w:tblpX'])
    const y = Number(tblpPr['w:tblpY'])
    const distanceTwips: CellMargins = {}
    const distanceAttrs = {
      top: 'w:topFromText',
      right: 'w:rightFromText',
      bottom: 'w:bottomFromText',
      left: 'w:leftFromText',
    } as const
    for (const [side, attr] of Object.entries(distanceAttrs) as Array<
      [keyof CellMargins, (typeof distanceAttrs)[keyof typeof distanceAttrs]]
    >) {
      const value = Number(tblpPr[attr])
      if (Number.isFinite(value) && value >= 0) distanceTwips[side] = value
    }
    const horzAnchor = tblpPr['w:horzAnchor']
    const ySpec = tblpPr['w:tblpYSpec']
    const xSpecOk =
      xSpec === 'left' ||
      xSpec === 'center' ||
      xSpec === 'right' ||
      xSpec === 'inside' ||
      xSpec === 'outside'
    const ySpecOk =
      ySpec === 'top' ||
      ySpec === 'center' ||
      ySpec === 'bottom' ||
      ySpec === 'inside' ||
      ySpec === 'outside'
    // a keyword Y with no vertAnchor aligns to the margin box in Word (cover
    // page gallery tables sit at the bottom margin); a numeric Y stays text-relative
    const vertAnchor = tblpPr['w:vertAnchor'] ?? (ySpecOk ? 'margin' : undefined)
    floatPos = {
      xTwips: Number.isFinite(x) ? x : floatSide === 'right' ? 9360 : 0,
      yTwips: Number.isFinite(y) ? y : 0,
      ...(horzAnchor === 'page' || horzAnchor === 'margin' || horzAnchor === 'text'
        ? { horzAnchor }
        : {}),
      ...(vertAnchor === 'page' || vertAnchor === 'margin' || vertAnchor === 'text'
        ? { vertAnchor }
        : {}),
      ...(xSpecOk ? { xSpec } : {}),
      ...(ySpecOk ? { ySpec } : {}),
      ...(Object.keys(distanceTwips).length > 0 ? { distanceTwips } : {}),
    }
  }

  let cellSpacing = tblSpacing
  const tblFill = shdDisplayFill(findChild(tblPrNode ?? {}, 'w:shd'))

  const rows: TableCell[][] = []
  // per-cell w:tcW (dxa twips), aligned with rows: grid-repair input
  const rowTcws: Array<Array<number | undefined>> = []
  const rowEdges: Array<ReturnType<typeof rowGridEdges>> = []
  const rowHeightsTwips: Array<number | null> = []
  const rowHeightRules: NonNullable<TableModel['rowHeightRules']> = []
  const repeatHeaderRows: boolean[] = []
  const rowCantSplit: boolean[] = []
  const rowRevisions: NonNullable<TableModel['rowRevisions']> = []
  for (const tr of childrenThroughSdt(tbl, 'w:tr')) {
    const cells: TableCell[] = []
    const tcws: Array<number | undefined> = []
    for (const tc of childrenThroughSdt(tr, 'w:tc')) {
      const cell = extractCell(tc, ctx, depth, docOffset)
      const a = attrsOf(findChildren(findChild(tc, 'w:tcPr') ?? {}, 'w:tcW').at(-1) ?? {})
      const rawW = !a['w:type'] || a['w:type'] === 'dxa' ? Number(a['w:w']) : NaN
      const tcw = rawW > 0 ? rawW : undefined
      const prev = cells[cells.length - 1]
      // Legacy horizontal merge: continue cells fold into the cell to their left (same effect
      // as gridSpan)
      if (cell.hMerge === 'continue' && prev) {
        prev.colSpan = (prev.colSpan ?? 1) + (cell.colSpan ?? 1)
        const prevW = tcws[tcws.length - 1]
        tcws[tcws.length - 1] = prevW !== undefined && tcw !== undefined ? prevW + tcw : undefined
        continue
      }
      cells.push(cell)
      tcws.push(tcw)
    }
    if (cells.length > 0) {
      rows.push(cells)
      rowTcws.push(tcws)
      rowEdges.push(rowGridEdges(tr))
      const trPr = findChild(tr, 'w:trPr')
      cellSpacing = cellSpacing ?? spacingOf(trPr)
      const trH = trPr ? attrsOf(findChild(trPr, 'w:trHeight') ?? {}) : {}
      const h = Number(trH['w:val'])
      const hasH = Number.isFinite(h) && h > 0
      // Word clamps trHeight to 31680 twips / 22in (MS-OI29500 2.1.51); some generators leak EMU-scale values here
      rowHeightsTwips.push(hasH ? Math.min(h, 31680) : null)
      rowHeightRules.push(hasH ? (trH['w:hRule'] === 'exact' ? 'exact' : 'atLeast') : null)
      repeatHeaderRows.push(trPr ? boolProp(trPr, 'w:tblHeader') : false)
      rowCantSplit.push(trPr ? boolProp(trPr, 'w:cantSplit') : false)
      rowRevisions.push(trPr ? rowRevisionOf(trPr) : null)
    }
  }
  if (rows.length === 0) return undefined
  applyTableStyleDisplay(rows, findChild(tbl, 'w:tblPr'), ctx)
  // w:gridBefore/w:gridAfter offset rows within the grid: placeholder cells keep
  // the offset visible (inserted after style banding so real cells keep their look)
  if (rowEdges.some((e) => e.before > 0 || e.after > 0)) {
    rows.forEach((cells, i) => {
      const e = rowEdges[i]
      if (e.before > 0) {
        cells.unshift({ paras: [], gridGap: true, ...(e.before > 1 ? { colSpan: e.before } : {}) })
        rowTcws[i].unshift(e.wBefore)
      }
      if (e.after > 0) {
        cells.push({ paras: [], gridGap: true, ...(e.after > 1 ? { colSpan: e.after } : {}) })
        rowTcws[i].push(e.wAfter)
      }
    })
  }
  const reconciled = reconcileGridColumns(rows, rowTcws, gridWidthsRaw)
  if (reconciled) {
    colWidthsTwips = reconciled
    const total = reconciled.reduce((a, b) => a + b, 0)
    colWidthsPct = reconciled.map((w) => (w / total) * 100)
  }
  const effBorders = tblBorders ?? styleTable?.borders
  const model: TableModel = { rows, colWidthsPct }
  if (colWidthsTwips) model.colWidthsTwips = colWidthsTwips
  if (widthPct) model.widthPct = widthPct
  const tblWType = tblW['w:type']
  const autoWidth =
    !tblWNode ||
    tblWType === 'auto' ||
    ((!tblWType || tblWType === 'dxa') && !(Number(tblW['w:w']) > 0))
  // pct widths still lay out with the autofit algorithm (only w:tblLayout
  // fixed switches it off), so their columns keep the min-content floor
  if (!fixedLayout && (autoWidth || widthPct)) model.autoLayout = true
  // Word lays an autofit table (tblW auto or dxa) out from tcW/content and saves
  // the result as the grid, so an unequal grid it kept is Word's own measure of
  // every word (probe: a dxa table drawn at its saved grid, not its tcW)
  if (!fixedLayout && !widthPct && colWidthsTwips && !tcwWins && !uniformGrid)
    model.layoutGrid = true
  model.autoFit =
    fixedLayout || (!autoWidth && !widthPct) ? 'fixed' : widthPct === 100 ? 'window' : 'contents'
  if (fixedLayout) model.fixedLayout = true
  else if ((!tblWType || tblWType === 'dxa') && Number(tblW['w:w']) > 0 && !widthPct)
    model.dxaWidth = true
  if (effCellMar) model.cellMarTwips = effCellMar
  if (cellSpacing) model.cellSpacingTwips = cellSpacing
  if (tblFill) model.fill = tblFill
  if (effBorders) model.borders = effBorders
  if (tblAlign) model.align = tblAlign
  if (floatSide) model.floatSide = floatSide
  if (floatPos) model.floatPos = floatPos
  if (Number.isFinite(tblIndTwips) && tblIndTwips !== 0) model.indentTwips = tblIndTwips
  const tblStyle = attrsOf(findChild(findChild(tbl, 'w:tblPr') ?? {}, 'w:tblStyle') ?? {})['w:val']
  if (tblStyle) model.tblStyleId = tblStyle
  model.tableLook = tableLookOf(tblPrNode)
  if (tblPrNode && boolProp(tblPrNode, 'w:bidiVisual')) model.bidiVisual = true
  if (rowHeightsTwips.some((h) => h !== null)) {
    model.rowHeightsTwips = rowHeightsTwips
    model.rowHeightRules = rowHeightRules
  }
  model.repeatHeaderRows = repeatHeaderRows
  if (rowCantSplit.some(Boolean)) model.rowCantSplit = rowCantSplit
  if (rowRevisions.some((r) => r !== null)) model.rowRevisions = rowRevisions
  const caption = attrsOf(findChild(tblPrNode ?? {}, 'w:tblCaption') ?? {})['w:val']
  if (caption) model.caption = caption
  const description = attrsOf(findChild(tblPrNode ?? {}, 'w:tblDescription') ?? {})['w:val']
  if (description) model.description = description
  return model
}

/** trPr w:ins / w:del → row-level revision (inserted/deleted row) */
function rowRevisionOf(trPr: XNode): ({ kind: 'ins' | 'del' } & RevisionInfo) | null {
  for (const kind of ['ins', 'del'] as const) {
    const node = findChild(trPr, `w:${kind}`)
    if (!node) continue
    const a = attrsOf(node)
    return {
      kind,
      author: a['w:author'] ?? '',
      ...(a['w:date'] ? { date: a['w:date'] } : {}),
      ...(a['w:id'] ? { id: a['w:id'] } : {}),
    }
  }
  return null
}

/**
 * Attach each cell's rawTcPr and each row's rawTrPr from the original table XML (byte
 * fidelity: surgically patched on regeneration so unmodeled tcMar/textDirection/
 * tblHeader etc. are not lost). Uses depth-aware splitXmlChildren so nested tables do
 * not misalign; gives up when row/column counts disagree with the parse result
 * (conservative — never attach to the wrong cell).
 */
function attachRawTablePr(xml: string, rows: TableCell[][], rawTrPrs: Array<string | null>): void {
  const open = /<w:tbl[\s>]/.exec(xml)
  if (!open) return
  const innerStart = xml.indexOf('>', open.index) + 1
  const innerEnd = xml.lastIndexOf('</w:tbl>')
  if (innerStart <= 0 || innerEnd < 0) return
  const trs = splitXmlChildren(xml.slice(innerStart, innerEnd)).filter((c) => c.name === 'w:tr')
  if (trs.length !== rows.length) return
  trs.forEach((tr, ri) => {
    const trOpenEnd = tr.xml.indexOf('>') + 1
    const trInner = tr.xml.slice(trOpenEnd, tr.xml.lastIndexOf('</w:tr>'))
    const kids = splitXmlChildren(trInner)
    const trPr = kids.find((k) => k.name === 'w:trPr')
    if (trPr) rawTrPrs[ri] = trPr.xml
    const tcs = kids.filter((k) => k.name === 'w:tc')
    // gridGap placeholders have no w:tc in the source: align against real cells only
    const targets = rows[ri].filter((cell) => !cell.gridGap)
    if (tcs.length !== targets.length) return
    tcs.forEach((tc, ci) => {
      const tcOpenEnd = tc.xml.indexOf('>') + 1
      const tcInner = tc.xml.slice(tcOpenEnd, tc.xml.lastIndexOf('</w:tc>'))
      const tcPr = splitXmlChildren(tcInner).find((k) => k.name === 'w:tcPr')
      if (tcPr) targets[ci].rawTcPr = tcPr.xml
    })
  })
}

/**
 * Layer the referenced table style's fills / first-row formatting under the
 * cells' explicit properties, honoring the w:tblLook flags. Display-only:
 * untouched tables still save byte-identically.
 */
function applyTableStyleDisplay(
  rows: TableCell[][],
  tblPr: XNode | undefined,
  ctx: BuildContext,
): void {
  if (!tblPr) return
  const styleId = attrsOf(findChild(tblPr, 'w:tblStyle') ?? {})['w:val']
  const ts = styleId ? ctx.styles.get(styleId)?.tableDisplay : undefined
  if (!ts) return

  const look = attrsOf(findChild(tblPr, 'w:tblLook') ?? {})
  const bits = parseInt(look['w:val'] ?? '', 16)
  const flag = (attr: string, bit: number, dflt: boolean): boolean =>
    look[attr] !== undefined
      ? look[attr] !== '0' && look[attr] !== 'false'
      : Number.isFinite(bits)
        ? (bits & bit) !== 0
        : dflt
  const firstRowOn = flag('w:firstRow', 0x20, true)
  const lastRowOn = flag('w:lastRow', 0x40, false)
  const firstColOn = flag('w:firstColumn', 0x80, true)
  const lastColOn = flag('w:lastColumn', 0x100, false)
  const hBandOn = !flag('w:noHBand', 0x200, false)
  const bandSize = rowBandSizeOf(tblPr) ?? ts.rowBandSize ?? 1

  const totalCols = Math.max(
    ...rows.map((row) => row.reduce((sum, c) => sum + (c.colSpan ?? 1), 0)),
  )
  rows.forEach((row, r) => {
    const isFirst = firstRowOn && r === 0
    const isLast = lastRowOn && r === rows.length - 1
    const bandRow = firstRowOn ? r - 1 : r
    const bandFill =
      hBandOn && bandRow >= 0
        ? Math.floor(bandRow / bandSize) % 2 === 0
          ? ts.band1Fill
          : ts.band2Fill
        : undefined
    let col = 0
    for (const cell of row) {
      const span = cell.colSpan ?? 1
      // Word's conditional-format precedence: rows beat columns, all beat bands/whole-table
      const conds = [
        isFirst ? ts.firstRow : undefined,
        isLast ? ts.lastRow : undefined,
        firstColOn && col === 0 ? ts.firstCol : undefined,
        lastColOn && col + span === totalCols ? ts.lastCol : undefined,
      ]
      col += span
      if (cell.fill === undefined) {
        cell.fill = conds.find((c) => c?.fill)?.fill ?? bandFill ?? ts.fill ?? undefined
      }
      const bold = conds.some((c) => c?.bold) || ts.wholeTable?.bold
      if (bold) {
        cell.styleBold = true
        if (cell.bold === undefined) cell.bold = true
      }
      const color = conds.find((c) => c?.color)?.color ?? ts.wholeTable?.color
      if (color) {
        cell.styleColor = color
        if (!cell.color) cell.color = color
      }
    }
  })
}

function extractCell(tc: XNode, ctx: BuildContext, depth: number, docOffset?: number): TableCell {
  const cell: TableCell = { paras: [] }
  const richParas: NonNullable<TableCell['richParas']> = []

  const tcPr = findChild(tc, 'w:tcPr')
  if (tcPr) {
    const span = Number(attrsOf(findChild(tcPr, 'w:gridSpan') ?? {})['w:val'])
    if (span > 1) cell.colSpan = span
    const vMerge = findChild(tcPr, 'w:vMerge')
    if (vMerge) {
      cell.vMerge = attrsOf(vMerge)['w:val'] === 'restart' ? 'restart' : 'continue'
    }
    const fill = shdDisplayFill(findChild(tcPr, 'w:shd'))
    if (fill) cell.fill = fill
    const vAlign = attrsOf(findChild(tcPr, 'w:vAlign') ?? {})['w:val']
    if (vAlign === 'center' || vAlign === 'bottom' || vAlign === 'top') cell.vAlign = vAlign
    const tcMar = cellMarginsOf(findChild(tcPr, 'w:tcMar'))
    if (tcMar) cell.cellMarTwips = tcMar
    const dir = attrsOf(findChild(tcPr, 'w:textDirection') ?? {})['w:val']
    if (dir === 'tbRl' || dir === 'tbRlV') cell.textDirection = 'tbRl'
    else if (dir === 'btLr' || dir === 'btLrV') cell.textDirection = 'btLr'
    if (boolProp(tcPr, 'w:noWrap')) cell.noWrap = true
    const hMerge = findChild(tcPr, 'w:hMerge')
    if (hMerge) cell.hMerge = attrsOf(hMerge)['w:val'] === 'restart' ? 'restart' : 'continue'
    const borders = mergedBorderLinesOf(tcPr, 'w:tcBorders', false)
    if (borders) cell.borders = borders
    for (const kind of ['ins', 'del'] as const) {
      const node = findChild(tcPr, kind === 'ins' ? 'w:cellIns' : 'w:cellDel')
      if (!node) continue
      const a = attrsOf(node)
      cell.cellRevision = {
        kind,
        author: a['w:author'] ?? '',
        ...(a['w:date'] ? { date: a['w:date'] } : {}),
        ...(a['w:id'] ? { id: a['w:id'] } : {}),
      }
      break
    }
  }

  // Tables nested in a cell: parsed as read-only sub-tables (byte fidelity is the
  // outer table's responsibility); anchors record their position among the paragraphs
  const nested: TableModel[] = []
  const nestedAnchors: number[] = []
  let sawBold = false
  let sawNonBold = false
  const runColors = new Set<string>()
  const textParaJcs = new Set<string>()
  for (const block of childrenThroughSdt(tc, ['w:p', 'w:tbl'])) {
    if (nameOf(block) === 'w:tbl') {
      const model =
        depth >= MAX_TABLE_NEST_DEPTH
          ? flattenedTableModel(block)
          : extractTableModel(block, ctx, depth + 1, docOffset)
      if (model) {
        nested.push(model)
        nestedAnchors.push(cell.paras.length)
      }
      continue
    }
    let p = block
    // anchored shapes/textboxes in cell paragraphs (blip images already ride the
    // runs): Word renders them inside the cell and grows the row to hold them
    // (tdf134277). Their w:txbxContent is stripped from the paragraph so the box
    // text does not additionally render as plain cell text.
    if (hasDeepChild(p, ANCHOR_HOSTS)) {
      // Word pairs every DrawingML shape with a VML twin in mc:Fallback: strip the
      // fallback like buildBlock's detect, or each shape extracts twice
      const rawPXml = serializeXNode(p)
      const pXml = rawPXml.includes('<mc:Fallback')
        ? rawPXml.replace(/<mc:Fallback[^>]*>[\s\S]*?<\/mc:Fallback>/g, '')
        : rawPXml
      if (pXml.includes('<wp:anchor') || /<w:pict[\s>]/.test(pXml)) {
        // two or more pictures anchored in one cell paragraph sit at their own
        // offsets (side by side in Word); as run images they would float one
        // below the other and grow the row
        const pictures =
          topLevelDrawings(pXml).filter((f) => f.includes('<wp:anchor') && f.includes('<pic:pic'))
            .length >= 2
        const boxes = extractTextboxes(pXml, ctx, { shapes: true, pictures, docOffset })
        if (boxes.length > 0) {
          cell.anchoredBoxes = [...(cell.anchoredBoxes ?? []), ...boxes]
          // positionV relativeFrom="paragraph" measures from the anchor
          // paragraph, not the cell top: remember which paragraph hosts each box
          cell.anchoredBoxAnchors = [
            ...(cell.anchoredBoxAnchors ?? []),
            ...boxes.map(() => cell.paras.length),
          ]
          // the boxes now display separately: drop the anchored drawings (and
          // textbox picts) from the paragraph node so their inner text/offsets
          // don't leak into the cell's own runs; inline drawings stay for images
          try {
            let txml = pXml
            for (const frag of topLevelDrawings(txml)) {
              // a lone anchored picture is no shape box: it stays on the run-image path
              if (frag.includes('<wp:anchor') && (pictures || !frag.includes('<pic:pic'))) {
                txml = txml.split(frag).join('')
              }
            }
            txml = txml.replace(
              /<w:pict>(?:(?!<\/w:pict>)[\s\S])*?<w:txbxContent>[\s\S]*?<\/w:pict>/g,
              '',
            )
            const stripped = (xmlParser.parse(txml) as XNode[])[0]
            if (stripped && nameOf(stripped) === 'w:p') p = stripped
          } catch {
            /* keep the original paragraph node */
          }
        }
      }
    }
    const paraText = textOf(p)
    cell.paras.push(paraText)
    const pPr = findChild(p, 'w:pPr')
    const cellStyleId = pPr ? attrsOf(findChild(pPr, 'w:pStyle') ?? {})['w:val'] : undefined
    const cellRef = listRefOf(ctx, pPr, cellStyleId)
    const list = cellRef
      ? {
          kind: listKindOf(ctx, cellRef.numId, cellRef.ilvl),
          numId: cellRef.numId,
          ilvl: cellRef.ilvl,
        }
      : undefined
    const runs = extractRuns(p, ctx, [], [], true)
    const format = inheritStyleBreakFlags(
      withCharIndents(
        extractParaFormat(pPr ?? {}, ctx.themeColors),
        ctx,
        p,
        pPr,
        cellStyleId,
        runs,
        {
          list: !!list,
          docOffset,
        },
      ),
      cellStyleId ? ctx.styles.get(cellStyleId) : ctx.defaultParaStyle,
    )
    const spaceOnly = runs.length > 0 && spaceOnlyRuns(runs) && !hasLayoutRunContent(p)
    const markSized = runs.length === 0 || spaceOnly
    const emptySz = markSized ? emptyParaSizeHalfPoints(p, pPr, spaceOnly) : undefined
    const emptyFont = markSized ? emptyParaMarkFont(p, pPr, ctx.themeFonts, spaceOnly) : undefined
    const markSz = cellRef ? emptyParaSizeHalfPoints(p, pPr, true) : undefined
    richParas.push({
      ...format,
      ...(cellStyleId ? { styleId: cellStyleId } : {}),
      ...(emptySz ? { emptyRunSizeHalfPoints: emptySz } : {}),
      ...(emptyFont ? { emptyRunFontFamily: emptyFont } : {}),
      ...(markSz ? { markSizeHalfPoints: markSz } : {}),
      ...(list ? { list } : {}),
      runs,
    })
    if (paraText !== '') textParaJcs.add(attrsOf(findChild(pPr ?? {}, 'w:jc') ?? {})['w:val'] ?? '')
    for (const r of findChildren(p, 'w:r')) {
      const rPr = findChild(r, 'w:rPr')
      if (rPr && boolProp(rPr, 'w:b')) sawBold = true
      else sawNonBold = true
      if (textOf(r) !== '') runColors.add((rPr && colorFrom(rPr, ctx.themeColors)) ?? 'none')
    }
  }
  // cell.align only when every text paragraph declares the same jc; a first-wins
  // td-level text-align would leak onto the cell's jc-less paragraphs
  if (textParaJcs.size === 1) {
    const jc = textParaJcs.values().next().value
    if (jc === 'center' || jc === 'right' || jc === 'left' || jc === 'justify') cell.align = jc
  }
  cell.richParas = richParas
  if (nested.length > 0) {
    cell.nestedTables = nested
    cell.nestedTableAnchors = nestedAnchors.map((a) => Math.min(a, cell.paras.length))
  }
  if (sawBold && !sawNonBold) cell.bold = true
  // cell.color only when every text run agrees (mixed colors stay run-level)
  if (runColors.size === 1) {
    const only = runColors.values().next().value as string
    if (only !== 'none') cell.color = only
  }
  return cell
}
