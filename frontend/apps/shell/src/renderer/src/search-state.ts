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
  /** the query is in flight and there is no page to show yet */
  | { kind: 'loading'; q: string }
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
  if (!q.trim()) return { kind: 'idle' }
  // the previous query's page must not be mistaken for this query's answer
  if (!page) return { kind: 'loading', q }
  if (page.unavailable) return { kind: 'unavailable', reason: page.unavailable.reason }
  // matches outrank the indexing banner: hiding them until the scan finishes
  // made search look broken on a large, still-indexing library
  if (page.hits.length > 0) return { kind: 'results', total: page.total }
  const index = page.index as unknown
  if (typeof index === 'object' && index !== null) {
    const pending = Number((index as { pending?: unknown }).pending ?? 0)
    const scanning = Boolean((index as { scanning?: unknown }).scanning)
    if (pending > 0 || scanning) return { kind: 'indexing', pending }
  }
  return { kind: 'no-results', q }
}
