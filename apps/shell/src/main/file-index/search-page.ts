/**
 * The search result page when the index is unavailable.
 *
 * Split out of the IPC handler so the "what does the user see when the index
 * is down" decision is testable without an Electron app, and so the shape
 * cannot drift between the handler and the renderer.
 */

import type { FileSearchPage } from '../../shared/home-api'

/** an empty page, as if the index had simply not matched anything */
export function emptySearchPage(): FileSearchPage {
  return { hits: [], total: 0, index: { indexed: 0, pending: 0, scanning: false } }
}

/**
 * The page to return when the index could not be opened. It carries the reason
 * so the renderer can say the feature is down; without it the user would read
 * an empty list as "no files match".
 */
export function unavailableSearchPage(reason: string): FileSearchPage {
  return { ...emptySearchPage(), unavailable: { reason } }
}
