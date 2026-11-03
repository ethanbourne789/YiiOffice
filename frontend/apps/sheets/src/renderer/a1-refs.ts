/**
 * A1 address helpers (extracted verbatim from univer-sync.ts).
 *
 * Pure 0-based file/model coordinates ↔ A1 reference strings and the
 * bounding-box readers for Univer cell matrices. Depends only on the
 * xlsx-gateway address parser and Univer's IRange type — no runtime, no
 * commands, no Univer internals.
 */
import type { IRange } from '@univerjs/core'
import { columnLabel, parseRange } from '@yiioffice/xlsx-gateway/domain/cell-address'
import type { CellBounds } from '@yiioffice/xlsx-gateway/domain/chart-visual'

export function columnLetter(index: number): string {
  let label = ''
  for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) {
    label = String.fromCharCode(65 + (i % 26)) + label
  }
  return label
}

/// Absolute A1 ref for a rectangular range string, quoted-sheet prefixed.
export function absRangeRef(sheetName: string, range: string): string {
  const bounds = parseRange(range)
  const name = sheetName.replace(/'/g, "''")
  return (
    `'${name}'!$${columnLabel(bounds.startColumn)}$${bounds.startRow + 1}` +
    `:$${columnLabel(bounds.endColumn)}$${bounds.endRow + 1}`
  )
}

/// Absolute A1 ref over one column, rows in 0-based coordinates.
export function a1RangeRef(
  sheetName: string,
  column: number,
  fromRow: number,
  toRow: number,
): string {
  const col = columnLetter(column)
  const name = sheetName.replace(/'/g, "''")
  return `'${name}'!$${col}$${fromRow + 1}:$${col}$${toRow + 1}`
}

/// Absolute A1 ref over one row, columns in 0-based coordinates.
export function a1RowRangeRef(
  sheetName: string,
  row: number,
  fromColumn: number,
  toColumn: number,
): string {
  const name = sheetName.replace(/'/g, "''")
  return `'${name}'!$${columnLetter(fromColumn)}$${row + 1}:$${columnLetter(toColumn)}$${row + 1}`
}

/// Bounds of a Univer cell matrix (`{row: {col: cell}}`), for move-range
/// mutations that omit explicit from/to ranges.
export function matrixBounds(value: unknown): IRange | null {
  if (typeof value !== 'object' || value === null) return null
  let startRow = Number.POSITIVE_INFINITY
  let endRow = -1
  let startColumn = Number.POSITIVE_INFINITY
  let endColumn = -1
  for (const [rowKey, rowValue] of Object.entries(value)) {
    const row = Number(rowKey)
    if (!Number.isInteger(row) || typeof rowValue !== 'object' || rowValue === null) continue
    for (const columnKey of Object.keys(rowValue)) {
      const column = Number(columnKey)
      if (!Number.isInteger(column)) continue
      startRow = Math.min(startRow, row)
      endRow = Math.max(endRow, row)
      startColumn = Math.min(startColumn, column)
      endColumn = Math.max(endColumn, column)
    }
  }
  if (endRow < 0 || endColumn < 0) return null
  return { startRow, endRow, startColumn, endColumn }
}

/// Bounding box of a set-range-values `cellValue` payload ({row: {col: …}}).
export function cellValueBounds(cellValue: unknown): CellBounds | null {
  if (typeof cellValue !== 'object' || cellValue === null) return null
  let bounds: CellBounds | null = null
  for (const [rowKey, rowValue] of Object.entries(cellValue)) {
    const row = Number(rowKey)
    if (!Number.isInteger(row) || row < 0) continue
    if (typeof rowValue !== 'object' || rowValue === null) continue
    for (const columnKey of Object.keys(rowValue as Record<string, unknown>)) {
      const column = Number(columnKey)
      if (!Number.isInteger(column) || column < 0) continue
      bounds =
        bounds === null
          ? { startRow: row, endRow: row, startColumn: column, endColumn: column }
          : {
              startRow: Math.min(bounds.startRow, row),
              endRow: Math.max(bounds.endRow, row),
              startColumn: Math.min(bounds.startColumn, column),
              endColumn: Math.max(bounds.endColumn, column),
            }
    }
  }
  return bounds
}
