/**
 * The renderer's mutable singletons, gathered in one place.
 *
 * These values used to be module-level `let`s scattered across eight thousand
 * lines of `univer-sync.ts`. That hid two things: they are global to the
 * renderer process, and every one of them except the function probe belongs to
 * a *workbook session* — so switching files has to clear it. `visualUndoSequence`
 * makes the point sharpest: it only means anything next to the registry of
 * tokens it allocates, and clearing the registry without resetting the counter
 * (or the reverse) lets a stale step answer a token from the new document.
 *
 * The probe is here for the same reason but has a different owner: the registry
 * installer sets it and nulls it on dispose, so a workbook switch must leave it
 * alone. `resetWorkbookSessionState` therefore resets everything but that.
 */

export interface SupportedFunctionProbe {
  /// False until the engine has registered its builtins — the registry says
  /// nothing about support before that, so no verdict is memoised.
  readonly ready: () => boolean
  /// Whether the engine implements a function, by canonical name
  /// (uppercase, storage markers stripped).
  readonly supports: (name: string) => boolean
}

export interface UniverSessionState {
  /// Newest reveal wins: rapid Find Next/Previous must not let an older
  /// correction loop keep scrolling after a newer one started.
  revealGeneration: number
  /// The main process reported the sidecar died. Recovery is driven by that
  /// notification, not by an error message (sheets-main and the Rust sidecar
  /// both reject an unknown session with the same text that Save and
  /// closeWorkbook produce on purpose).
  sidecarCrashNotified: boolean
  /// The recovery currently running, shared by every concurrent reader so one
  /// crash produces one re-open instead of one per in-flight read.
  sessionRecoveryInFlight: Promise<boolean> | null
  /// Token source for the visual-undo registry (issued in insertion order, so
  /// the registry's oldest key is its coldest entry).
  visualUndoSequence: number
  /// Engine function registry. Owned by `function-registry-probe.ts`; kept here
  /// so that "what survives a call" is answered in one place.
  supportedFunctionProbe: SupportedFunctionProbe | null
}

const state: UniverSessionState = {
  revealGeneration: 0,
  sidecarCrashNotified: false,
  sessionRecoveryInFlight: null,
  visualUndoSequence: 0,
  supportedFunctionProbe: null,
}

/**
 * The live state object. Always read a field off this object rather than
 * keeping a copy: the object is stable, the fields are not (a reset mutates
 * them in place so that in-flight code holding the reference still sees the
 * reset).
 */
export function univerSession(): UniverSessionState {
  return state
}

/**
 * Start a fresh workbook session in this renderer. Leaves the function probe
 * alone — it describes the engine's registry, not the open document.
 */
export function resetWorkbookSessionState(): void {
  state.revealGeneration = 0
  state.sidecarCrashNotified = false
  state.sessionRecoveryInFlight = null
  state.visualUndoSequence = 0
}
