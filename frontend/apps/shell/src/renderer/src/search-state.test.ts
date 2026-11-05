import { describe, expect, it } from 'vitest'
import type { FileSearchPage } from '../../shared/home-api'
import { searchViewState } from './search-state'

type Page = FileSearchPage

const page = (over: Partial<Page> = {}): Page => ({
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
  ...over,
})

const hit = {} as unknown as Page['hits'][number]

describe('searchViewState', () => {
  it('is idle for a blank query even when a stale page exists', () => {
    expect(searchViewState(page(), '   ')).toEqual({ kind: 'idle' })
    expect(searchViewState(page({ hits: [hit], total: 1 }), '')).toEqual({ kind: 'idle' })
  })

  it('waits for the first page instead of claiming no results', () => {
    expect(searchViewState(null, 'report')).toEqual({ kind: 'loading', q: 'report' })
  })

  it('distinguishes an unavailable index from an empty result', () => {
    expect(searchViewState(page({ unavailable: { reason: 'index not initialized' } }), 'report'))
      .toEqual({ kind: 'unavailable', reason: 'index not initialized' })
  })

  it('keeps visible hits even while the initial scan is still running', () => {
    const scanning = page({
      hits: [hit],
      total: 3,
      index: { indexed: 1, pending: 200, scanning: true },
    })
    expect(searchViewState(scanning, 'report')).toEqual({ kind: 'results', total: 3 })
  })

  it('reports indexing when no hit was found but work is queued', () => {
    const pending = page({ index: { indexed: 0, pending: 12, scanning: true } })
    expect(searchViewState(pending, 'report')).toEqual({ kind: 'indexing', pending: 12 })
  })

  it('reports no-results only for a healthy, idle index', () => {
    expect(searchViewState(page(), 'report')).toEqual({ kind: 'no-results', q: 'report' })
  })
})
