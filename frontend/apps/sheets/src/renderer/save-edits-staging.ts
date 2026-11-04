import type { WorkbookCellEdit } from '../shared/desktop-api'
import { MAX_SAVE_EDITS_TOTAL, SAVE_EDITS_CHUNK_MAX } from '../shared/ipc-channels'

/**
 * Splits one save's cell edits into sequential save-request batches. Large
 * edit sets are applied through several ordinary saveWorkbookEdits calls on
 * the same session (each call writes the workbook and reloads it in place);
 * the previous chunked-transfer path had no Go-side implementation and every
 * transfer it staged was silently dropped on save.
 */
export function batchSaveEdits(edits: WorkbookCellEdit[]): WorkbookCellEdit[][] {
  if (edits.length > MAX_SAVE_EDITS_TOTAL) {
    throw new Error(
      `This save contains ${edits.length.toLocaleString()} cell edits, above the ` +
        `${MAX_SAVE_EDITS_TOTAL.toLocaleString()} maximum for a single save.`,
    )
  }
  // An empty edit set still needs one request: the save may be writing a
  // restored recovery session or carrying structural/rich payloads only.
  if (edits.length === 0) return [[]]
  const batches: WorkbookCellEdit[][] = []
  for (let start = 0; start < edits.length; start += SAVE_EDITS_CHUNK_MAX) {
    batches.push(edits.slice(start, start + SAVE_EDITS_CHUNK_MAX))
  }
  return batches
}
