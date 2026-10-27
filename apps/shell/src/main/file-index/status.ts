/**
 * Availability state of the on-disk file index.
 *
 * The index is a best-effort cache: if it cannot be opened (node:sqlite is a
 * Stability 1 API, the FTS5 extension may be missing, the profile directory
 * may be read-only) the app still has to work — but the user has to be told
 * that search is degraded. Returning an empty result list instead would read
 * as "no files match", which is a different and wrong statement.
 *
 * Kept free of Electron imports so the state machine is testable on its own.
 */

let unavailableReason: string | null = null

/** why the index is unavailable, or null when it works (or was never opened) */
export function indexUnavailableReason(): string | null {
  return unavailableReason
}

/** record that the index could not be opened; the reason is shown to the user */
export function markIndexUnavailable(reason: string): void {
  unavailableReason = reason
}

/** the index opened fine (or was closed) — back to normal */
export function markIndexAvailable(): void {
  unavailableReason = null
}
