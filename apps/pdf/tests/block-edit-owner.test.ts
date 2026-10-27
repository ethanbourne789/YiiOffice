/** Ownership rules between a clustered text block and the pending text edits that
    may already be editing it. Every branch is decided by rects and strings, which
    is exactly what made it worth pulling out of App: before this, a wrong answer
    only surfaced as a duplicated edit or a lost preview on a live page. */

import { describe, expect, it } from 'vitest'
import {
  blockClaimEdits,
  blockDrawRect,
  blockOverlapEdit,
  blockOwnerEdit,
  overlapOfRects,
  pendingEditForBlock,
} from '../src/renderer/block-edit-owner'
import type { LocalTextEdit } from '../src/renderer/text-edit-preview'
import type { BlockLine, TextBlock } from '../src/renderer/text-block'

const line = (rect: [number, number, number, number], text: string): BlockLine => ({
  rect,
  text,
  y: rect[1],
  fontSize: 11,
})

const block = (
  rect: [number, number, number, number],
  lines: BlockLine[],
  align: TextBlock['align'] = 'left',
): TextBlock => ({
  rect,
  fontSize: 11,
  lineHeight: 13.2,
  align,
  lines,
})

const edit = (
  id: string,
  rect: [number, number, number, number],
  extra: Partial<LocalTextEdit> = {},
  pageIndex = 0,
  oldText = 'same text',
): LocalTextEdit => ({
  id,
  input: { pageIndex, rect, oldText, newText: '', fontSize: 11 },
  ...extra,
})

describe('overlapOfRects', () => {
  it('is zero for disjoint and edge-touching boxes', () => {
    expect(overlapOfRects([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0)
    expect(overlapOfRects([0, 0, 10, 10], [10, 0, 20, 10])).toBe(0)
  })

  it('measures against the smaller box, so any containment is 1', () => {
    expect(overlapOfRects([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1)
    expect(overlapOfRects([0, 0, 10, 10], [2, 2, 8, 8])).toBe(1)
    // a thin sliver inside the block is still full containment of the sliver
    expect(overlapOfRects([0, 0, 10, 10], [0, 0, 10, 5])).toBe(1)
    // half of the smaller box only when the smaller box straddles the edge
    expect(overlapOfRects([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(0.5)
    expect(overlapOfRects([0, 0, 10, 10], [0, 5, 10, 15])).toBeCloseTo(0.5)
  })
})

describe('pendingEditForBlock', () => {
  const single = block([100, 700, 200, 720], [line([100, 700, 200, 720], 'Total')])

  it('finds nothing when the page has no pending edits', () => {
    expect(pendingEditForBlock(0, single, [])).toBeUndefined()
    expect(pendingEditForBlock(0, single, [edit('e1', [100, 700, 200, 720], {}, 3)])).toBeUndefined()
  })

  it('matches a block edit by rect key rather than by text', () => {
    const e = edit('e1', [100, 700, 200, 720], {}, 0, 'entirely different words')
    expect(pendingEditForBlock(0, single, [e])).toBe(e)
  })

  it('treats rects equal at the key precision as the same block', () => {
    const e = edit('e1', [100, 700, 200.001, 720])
    expect(pendingEditForBlock(0, single, [e])).toBe(e)
  })

  it('lets a line edit that covers the whole block own it', () => {
    // the line edit's rect is the run span, not the block extent: the text match
    // is the only thing tying the two together
    const e = edit('e1', [120, 702, 180, 716], {}, 0, '  Total ')
    expect(pendingEditForBlock(0, single, [e])).toBe(e)
  })

  it('does not claim a block whose text it only partly covers', () => {
    const e = edit('e1', [120, 702, 180, 716], {}, 0, 'Tot')
    expect(pendingEditForBlock(0, single, [e])).toBeUndefined()
  })

  it('does not claim a block it sits outside of, even with matching text', () => {
    const e = edit('e1', [400, 702, 480, 716], {}, 0, 'Total')
    expect(pendingEditForBlock(0, single, [e])).toBeUndefined()
  })

  it('prefers the exact rect over an earlier text match', () => {
    const byText = edit('byText', [120, 702, 180, 716], {}, 0, 'Total')
    const byRect = edit('byRect', [100, 700, 200, 720], {}, 0, 'other')
    expect(pendingEditForBlock(0, single, [byText, byRect])?.id).toBe('byRect')
  })

  it('never claims a block with no text to compare', () => {
    const empty = block([100, 700, 200, 720], [line([100, 700, 200, 720], '   ')])
    const e = edit('e1', [120, 702, 180, 716], {}, 0, '')
    expect(pendingEditForBlock(0, empty, [e])).toBeUndefined()
  })

  it('joins multi-line block text the way the extractor does', () => {
    // CJK lines join with no separator, Latin ones with a space; both collapse
    // under the whitespace-insensitive comparison with the edit's oldText
    const cjk = block([100, 680, 200, 720], [
      line([100, 700, 200, 720], '应付'),
      line([100, 680, 200, 700], '账款'),
    ])
    // a sub-span rect, so the match cannot short-circuit on the rect key
    const span = [120, 690, 180, 710] as [number, number, number, number]
    const joined = edit('joined', span, {}, 0, '应付 账款')
    expect(pendingEditForBlock(0, cjk, [joined])).toBe(joined)
    // the same edit over one line's text does not cover the whole block
    const half = edit('half', span, {}, 0, '应付')
    expect(pendingEditForBlock(0, cjk, [half])).toBeUndefined()
    // and a whole-block rect wins on the key before any text is compared
    const whole = edit('whole', [100, 680, 200, 720], {}, 0, '应付账款')
    expect(pendingEditForBlock(0, cjk, [whole])).toBe(whole)
  })
})

describe('blockClaimEdits', () => {
  const b = block([100, 700, 200, 720], [line([100, 700, 200, 720], 'Total')])

  it('claims at half overlap of the smaller box and rejects less', () => {
    const half = edit('half', [100, 690, 200, 710])
    // 6pt of a 16pt-tall edit inside the block: 0.375 of the smaller box
    const sliver = edit('sliver', [100, 690, 200, 706])
    expect(blockClaimEdits(0, b, [half]).map((e) => e.id)).toEqual(['half'])
    expect(blockClaimEdits(0, b, [sliver])).toEqual([])
  })

  it('keeps the source order of claimants', () => {
    const a = edit('a', [100, 700, 200, 715])
    const c = edit('c', [100, 705, 200, 720])
    expect(blockClaimEdits(0, b, [a, c]).map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('ignores claims on another page', () => {
    expect(blockClaimEdits(0, b, [edit('e1', [100, 700, 200, 720], {}, 2)])).toEqual([])
  })

  it('returns the first claimant as the overlapping edit', () => {
    const a = edit('a', [100, 700, 200, 715])
    const c = edit('c', [100, 705, 200, 720])
    expect(blockOverlapEdit(0, b, [a, c])?.id).toBe('a')
    expect(blockOverlapEdit(0, b, [])).toBeUndefined()
  })
})

describe('blockOwnerEdit', () => {
  it('falls back to the geometric claimant for a single-line block', () => {
    const b = block([100, 700, 200, 720], [line([100, 700, 200, 720], 'Total')])
    // the edit's text covers more than the block, so neither text matcher fires
    const e = edit('e1', [100, 700, 200, 715], {}, 0, 'Total and more')
    expect(blockOwnerEdit(0, b, [e])).toBe(e)
  })

  it('keeps a multi-line block on the text matchers so folding still works', () => {
    const b = block([100, 680, 200, 720], [
      line([100, 700, 200, 720], 'first'),
      line([100, 680, 200, 700], 'second'),
    ])
    const rowEdit = edit('e1', [100, 700, 200, 715], {}, 0, 'first and more')
    expect(blockOwnerEdit(0, b, [rowEdit])).toBeUndefined()
  })

  it('prefers the text match over the geometric one', () => {
    const b = block([100, 700, 200, 720], [line([100, 700, 200, 720], 'Total')])
    const byText = edit('byText', [120, 702, 180, 716], {}, 0, 'Total')
    const byRect = edit('byRect', [100, 700, 200, 710], {}, 0, 'other')
    expect(blockOwnerEdit(0, b, [byRect, byText])?.id).toBe('byText')
  })
})

describe('blockDrawRect', () => {
  const b = block([100, 700, 200, 720], [line([100, 700, 200, 720], 'Total')])

  it('draws an unowned block at its own rect', () => {
    expect(blockDrawRect(0, b, [])).toEqual([100, 700, 200, 720])
  })

  it('follows the pending move while the block keeps its original rect', () => {
    // input.rect is the save-time match key and must not move; only the preview does
    const moving = edit('e1', [100, 700, 200, 720], { moveBy: [12, -30] })
    expect(blockDrawRect(0, b, [moving])).toEqual([112, 670, 212, 690])
    expect(moving.input.rect).toEqual([100, 700, 200, 720])
  })

  it('still owns the block mid-move, so a second drag addresses the same edit', () => {
    const moving = edit('e1', [100, 700, 200, 720], { moveBy: [12, -30] })
    expect(pendingEditForBlock(0, b, [moving])?.id).toBe('e1')
  })
})
