import type { FileSearchPage } from '../../shared/home-api'

/**
 * What the search results area should show.
 *
 * The index is a best-effort cache. When it cannot be opened, searching returns
 * nothing — and an empty list reads as "no files match", which is a different
 * and wrong statement. The renderer therefore has to be able to tell "the
 * index is down" apart from "nothing matched", so the decision lives here
 * rather than inline in the component.
 */

export type SearchViewState =
  | { kind: 'idle' }
  /** the index is open and still catching up with the file system */
  | { kind: 'indexing'; pending: number }
  /** the index is down; `reason` explains why (may be empty) */
  | { kind: 'unavailable'; reason: string }
  /** the index works and matched nothing */
  | { kind: 'no-results'; q: string }
  /** the index works and matched something */
  | { kind: 'results'; total: number }

/** the state the search results area is in, given the last search page */
export function searchViewState(page: FileSearchPage | null, q: string): SearchViewState {
  if (!page) return { kind: 'idle' }
  if (page.unavailable) return { kind: 'unavailable', reason: page.unavailable.reason }
  if (page.index.pending > 0 || page.index.scanning) {
    return { kind: 'indexing', pending: page.index.pending }
  }
  if (page.hits.length === 0) return { kind: 'no-results', q }
  return { kind: 'results', total: page.total }
}
