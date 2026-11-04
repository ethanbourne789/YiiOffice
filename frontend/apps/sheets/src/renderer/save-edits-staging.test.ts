import { describe, expect, it } from 'vitest'
import type { WorkbookCellEdit } from '../shared/desktop-api'
import { MAX_SAVE_EDITS_TOTAL, SAVE_EDITS_CHUNK_MAX } from '../shared/ipc-channels'
import { batchSaveEdits } from './save-edits-staging'

function edits(count: number): WorkbookCellEdit[] {
  return Array.from({ length: count }, (_, index) => ({
    sheetId: 'sheet-1',
    row: index,
    column: 0,
    writeValue: true,
    value: index,
  })) as WorkbookCellEdit[]
}

describe('batchSaveEdits', () => {
  it('keeps a 20,000-cell edit set in one request', () => {
    const input = edits(20_000)
    expect(batchSaveEdits(input)).toEqual([input])
  })

  it('splits sets above the chunk cap without losing or reordering an edit', () => {
    const count = SAVE_EDITS_CHUNK_MAX * 2 + 5
    const input = edits(count)
    const batches = batchSaveEdits(input)

    expect(batches.length).toBe(3)
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(SAVE_EDITS_CHUNK_MAX)
    }
    expect(batches.flat()).toEqual(input)
  })

  it('still produces one (empty) request when nothing was edited', () => {
    expect(batchSaveEdits([])).toEqual([[]])
  })

  it('rejects a save above the absolute cap', () => {
    const oversized = new Array(MAX_SAVE_EDITS_TOTAL + 1) as WorkbookCellEdit[]
    expect(() => batchSaveEdits(oversized)).toThrowError(/maximum for a single save/)
  })
})
