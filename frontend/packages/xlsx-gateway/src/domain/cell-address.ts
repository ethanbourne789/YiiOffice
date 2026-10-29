import { columnToLetters, lettersToColumn, toA1 } from '../shared/xml'

export interface CellCoordinates {
  readonly row: number
  readonly column: number
}

export interface RangeBounds {
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

export function parseAddress(address: string): CellCoordinates {
  // $-anchored A1 notation is equivalent here; some producers store pivot
  // location refs as $C$33 and refreshing such a pivot must not choke.
  // Trim surrounding whitespace, but stay case-strict: the sheets consumer
  // contract pins lowercase rejection (see apps/sheets/tests/cell-address.test.ts).
  const normalized = address.trim()
  const match = /^\$?([A-Z]+)\$?([1-9][0-9]*)$/.exec(normalized)
  if (!match?.[1] || !match[2]) throw new Error(`Invalid cell address: ${address}`)
  let column = 0
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64
  }
  return { row: Number(match[2]) - 1, column: column - 1 }
}

/// Inverse of parseAddress's column parsing: 0 → A, 25 → Z, 26 → AA.
export function columnLabel(column: number): string {
  if (!Number.isInteger(column) || column < 0) {
    throw new RangeError(`Invalid column index: ${column}`)
  }
  return columnToLetters(column)
}

export function formatAddress(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 0) {
    throw new RangeError(`Invalid row index: ${row}`)
  }
  if (!Number.isInteger(column) || column < 0) {
    throw new RangeError(`Invalid column index: ${column}`)
  }
  return toA1(row, column)
}

/// A → 0, Z → 25, AA → 26.
export function columnIndex(label: string): number {
  // Accept surrounding whitespace and lowercase labels.
  const normalized = label.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(normalized)) throw new Error(`Invalid column label: ${label}`)
  return lettersToColumn(normalized)
}

/// Accepts "A1:C10" or a single cell "B2"; normalizes so start ≤ end.
export function parseRange(range: string): RangeBounds {
  // Trim the whole range and each endpoint so " A1 : B2 " parses.
  const trimmed = range.trim()
  const parts = trimmed.split(':')
  const firstPart = parts[0]?.trim()
  const secondPart = parts[1]?.trim()
  if (parts.length > 2 || !firstPart || (parts.length === 2 && !secondPart)) {
    throw new Error(`Invalid range: ${range}`)
  }
  const first = parseAddress(firstPart)
  const second = secondPart ? parseAddress(secondPart) : first
  return {
    startRow: Math.min(first.row, second.row),
    startColumn: Math.min(first.column, second.column),
    endRow: Math.max(first.row, second.row),
    endColumn: Math.max(first.column, second.column),
  }
}

export function rangeCellCount(bounds: RangeBounds): number {
  return (bounds.endRow - bounds.startRow + 1) * (bounds.endColumn - bounds.startColumn + 1)
}

export function rangeAddresses(bounds: RangeBounds): string[] {
  const addresses: string[] = []
  for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      addresses.push(formatAddress(row, column))
    }
  }
  return addresses
}
