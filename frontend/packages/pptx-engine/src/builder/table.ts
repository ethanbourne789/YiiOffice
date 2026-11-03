import { textToBytes } from '../browser-compat'
import { hasContentTypeOverride, maxRelationshipIdNumber } from '../xml-utils'
import { buildTableXml, type NewTableOptions } from '../insert'
import { generateParagraphXml } from '../generate'
import {
  patchTableStyleXml,
  ensureTableStyleXml,
  type TableStyleEdit,
} from '../table-edit'
import { patchedElementXml } from './patch'
import { appendRawElements, materializeSlide } from './slide-ops'
import { type OpenedPptx } from '../package'
import type { Slide, TableElement, Paragraph } from '../types'

/** Insert a table: build a graphicFrame slice, append, and reparse. */
export function addTable(
  opened: OpenedPptx,
  slideIndex: number,
  opts: NewTableOptions,
): { slide: Slide; elementId: string } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  const r = appendRawElements(opened, slideIndex, [buildTableXml(slide, opts)])
  return r ? { slide: r.slide, elementId: r.elementIds[r.elementIds.length - 1]! } : null
}

// ── Table cell text editing ─────────────────────────────────────────────

/**
 * All <a:gridCol> spans in document order. gridCol comes in both forms —
 * self-closing, and paired when it carries children (Google Slides exports
 * attach an <a:extLst> a16:colId to every column) — so a self-closing-only
 * regex undercounts columns or, worse, indexes the wrong one on mixed tables.
 */
function gridColSpans(xml: string): Array<{ start: number; end: number; open: string }> {
  const spans: Array<{ start: number; end: number; open: string }> = []
  const re = /<a:gridCol\b[^>]*?(\/)?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) {
      spans.push({ start: m.index, end: m.index + m[0].length, open: m[0] })
    } else {
      const close = xml.indexOf('</a:gridCol>', re.lastIndex)
      if (close < 0) break
      const end = close + '</a:gridCol>'.length
      spans.push({ start: m.index, end, open: m[0] })
      re.lastIndex = end
    }
  }
  return spans
}

/** Locate the nth <tag>…</tag> span in the xml (a:tr/a:tc never self-nest, so a sequential scan suffices). */
function nthTagSpan(xml: string, tag: string, n: number): { start: number; end: number } | null {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g')
  let m: RegExpExecArray | null
  let i = 0
  while ((m = openRe.exec(xml)) !== null) {
    const close = xml.indexOf(`</${tag}>`, openRe.lastIndex)
    if (close < 0) return null
    const end = close + `</${tag}>`.length
    if (i === n) return { start: m.index, end }
    i++
    openRe.lastIndex = end
  }
  return null
}

/**
 * Rewrite table cell text: XML surgery (replacing the txBody paragraphs of the
 * col-th a:tc inside the row-th a:tr, keeping bodyPr/lstStyle/tcPr) with the model
 * synced. col is the tc index (not the logical column).
 */
export function editTableCellText(
  slide: Slide,
  elementId: string,
  row: number,
  col: number,
  paragraphs: Paragraph[],
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  const table = el as TableElement
  const cell = table.rows[row]?.[col]
  if (!cell || cell.merged) return false

  const xml = el.anchor.originalXml
  const tr = nthTagSpan(xml, 'a:tr', row)
  if (!tr) return false
  const trXml = xml.slice(tr.start, tr.end)
  const tc = nthTagSpan(trXml, 'a:tc', col)
  if (!tc) return false
  const tcXml = trXml.slice(tc.start, tc.end)

  const txOpen = /<a:txBody(\s[^>]*)?>/.exec(tcXml)
  const txEnd = tcXml.lastIndexOf('</a:txBody>')
  if (!txOpen || txEnd < 0) return false
  const inner = tcXml.slice(txOpen.index + txOpen[0].length, txEnd)
  const bodyPr =
    /<a:bodyPr\b(?:[^>]*?)(?:\/>|>[\s\S]*?<\/a:bodyPr>)/.exec(inner)?.[0] ?? '<a:bodyPr/>'
  const lstStyle = /<a:lstStyle\b(?:[^>]*?)(?:\/>|>[\s\S]*?<\/a:lstStyle>)/.exec(inner)?.[0] ?? ''
  const paras = (paragraphs.length ? paragraphs : [{ runs: [{ text: '' }] }])
    .map((p) => generateParagraphXml(p))
    .join('')

  const newTc =
    tcXml.slice(0, txOpen.index + txOpen[0].length) + bodyPr + lstStyle + paras + tcXml.slice(txEnd)
  const newTr = trXml.slice(0, tc.start) + newTc + trXml.slice(tc.end)
  el.anchor.originalXml = xml.slice(0, tr.start) + newTr + xml.slice(tr.end)

  // Model sync: keep anchor/insets (for render layout), replace paragraphs
  cell.text = {
    ...(cell.text ?? { insets: { l: 91440, r: 91440, t: 45720, b: 45720 } }),
    paragraphs,
  }
  slide.structureDirty = true
  return true
}

/**
 * Table style editing (surgical patch of a:tblPr + a:tcPr):
 * apply a preset style or change firstRow/bandRow/shading/borders without touching
 * cell text. anchor.originalXml is patched directly; structureDirty=true triggers
 * the save rebuild.
 */
export function editTableStyle(slide: Slide, elementId: string, edit: TableStyleEdit): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  el.anchor.originalXml = patchTableStyleXml(el.anchor.originalXml, edit)
  slide.structureDirty = true
  return true
}

/**
 * Ensure ppt/tableStyles.xml contains the given custom style (injected the first
 * time a preset is applied). Creates the part when missing, adding the
 * [Content_Types].xml Override and presentation rels.
 */
export function ensureTableStylePart(
  opened: OpenedPptx,
  styleId: string,
  styleDefXml: string,
): void {
  const { archive } = opened
  const path = 'ppt/tableStyles.xml'
  const existing = archive.readText(path)
  const next = ensureTableStyleXml(existing, styleId, styleDefXml)
  if (existing === next) return
  archive.entries.set(path, textToBytes(next))
  if (existing) return
  const ctPath = '[Content_Types].xml'
  const ct = archive.readText(ctPath)
  if (ct && !hasContentTypeOverride(ct, path)) {
    archive.entries.set(
      ctPath,
      textToBytes(
        ct.replace(
          '</Types>',
          `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/></Types>`,
        ),
      ),
    )
  }
  const presRelsPath = 'ppt/_rels/presentation.xml.rels'
  const presRels = archive.readText(presRelsPath)
  if (presRels && !presRels.includes('/relationships/tableStyles"')) {
    const maxRid = maxRelationshipIdNumber(presRels)
    const rel = `<Relationship Id="rId${maxRid + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>`
    archive.entries.set(
      presRelsPath,
      textToBytes(presRels.replace('</Relationships>', rel + '</Relationships>')),
    )
  }
}

// ── Table row/column structure editing ──────────────────────────────────

export type TableStructureOp =
  | { kind: 'insert-row'; index: number; before?: boolean }
  | { kind: 'delete-row'; index: number }
  | { kind: 'insert-col'; index: number; before?: boolean }
  | { kind: 'delete-col'; index: number }

/** Row/column surgery is unsafe when the table has merged cells (gridSpan/rowSpan/hMerge/vMerge); refuse. */
function tableHasMerges(xml: string): boolean {
  return /\b(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(xml)
}

/** Clear the text of every tc in a table XML fragment (keeping tcPr formatting), used when cloning a reference row/column. */
function clearTcText(xml: string): string {
  return xml.replace(
    /<a:txBody(\s[^>]*)?>[\s\S]*?<\/a:txBody>/g,
    '<a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody>',
  )
}

/** Adjust one dimension of the graphicFrame <p:xfrm><a:ext> (cx/cy delta, EMU). */
function bumpFrameExt(xml: string, attr: 'cx' | 'cy', delta: number): string {
  const m = /<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\/>/.exec(xml)
  if (!m) return xml
  const patched = m[0].replace(
    new RegExp(`\\b${attr}="(-?\\d+)"`),
    (_a, v: string) => `${attr}="${Math.max(1, Number(v) + delta)}"`,
  )
  return xml.slice(0, m.index) + patched + xml.slice(m.index + m[0].length)
}

/**
 * Table row/column insert/delete (XML surgery + materialize/reparse):
 * - Inserted rows/columns clone the reference row/column's formatting with text
 *   cleared; the table frame grows/shrinks with the total row height/column width.
 * - Deleting is refused when only 1 row/column remains; tables with merged cells
 *   are always refused.
 * After reparse element ids change; the new table id is found back by element position.
 */
export function editTableStructure(
  opened: OpenedPptx,
  slideIndex: number,
  elementId: string,
  op: TableStructureOp,
): { slide: Slide; elementId: string } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  const elIndex = slide.elements.findIndex((e) => e.id === elementId)
  const el = slide.elements[elIndex]
  if (!el || el.type !== 'table') return null

  // Bake the element's unsaved patches into the slice first; the surgery works on the latest bytes
  let xml = patchedElementXml(el)
  if (tableHasMerges(xml)) return null

  const trSpans: Array<{ start: number; end: number }> = []
  for (let i = 0; ; i++) {
    const span = nthTagSpan(xml, 'a:tr', i)
    if (!span) break
    trSpans.push(span)
  }
  const nRows = trSpans.length
  const gridCols = gridColSpans(xml)
  const nCols = gridCols.length
  if (!nRows || !nCols) return null

  if (op.kind === 'insert-row' || op.kind === 'delete-row') {
    const at = op.index
    const ref = trSpans[at]
    if (!ref) return null
    const refXml = xml.slice(ref.start, ref.end)
    const rowH = Number(/<a:tr\s[^>]*\bh="(\d+)"/.exec(refXml)?.[1] ?? 0)
    if (op.kind === 'insert-row') {
      const clone = clearTcText(refXml)
      const insertAt = op.before ? ref.start : ref.end
      xml = xml.slice(0, insertAt) + clone + xml.slice(insertAt)
      xml = bumpFrameExt(xml, 'cy', rowH)
    } else {
      if (nRows <= 1) return null
      xml = xml.slice(0, ref.start) + xml.slice(ref.end)
      xml = bumpFrameExt(xml, 'cy', -rowH)
    }
  } else {
    const at = op.index
    const refCol = gridCols[at]
    if (!refCol) return null
    const colW = Number(/\bw="(\d+)"/.exec(refCol.open)?.[1] ?? 0)
    if (op.kind === 'delete-col' && nCols <= 1) return null

    // Process tc row by row (replace back-to-front so offsets stay valid)
    for (let r = nRows - 1; r >= 0; r--) {
      const tr = nthTagSpan(xml, 'a:tr', r)
      if (!tr) return null
      const trXml = xml.slice(tr.start, tr.end)
      const tc = nthTagSpan(trXml, 'a:tc', at)
      if (!tc) return null
      let newTr: string
      if (op.kind === 'insert-col') {
        const clone = clearTcText(trXml.slice(tc.start, tc.end))
        const insertAt = op.before ? tc.start : tc.end
        newTr = trXml.slice(0, insertAt) + clone + trXml.slice(insertAt)
      } else {
        newTr = trXml.slice(0, tc.start) + trXml.slice(tc.end)
      }
      xml = xml.slice(0, tr.start) + newTr + xml.slice(tr.end)
    }
    // gridCol and frame width
    const gc = gridColSpans(xml)[at]!
    if (op.kind === 'insert-col') {
      // Fresh self-closing clone: copying the full span would duplicate the
      // reference column's a16:colId, which must stay unique per column
      const insertAt = op.before ? gc.start : gc.end
      xml = xml.slice(0, insertAt) + `<a:gridCol w="${colW}"/>` + xml.slice(insertAt)
      xml = bumpFrameExt(xml, 'cx', colW)
    } else {
      xml = xml.slice(0, gc.start) + xml.slice(gc.end)
      xml = bumpFrameExt(xml, 'cx', -colW)
    }
  }

  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  slide.structureDirty = true
  const fresh = materializeSlide(opened, slideIndex)
  if (!fresh) return null
  const newEl = fresh.elements[elIndex]
  if (!newEl) return null
  return { slide: fresh, elementId: newEl.id }
}

// ── Table merge/split cells ─────────────────────────────────────────────

export type TableMergeOp =
  | { kind: 'merge-right'; row: number; col: number }
  | { kind: 'merge-down'; row: number; col: number }
  | { kind: 'split'; row: number; col: number }

const tcAttr = (tcOpen: string, name: string): number => {
  const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tcOpen)
  return m ? Number(m[1]) : 0
}

/** Change an <a:tc> open-tag attribute: val=null removes it, otherwise sets it. Returns the whole tc XML. */
function setTcAttrXml(tcXml: string, name: string, val: number | null): string {
  return tcXml.replace(/<a:tc(\s[^>]*)?>/, (open) => {
    const cleaned = open.replace(new RegExp(`\\s${name}="[^"]*"`), '')
    if (val == null) return cleaned
    return cleaned.replace(/^<a:tc/, `<a:tc ${name}="${val}"`)
  })
}

/** Extract non-empty paragraphs from a tc (merging folds the absorbed cell's content into the anchor cell). */
function tcParagraphsXml(tcXml: string): string {
  const body = /<a:txBody(?:\s[^>]*)?>([\s\S]*?)<\/a:txBody>/.exec(tcXml)?.[1] ?? ''
  const paras = body.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g) ?? []
  return paras.filter((p) => /<a:t>(?=[^<]*\S)[^<]*<\/a:t>/.test(p)).join('')
}

/**
 * Merge/split cells (XML surgery + materialize/reparse). v1 constraints:
 * merge-right requires anchor rowSpan=1 and a plain right neighbor; merge-down
 * requires anchor gridSpan=1 and a plain neighbor below (an already-merged anchor
 * can keep extending). The absorbed cell's text folds into the anchor.
 */
export function mergeTableCells(
  opened: OpenedPptx,
  slideIndex: number,
  elementId: string,
  op: TableMergeOp,
): { slide: Slide; elementId: string } | null {
  const slide = opened.deck.slides[slideIndex]
  if (!slide) return null
  const elIndex = slide.elements.findIndex((e) => e.id === elementId)
  const el = slide.elements[elIndex]
  if (!el || el.type !== 'table') return null

  let xml = patchedElementXml(el)
  const tr = nthTagSpan(xml, 'a:tr', op.row)
  if (!tr) return null
  let trXml = xml.slice(tr.start, tr.end)
  const anchorSpan = nthTagSpan(trXml, 'a:tc', op.col)
  if (!anchorSpan) return null
  let anchorXml = trXml.slice(anchorSpan.start, anchorSpan.end)
  const anchorOpen = /<a:tc(\s[^>]*)?>/.exec(anchorXml)![0]
  if (/\b[hv]Merge="/.test(anchorOpen)) return null
  const g = tcAttr(anchorOpen, 'gridSpan') || 1
  const v = tcAttr(anchorOpen, 'rowSpan') || 1

  const isPlainTc = (tcXml: string) =>
    !/\b(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(/<a:tc(\s[^>]*)?>/.exec(tcXml)![0])
  /** Clear text + set the merge continuation flag. */
  const toCovered = (tcXml: string, mark: 'hMerge' | 'vMerge') =>
    setTcAttrXml(clearTcText(tcXml), mark, 1)
  const appendToAnchor = (parasXml: string) => {
    if (parasXml) anchorXml = anchorXml.replace(/<\/a:txBody>/, `${parasXml}</a:txBody>`)
  }

  if (op.kind === 'merge-right') {
    if (v !== 1) return null
    const target = nthTagSpan(trXml, 'a:tc', op.col + g)
    if (!target) return null
    const targetXml = trXml.slice(target.start, target.end)
    if (!isPlainTc(targetXml)) return null
    appendToAnchor(tcParagraphsXml(targetXml))
    anchorXml = setTcAttrXml(anchorXml, 'gridSpan', g + 1)
    trXml =
      trXml.slice(0, anchorSpan.start) +
      anchorXml +
      trXml.slice(anchorSpan.end, target.start) +
      toCovered(targetXml, 'hMerge') +
      trXml.slice(target.end)
    xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end)
  } else if (op.kind === 'merge-down') {
    if (g !== 1) return null
    const tr2 = nthTagSpan(xml, 'a:tr', op.row + v)
    if (!tr2) return null
    let tr2Xml = xml.slice(tr2.start, tr2.end)
    const target = nthTagSpan(tr2Xml, 'a:tc', op.col)
    if (!target) return null
    const targetXml = tr2Xml.slice(target.start, target.end)
    if (!isPlainTc(targetXml)) return null
    appendToAnchor(tcParagraphsXml(targetXml))
    anchorXml = setTcAttrXml(anchorXml, 'rowSpan', v + 1)
    trXml = trXml.slice(0, anchorSpan.start) + anchorXml + trXml.slice(anchorSpan.end)
    tr2Xml =
      tr2Xml.slice(0, target.start) + toCovered(targetXml, 'vMerge') + tr2Xml.slice(target.end)
    // The later row goes first so the earlier offsets stay valid
    xml = xml.slice(0, tr2.start) + tr2Xml + xml.slice(tr2.end)
    xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end)
  } else {
    if (g <= 1 && v <= 1) return null
    // Process rows back-to-front so offsets stay valid
    for (let r = op.row + v - 1; r >= op.row; r--) {
      const rowSpanRef = nthTagSpan(xml, 'a:tr', r)
      if (!rowSpanRef) return null
      let rowXml = xml.slice(rowSpanRef.start, rowSpanRef.end)
      for (let c = op.col + g - 1; c >= op.col; c--) {
        const span = nthTagSpan(rowXml, 'a:tc', c)
        if (!span) return null
        let tcXml = rowXml.slice(span.start, span.end)
        if (r === op.row && c === op.col) {
          tcXml = setTcAttrXml(setTcAttrXml(tcXml, 'gridSpan', null), 'rowSpan', null)
        } else {
          tcXml = setTcAttrXml(setTcAttrXml(tcXml, 'hMerge', null), 'vMerge', null)
        }
        rowXml = rowXml.slice(0, span.start) + tcXml + rowXml.slice(span.end)
      }
      xml = xml.slice(0, rowSpanRef.start) + rowXml + xml.slice(rowSpanRef.end)
    }
  }

  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  slide.structureDirty = true
  const fresh = materializeSlide(opened, slideIndex)
  if (!fresh) return null
  const newEl = fresh.elements[elIndex]
  if (!newEl) return null
  return { slide: fresh, elementId: newEl.id }
}

/**
 * Set a column's width (EMU): gridCol w + frame ext.cx synced, model updated in
 * place (no reparse, element ids stable — good for drag resizing).
 */
export function setTableColWidth(
  slide: Slide,
  elementId: string,
  col: number,
  wEmu: number,
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  const table = el as TableElement
  if (col < 0 || col >= table.colWidths.length) return false
  // a non-finite EMU (NaN, 1e308 overflow) would serialize verbatim into w=
  if (!Number.isFinite(wEmu)) return false

  let xml = patchedElementXml(el)
  const gc = gridColSpans(xml)[col]
  if (!gc) return false
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  const w = Math.max(1, Math.round(wEmu))
  const patched = gc.open.replace(/\bw="-?\d+"/, `w="${w}"`)
  xml = xml.slice(0, gc.start) + patched + xml.slice(gc.start + gc.open.length)

  const dxRtl = table.rtl ? w - table.colWidths[col]! : 0
  table.colWidths[col] = w
  const sum = table.colWidths.reduce((a, b) => a + b, 0)
  xml = xml.replace(
    /(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcx=")-?\d+(")/,
    (_a, pre: string, post: string) => `${pre}${sum}${post}`,
  )
  // rtl mirroring anchors the table's visual-right edge: growing a column extends the
  // frame leftward, so the origin shifts by the width delta (LTR keeps the origin and
  // extends rightward)
  if (dxRtl) {
    const newX = el.transform.offset.x - dxRtl
    xml = xml.replace(
      /(<p:xfrm[^>]*>[\s\S]*?<a:off\s[^>]*\bx=")-?\d+(")/,
      (_a, pre: string, post: string) => `${pre}${newX}${post}`,
    )
    el.transform.offset.x = newX
  }
  el.anchor.originalXml = xml
  el.transform.offset.cx = sum
  slide.structureDirty = true
  return true
}

/** Set a row's height (EMU): <a:tr h> + frame ext.cy synced (matching setTableColWidth semantics). */
export function setTableRowHeight(
  slide: Slide,
  elementId: string,
  row: number,
  hEmu: number,
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  const table = el as TableElement
  if (row < 0 || row >= table.rowHeights.length) return false
  if (!Number.isFinite(hEmu)) return false

  let xml = patchedElementXml(el)
  const tr = nthTagSpan(xml, 'a:tr', row)
  if (!tr) return false
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  const h = Math.max(1, Math.round(hEmu))
  const trOpen = /<a:tr(\s[^>]*)?>/.exec(xml.slice(tr.start, tr.end))![0]
  const patchedOpen = /\bh="-?\d+"/.test(trOpen)
    ? trOpen.replace(/\bh="-?\d+"/, `h="${h}"`)
    : trOpen.replace(/^<a:tr/, `<a:tr h="${h}"`)
  xml = xml.slice(0, tr.start) + patchedOpen + xml.slice(tr.start + trOpen.length)

  table.rowHeights[row] = h
  const sum = table.rowHeights.reduce((a, b) => a + b, 0)
  xml = xml.replace(
    /(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcy=")-?\d+(")/,
    (_a, pre: string, post: string) => `${pre}${sum}${post}`,
  )
  el.anchor.originalXml = xml
  el.transform.offset.cy = sum
  slide.structureDirty = true
  return true
}

/** Scale values so they sum exactly to target (>=1 each; the last entry absorbs rounding drift). */
function scaleToSum(values: number[], target: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0)
  if (sum <= 0) return values
  const out = values.map((v) => Math.max(1, Math.round((v * target) / sum)))
  const drift = target - out.reduce((a, b) => a + b, 0)
  out[out.length - 1] = Math.max(1, out[out.length - 1]! + drift)
  return out
}

/**
 * Resize a table by proportionally redistributing <a:gridCol w> and <a:tr h>
 * (PowerPoint's behavior). Without this, setting the frame's a:ext leaves the
 * internal grid at its old size, so other software renders the old dimensions
 *. The frame ext is synced to the redistributed sums.
 */
export function resizeTable(slide: Slide, elementId: string, cx: number, cy: number): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  const table = el as TableElement
  if (!table.colWidths.length || !table.rowHeights.length) return false
  const targetCx = Math.max(table.colWidths.length, Math.round(cx))
  const targetCy = Math.max(table.rowHeights.length, Math.round(cy))

  let xml = patchedElementXml(el)
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined

  const widths = scaleToSum(table.colWidths, targetCx)
  let ci = 0
  // Opening tags only — paired-form gridCols (extLst children) must scale too
  xml = xml.replace(/<a:gridCol\b[^>]*>/g, (m) =>
    ci < widths.length ? m.replace(/\bw="-?\d+"/, `w="${widths[ci++]}"`) : m,
  )

  const heights = scaleToSum(table.rowHeights, targetCy)
  let ri = 0
  xml = xml.replace(/<a:tr(\s[^>]*)?>/g, (m) => {
    if (ri >= heights.length) return m
    const h = heights[ri++]!
    return /\bh="-?\d+"/.test(m)
      ? m.replace(/\bh="-?\d+"/, `h="${h}"`)
      : m.replace(/^<a:tr/, `<a:tr h="${h}"`)
  })

  const sumW = widths.reduce((a, b) => a + b, 0)
  const sumH = heights.reduce((a, b) => a + b, 0)
  xml = xml.replace(
    /(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcx=")-?\d+(")/,
    (_a, pre: string, post: string) => `${pre}${sumW}${post}`,
  )
  xml = xml.replace(
    /(<p:xfrm[^>]*>[\s\S]*?<a:ext\s[^>]*\bcy=")-?\d+(")/,
    (_a, pre: string, post: string) => `${pre}${sumH}${post}`,
  )

  table.colWidths = widths
  table.rowHeights = heights
  el.anchor.originalXml = xml
  el.transform.offset.cx = sumW
  el.transform.offset.cy = sumH
  slide.structureDirty = true
  return true
}

/** Cell text vertical alignment (tcPr anchor: t/ctr/b). Byte surgery + model sync. */
export function setTableCellAnchor(
  slide: Slide,
  elementId: string,
  row: number,
  col: number,
  anchor: 'top' | 'middle' | 'bottom',
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || el.type !== 'table') return false
  const table = el as TableElement
  const cell = table.rows[row]?.[col]
  if (!cell || cell.merged) return false

  let xml = patchedElementXml(el)
  const tr = nthTagSpan(xml, 'a:tr', row)
  if (!tr) return false
  let trXml = xml.slice(tr.start, tr.end)
  const tc = nthTagSpan(trXml, 'a:tc', col)
  if (!tc) return false
  let tcXml = trXml.slice(tc.start, tc.end)
  const val = anchor === 'middle' ? 'ctr' : anchor === 'bottom' ? 'b' : 't'
  const tcPr = /<a:tcPr(\s[^>]*)?\/?>/.exec(tcXml)
  if (tcPr) {
    let tag = tcPr[0].replace(/\s+anchor="[^"]*"/, '')
    tag = tag.replace(/^<a:tcPr/, `<a:tcPr anchor="${val}"`)
    tcXml = tcXml.slice(0, tcPr.index) + tag + tcXml.slice(tcPr.index + tcPr[0].length)
  } else {
    tcXml = tcXml.replace(/<\/a:tc>$/, `<a:tcPr anchor="${val}"/></a:tc>`)
  }
  trXml = trXml.slice(0, tc.start) + tcXml + trXml.slice(tc.end)
  xml = xml.slice(0, tr.start) + trXml + xml.slice(tr.end)

  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  if (cell.text) cell.text.anchor = anchor
  slide.structureDirty = true
  return true
}
