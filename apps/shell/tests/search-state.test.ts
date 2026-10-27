import { describe, expect, it } from 'vitest'
import { searchViewState } from '../src/renderer/src/search-state'
import type { FileSearchPage } from '../src/shared/home-api'

const page = (over: Partial<FileSearchPage> = {}): FileSearchPage => ({
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
  ...over,
})

describe('search view state', () => {
  it('is idle before the first search comes back', () => {
    expect(searchViewState(null, 'plan')).toEqual({ kind: 'idle' })
  })

  it('reports the index as down when the page carries a reason', () => {
    const state = searchViewState(
      page({ unavailable: { reason: 'FTS5 is missing' } }),
      'plan',
    )
    expect(state).toEqual({ kind: 'unavailable', reason: 'FTS5 is missing' })
  })

  it('reports "down", not "no results", when the index is unavailable', () => {
    // the whole point of the flag: an empty list must not read as "no matches"
    const state = searchViewState(page({ unavailable: { reason: 'boom' } }), 'plan')
    expect(state.kind).not.toBe('no-results')
  })

  it('reports no results only when the index works and nothing matched', () => {
    expect(searchViewState(page(), 'plan')).toEqual({ kind: 'no-results', q: 'plan' })
  })

  it('reports the pending count while the index catches up', () => {
    const state = searchViewState(page({ index: { indexed: 3, pending: 7, scanning: true } }), '')
    expect(state).toEqual({ kind: 'indexing', pending: 7 })
  })

  it('reports results once hits come back', () => {
    const hit = {
      path: '/a/plan.docx',
      name: 'plan.docx',
      mtimeMs: 1,
      sizeBytes: 1,
      needles: ['plan'],
    }
    const state = searchViewState(
      page({ hits: [hit], total: 1 }),
      'plan',
    )
    expect(state).toEqual({ kind: 'results', total: 1 })
  })

  it('an unavailable index wins over a pending scan', () => {
    // the index cannot be open and scanning at the same time; the down state
    // is the one the user needs to see
    const state = searchViewState(
      page({
        unavailable: { reason: 'boom' },
        index: { indexed: 0, pending: 5, scanning: true },
      }),
      'plan',
    )
    expect(state.kind).toBe('unavailable')
  })
})
