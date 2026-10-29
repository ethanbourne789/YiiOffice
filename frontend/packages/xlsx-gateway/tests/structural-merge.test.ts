import { describe, expect, it } from 'vitest'

import {
  applyStructuralOps,
  StructuralShiftError,
  type CellArea,
  type StructuralOp,
} from '../src/gateway/xlsx-structure'

const SHEET = 'Data'

const ROWS =
  '<row r="1"><c r="A1"><v>1</v></c></row><row r="2" ht="20" customHeight="1"><c r="A2"><v>2</v></c></row><row r="3"><c r="A3"><v>3</v></c></row>'

function worksheetWithMerges(mergeInner: string, count: number): string {
  const section = mergeInner ? `<mergeCells count="${count}">${mergeInner}</mergeCells>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D10"/><sheetFormatPr defaultRowHeight="15"/><sheetData>${ROWS}</sheetData>${section}</worksheet>`
}

const area = (
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): CellArea => ({ startRow, endRow, startColumn, endColumn })

const merge = (range: CellArea): StructuralOp => ({ kind: 'merge-cells', range })
const unmerge = (range: CellArea): StructuralOp => ({ kind: 'unmerge-cells', range })

/// A1:B2 — the merge every overlap case pivots around.
const A1_B2 = area(0, 1, 0, 1)
/// B2:C3 — touches A1:B2 at exactly one cell (B2).
const B2_C3 = area(1, 2, 1, 2)
/// C3:D4 — disjoint from A1:B2.
const C3_D4 = area(2, 3, 2, 3)

function mergeRefs(xml: string): string[] {
  return [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map((match) => match[1]!)
}

describe('merge-cells writes and the mergeCells section', () => {
  it('creates the section after sheetData on the first merge', () => {
    const xml = applyStructuralOps(worksheetWithMerges('', 0), [merge(A1_B2)], SHEET)
    expect(xml).toContain(
      '</sheetData><mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>',
    )
  })

  it('accumulates disjoint merges and keeps the count honest', () => {
    const xml = applyStructuralOps(worksheetWithMerges('', 0), [merge(A1_B2), merge(C3_D4)], SHEET)
    expect(mergeRefs(xml)).toEqual(['A1:B2', 'C3:D4'])
    expect(xml).toContain('<mergeCells count="2">')
  })
})

describe('merge-cells overlap guard', () => {
  it('is idempotent for an exact re-merge of the same range', () => {
    const once = applyStructuralOps(worksheetWithMerges('', 0), [merge(A1_B2)], SHEET)
    const twice = applyStructuralOps(once, [merge(A1_B2)], SHEET)
    expect(mergeRefs(twice)).toEqual(['A1:B2'])
    expect(twice).toContain('<mergeCells count="1">')
    // …and within a single op batch too.
    const batched = applyStructuralOps(worksheetWithMerges('', 0), [merge(A1_B2), merge(A1_B2)], SHEET)
    expect(mergeRefs(batched)).toEqual(['A1:B2'])
    expect(batched).toContain('<mergeCells count="1">')
  })

  it('treats a differently spelled identical range as the same merge', () => {
    // Files written by other tools may spell the ref with absolute markers.
    const base = worksheetWithMerges('<mergeCell ref="$A$1:$B$2"/>', 1)
    const xml = applyStructuralOps(base, [merge(A1_B2)], SHEET)
    expect(mergeRefs(xml)).toEqual(['$A$1:$B$2'])
    expect(xml).toContain('<mergeCells count="1">')
  })

  it('throws StructuralShiftError when the new merge overlaps an existing one', () => {
    const base = worksheetWithMerges('<mergeCell ref="A1:B2"/>', 1)
    expect(() => applyStructuralOps(base, [merge(B2_C3)], SHEET)).toThrow(StructuralShiftError)
    expect(() => applyStructuralOps(base, [merge(B2_C3)], SHEET)).toThrow(/overlap/)
  })

  it('blocks overlap even when the existing merge is spelled with absolute refs', () => {
    const base = worksheetWithMerges('<mergeCell ref="$A$1:$B$2"/>', 1)
    expect(() => applyStructuralOps(base, [merge(B2_C3)], SHEET)).toThrow(StructuralShiftError)
  })

  it('still accepts a disjoint merge next to an existing one', () => {
    const base = worksheetWithMerges('<mergeCell ref="A1:B2"/>', 1)
    const xml = applyStructuralOps(base, [merge(C3_D4)], SHEET)
    expect(mergeRefs(xml)).toEqual(['A1:B2', 'C3:D4'])
    expect(xml).toContain('<mergeCells count="2">')
  })
})

describe('unmerge-cells', () => {
  it('drops the entry and refreshes the count', () => {
    const base = worksheetWithMerges('<mergeCell ref="A1:B2"/><mergeCell ref="C3:D4"/>', 2)
    const xml = applyStructuralOps(base, [unmerge(A1_B2)], SHEET)
    expect(mergeRefs(xml)).toEqual(['C3:D4'])
    expect(xml).toContain('<mergeCells count="1">')
  })

  it('removes the whole section once the last merge is gone', () => {
    const base = worksheetWithMerges('<mergeCell ref="A1:B2"/>', 1)
    const xml = applyStructuralOps(base, [unmerge(A1_B2)], SHEET)
    expect(xml).not.toContain('mergeCells')
    expect(xml).not.toContain('mergeCell')
  })

  it('lets the range be merged again after an unmerge', () => {
    const base = worksheetWithMerges('<mergeCell ref="A1:B2"/><mergeCell ref="C3:D4"/>', 2)
    const xml = applyStructuralOps(base, [unmerge(A1_B2), merge(A1_B2)], SHEET)
    expect(mergeRefs(xml).sort()).toEqual(['A1:B2', 'C3:D4'])
    expect(xml).toContain('<mergeCells count="2">')
  })
})
