/** Which pending text edit owns a clustered text block (PDF user space).

    The editor keeps two views of the same text: a clustered `TextBlock` (what the
    page draws and what the pointer hovers) and a `LocalTextEdit` (what the engine
    will match at save time, keyed by `input.rect`). Those two rects are only equal
    when the edit covers the block itself — a line edit's rect is the run span, not
    the block extent — so "is this block already being edited" cannot be an identity
    test. Getting it wrong is not cosmetic: a drag that fails to recognise its own
    pending edit drafts a second one over the same text objects, and a paragraph
    that folds in a line edit loses that edit's preview.

    Two matchers answer it, in order: an exact rect key (block edits and block moves
    carry the block's own rect), then a geometric/text pair (a single-line block
    whose whole text a line edit covers). Line edits that cover MORE than the block
    — a DOM visual line joining runs the clustering split into neighbours — match by
    neither, so a third, purely geometric matcher claims them for the drag visuals.

    Kept out of App so the rules can be exercised directly: every branch here is
    decided by rects and strings, none of it needs a rendered page. */

import type { TextBlock } from './text-block'
import { blockRectKey, shiftRect } from './text-edit-preview'
import type { LocalTextEdit } from './text-edit-preview'
import { joinBlockLines } from './text-wrap'

/** Overlap of two PDF rects as a fraction of the smaller one (0 = disjoint) */
export function overlapOfRects(a: readonly number[], b: readonly number[]): number {
  const ox = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!)
  const oy = Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!)
  if (ox <= 0 || oy <= 0) return 0
  const aArea = (a[2]! - a[0]!) * (a[3]! - a[1]!)
  const bArea = (b[2]! - b[0]!) * (b[3]! - b[1]!)
  return (ox * oy) / Math.min(aArea, bArea)
}

/** Pending edit addressing this clustered block: block edits and block moves keep
    the block's own rect as their input.rect (the save-time match key), so those
    match by exact rect key. A LINE edit whose text covers the whole block (the
    single-line block case — its rect is the line span, not the block rect) owns
    the block just the same: moving/reopening the block must address that edit,
    not draft a colliding second one over the same objects. */
export function pendingEditForBlock(
  origIdx: number,
  block: TextBlock,
  edits: readonly LocalTextEdit[],
): LocalTextEdit | undefined {
  const pageEdits = edits.filter((te) => te.input.pageIndex === origIdx)
  if (pageEdits.length === 0) return undefined
  const key = blockRectKey(block.rect)
  const exact = pageEdits.find((te) => blockRectKey(te.input.rect) === key)
  if (exact) return exact
  const blockText = joinBlockLines(block.lines.map((l) => l.text)).replace(/\s+/g, '')
  if (!blockText) return undefined
  return pageEdits.find((te) => {
    const r = te.input.rect
    const cx = (r[0] + r[2]) / 2
    const cy = (r[1] + r[3]) / 2
    return (
      cx >= block.rect[0] &&
      cx <= block.rect[2] &&
      cy >= block.rect[1] &&
      cy <= block.rect[3] &&
      te.input.oldText.replace(/\s+/g, '') === blockText
    )
  })
}

/** Pending edits that geometrically claim (part of) this block: rect overlap of at
    least half the smaller box. Catches everything the text matchers miss — a DOM
    visual line can join runs the clustering buckets into a neighboring block
    (slightly raised labels, superscripts), so a line edit's oldText covers MORE
    than the block and no text comparison lines up; likewise line edits inside a
    multi-line paragraph claim their row. Drag visuals let these previews follow
    the pointer and the ghost skips the rows they cover. */
export function blockClaimEdits(
  origIdx: number,
  block: TextBlock,
  edits: readonly LocalTextEdit[],
): LocalTextEdit[] {
  return edits.filter(
    (te) => te.input.pageIndex === origIdx && overlapOfRects(te.input.rect, block.rect) >= 0.5,
  )
}

export function blockOverlapEdit(
  origIdx: number,
  block: TextBlock,
  edits: readonly LocalTextEdit[],
): LocalTextEdit | undefined {
  return blockClaimEdits(origIdx, block, edits)[0]
}

/** The edit whose move/preview the block's drag visuals must follow. Single-line
    blocks fall back to geometric ownership (nothing to fold there anyway);
    multi-line blocks stay on the text matchers so paragraph folding keeps
    handling embedded line edits. */
export function blockOwnerEdit(
  origIdx: number,
  block: TextBlock,
  edits: readonly LocalTextEdit[],
): LocalTextEdit | undefined {
  return (
    pendingEditForBlock(origIdx, block, edits) ??
    (block.lines.length === 1 ? blockOverlapEdit(origIdx, block, edits) : undefined)
  )
}

/** Where the block currently draws: its rect shifted by any pending move */
export function blockDrawRect(
  origIdx: number,
  block: TextBlock,
  edits: readonly LocalTextEdit[],
): [number, number, number, number] {
  const mv = blockOwnerEdit(origIdx, block, edits)?.moveBy
  return mv ? shiftRect(block.rect, mv) : block.rect
}
