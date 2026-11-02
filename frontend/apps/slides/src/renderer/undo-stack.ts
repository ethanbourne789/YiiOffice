/**
 * Snapshot-based undo/redo stack for the Slides renderer.
 *
 * Each snapshot is the serialized pptx (base64 bytes). On undo/redo, we
 * re-parse the snapshot to get a fresh OpenedPptx, then re-render.
 *
 * This approach is simple and correct: no need to manually merge partial
 * state. The tradeoff is CPU + memory for serialize/parse on each snapshot,
 * but pptx-engine's savePptx + openPptx are already fast for typical decks.
 */

import type { OpenedPptx } from '@yiioffice/pptx-engine'
import { savePptx, openPptx as openPptxFromBytes } from '@yiioffice/pptx-engine'
import { bytesToBase64, base64ToBytes } from '@yiioffice/pptx-engine/browser-compat'

const MAX_UNDO_LEVELS = 50

export interface UndoStack {
  /** Push current OpenedPptx as a new undo checkpoint (async — serializes archive) */
  push(opened: OpenedPptx): Promise<void>
  /** Undo to previous state; returns OpenedPptx or null */
  undo(): Promise<OpenedPptx | null>
  /** Redo to next state; returns OpenedPptx or null */
  redo(): Promise<OpenedPptx | null>
  /** Can undo? */
  canUndo(): boolean
  /** Can redo? */
  canRedo(): boolean
  /** Discard redo stack (called automatically before each push) */
  discardRedo(): void
  /** Clear all history (on save or new file) */
  clear(): void
}

/**
 * Create a new undo stack for slides editing.
 */
export async function createUndoStack(): Promise<UndoStack> {
  const past: string[] = []   // base64 snapshots
  const future: string[] = [] // base64 snapshots for redo

  return {
    async push(opened: OpenedPptx) {
      const bytes = await savePptx(opened)
      const base64 = bytesToBase64(bytes)
      past.push(base64)
      if (past.length > MAX_UNDO_LEVELS) past.shift()
      future.length = 0 // discard redo on new edit
    },

    async undo(): Promise<OpenedPptx | null> {
      if (past.length <= 1) return null
      // Current state is the last snapshot; move it to future
      const current = past.pop()!
      future.push(current)
      // Previous state becomes the new current
      const prev = past[past.length - 1]
      if (!prev) return null
      const bytes = base64ToBytes(prev)
      return openPptxFromBytes(bytes)
    },

    async redo(): Promise<OpenedPptx | null> {
      if (future.length === 0) return null
      const next = future.pop()!
      past.push(next)
      const bytes = base64ToBytes(next)
      return openPptxFromBytes(bytes)
    },

    canUndo(): boolean {
      return past.length >= 2
    },

    canRedo(): boolean {
      return future.length > 0
    },

    discardRedo() {
      future.length = 0
    },

    clear() {
      past.length = 0
      future.length = 0
    },
  }
}
