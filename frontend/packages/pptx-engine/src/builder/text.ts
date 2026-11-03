import {
  applyFontPatch,
  applyParagraphFormat,
  type ElementFontPatch,
  type FontSizeMap,
  type ParagraphFormatPatch,
} from './shared'
import { editTableCellText } from './table'
import { patchGroupChildText } from './group'
import type {
  Slide,
  SlideDeck,
  SlideElement,
  Paragraph,
  TextRun,
  TextElement,
  TableElement,
  GroupElement,
  PPrDirty,
} from '../types'

export function setElementFont(
  slide: Slide,
  elementId: string,
  patch: ElementFontPatch,
  sizeMap?: FontSizeMap,
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el) return false
  const apply = (paragraphs: Paragraph[]) => applyFontPatch(paragraphs, patch, sizeMap)
  if (el.type === 'text' || el.type === 'shape') {
    const t = el as TextElement
    if (!t.text?.paragraphs.length) return false
    apply(t.text.paragraphs)
    el.dirty = true
    return true
  }
  if (el.type === 'table') {
    const table = el as TableElement
    let changed = false
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]!
        if (cell.merged || !cell.text?.paragraphs.length) continue
        apply(cell.text.paragraphs)
        if (editTableCellText(slide, elementId, r, c, cell.text.paragraphs)) changed = true
      }
    }
    return changed
  }
  return false
}

// ── Find/replace ────────────────────────────────────────────────────────

export interface ReplaceOptions {
  matchCase?: boolean
  /** Replace only the first match (the "Replace" button; default replaces all) */
  firstOnly?: boolean
  /** Restrict to one slide/element (the "Replace" button acts on the currently hit element) */
  slideIndex?: number
  elementId?: string
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Deck-wide replace (a match may span consecutive runs of a paragraph: the
 * replacement lands in the run holding its first character and the matched text
 * is cut from the runs it covers, so untouched text keeps its own rPr). Covers
 * text/shape, table cells, and direct group children; dynamic field runs are
 * skipped and no match spans one.
 * Returns the replacement count; elements on changed slides are flagged dirty.
 */
export function replaceAllInDeck(
  deck: SlideDeck,
  find: string,
  replace: string,
  opts: ReplaceOptions = {},
): { count: number; changedSlides: number[] } {
  if (!find) return { count: 0, changedSlides: [] }
  const re = new RegExp(escapeRegExp(find), opts.matchCase ? 'g' : 'gi')
  let budget = opts.firstOnly ? 1 : Infinity
  let count = 0
  const changed = new Set<number>()

  // A field run or an <a:br/> soft-break sentinel is a hard barrier: matches may
  // only span the consecutive plain runs between them.
  const isBarrier = (r: TextRun): boolean => !!r.field || r.text === '\n'
  const segmentsOf = (p: Paragraph): TextRun[][] => {
    const segments: TextRun[][] = []
    let current: TextRun[] = []
    for (const r of p.runs) {
      if (isBarrier(r)) {
        if (current.length) segments.push(current)
        current = []
      } else if (r.text) current.push(r)
    }
    if (current.length) segments.push(current)
    return segments
  }

  const replaceInParagraphs = (paragraphs: Paragraph[]): boolean => {
    let hit = false
    for (const p of paragraphs) {
      if (budget <= 0) return hit
      for (const runs of segmentsOf(p)) {
        if (budget <= 0) return hit
        hit = replaceInRuns(runs) || hit
      }
    }
    return hit
  }

  const replaceInRuns = (runs: TextRun[]): boolean => {
    let hit = false
    let full = ''
    const ends: number[] = []
    for (const r of runs) {
      full += r.text
      ends.push(full.length)
    }
    const out = runs.map(() => '')
    const runAt = (offset: number): number => {
      for (let k = 0; k < ends.length; k++) if (offset < ends[k]!) return k
      return ends.length - 1
    }
    const keep = (from: number, to: number): void => {
      let off = from
      for (let k = 0; k < ends.length && off < to; k++) {
        const end = ends[k]!
        if (end <= off) continue
        const take = Math.min(end, to) - off
        out[k] += full.slice(off, off + take)
        off += take
      }
    }
    re.lastIndex = 0
    let cursor = 0
    let n = 0
    let m: RegExpExecArray | null
    while (budget > 0 && (m = re.exec(full)) !== null) {
      n++
      budget--
      keep(cursor, m.index)
      out[runAt(m.index)] += replace
      cursor = m.index + m[0].length
    }
    if (n > 0) {
      keep(cursor, full.length)
      for (let i = 0; i < runs.length; i++) {
        if (runs[i]!.text !== out[i]) runs[i]!.text = out[i]!
      }
      count += n
      hit = true
    }
    return hit
  }

  deck.slides.forEach((slide, si) => {
    if (budget <= 0) return
    if (opts.slideIndex != null && si !== opts.slideIndex) return
    for (const el of slide.elements) {
      if (budget <= 0) break
      if (opts.elementId != null && el.id !== opts.elementId) continue
      if ((el.type === 'text' || el.type === 'shape') && (el as TextElement).text) {
        if (replaceInParagraphs((el as TextElement).text!.paragraphs)) {
          el.dirty = true
          changed.add(si)
        }
      } else if (el.type === 'table') {
        const table = el as TableElement
        for (let ri = 0; ri < table.rows.length; ri++) {
          const row = table.rows[ri]!
          for (let ci = 0; ci < row.length; ci++) {
            const cell = row[ci]!
            if (cell.merged || !cell.text?.paragraphs.length) continue
            if (replaceInParagraphs(cell.text.paragraphs)) {
              editTableCellText(slide, el.id, ri, ci, cell.text.paragraphs)
              changed.add(si)
            }
            if (budget <= 0) break
          }
          if (budget <= 0) break
        }
      } else if (el.type === 'group') {
        for (const child of (el as GroupElement).children) {
          if (budget <= 0) break
          if ((child.type === 'text' || child.type === 'shape') && (child as TextElement).text) {
            if (replaceInParagraphs((child as TextElement).text!.paragraphs)) {
              patchGroupChildText(slide, el.id, child as TextElement)
              changed.add(si)
            }
          }
        }
      }
    }
  })
  return { count, changedSlides: [...changed].sort((a, b) => a - b) }
}

/** Merge PPrDirty (multiple operations accumulate on the element). */
function mergePPrDirty(el: SlideElement, d: PPrDirty): void {
  if (!Object.keys(d).length) return
  // paraIndices: only stays restricted while every accumulated op was restricted
  const indices =
    el.dirtyPPr == null
      ? d.paraIndices
      : el.dirtyPPr.paraIndices && d.paraIndices
        ? [...new Set([...el.dirtyPPr.paraIndices, ...d.paraIndices])]
        : undefined
  el.dirtyPPr = { ...el.dirtyPPr, ...d }
  if (indices) el.dirtyPPr.paraIndices = indices
  else delete el.dirtyPPr.paraIndices
}

/**
 * Change paragraph formatting directly on a selected element (bullet/line
 * spacing/paragraph spacing/alignment), applied to all of its paragraphs
 * (text/shape/table; same as clicking bullets with a shape selected in PowerPoint).
 * paraIndices restricts the patch to those paragraphs (editing-mode selection).
 */
export function setElementParagraphFormat(
  slide: Slide,
  elementId: string,
  patch: ParagraphFormatPatch,
  paraIndices?: number[],
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el) return false
  if (el.type === 'text' || el.type === 'shape') {
    const t = el as TextElement
    if (!t.text?.paragraphs.length) return false
    const target = paraIndices
      ? paraIndices.map((i) => t.text!.paragraphs[i]).filter((p): p is Paragraph => !!p)
      : t.text.paragraphs
    if (!target.length) return false
    const dirty = applyParagraphFormat(target, patch)
    if (paraIndices && Object.keys(dirty).length) dirty.paraIndices = paraIndices
    mergePPrDirty(el, dirty)
    return !!el.dirtyPPr
  }
  if (el.type === 'table') {
    const table = el as TableElement
    let changed = false
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]!
        if (cell.merged || !cell.text?.paragraphs.length) continue
        applyParagraphFormat(cell.text.paragraphs, patch)
        if (editTableCellText(slide, elementId, r, c, cell.text.paragraphs)) changed = true
      }
    }
    return changed
  }
  return false
}
