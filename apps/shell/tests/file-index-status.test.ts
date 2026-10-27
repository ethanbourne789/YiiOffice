import { afterEach, describe, expect, it } from 'vitest'
import {
  indexUnavailableReason,
  markIndexAvailable,
  markIndexUnavailable,
} from '../src/main/file-index/status'
import { emptySearchPage, unavailableSearchPage } from '../src/main/file-index/search-page'

afterEach(() => {
  markIndexAvailable()
})

describe('file index availability', () => {
  it('starts out available', () => {
    expect(indexUnavailableReason()).toBeNull()
  })

  it('keeps the reason the index could not be opened', () => {
    markIndexUnavailable('no such module: node:sqlite')
    expect(indexUnavailableReason()).toBe('no such module: node:sqlite')
  })

  it('clears the reason once the index opens', () => {
    markIndexUnavailable('FTS5 is missing')
    markIndexAvailable()
    expect(indexUnavailableReason()).toBeNull()
  })

  it('reports the most recent failure', () => {
    markIndexUnavailable('first')
    markIndexUnavailable('second')
    expect(indexUnavailableReason()).toBe('second')
  })
})

describe('search page when the index is down', () => {
  it('an empty page carries no availability flag', () => {
    const page = emptySearchPage()
    expect(page.hits).toEqual([])
    expect(page.total).toBe(0)
    expect(page.index).toEqual({ indexed: 0, pending: 0, scanning: false })
    // absent, not undefined-valued: the renderer checks truthiness
    expect(page.unavailable).toBeUndefined()
  })

  it('an unavailable page says why, so the UI does not read it as "no matches"', () => {
    const page = unavailableSearchPage('FTS5 is missing')
    expect(page.unavailable).toEqual({ reason: 'FTS5 is missing' })
    expect(page.hits).toEqual([])
    expect(page.total).toBe(0)
  })

  it('an unavailable page is distinguishable from an empty one', () => {
    // the whole point: "search is down" must not look like "nothing matched"
    expect(unavailableSearchPage('boom').unavailable).toBeDefined()
    expect(emptySearchPage().unavailable).toBeUndefined()
  })
})
