import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetWorkbookSessionState,
  univerSession,
  type SupportedFunctionProbe,
} from '../src/renderer/univer-session-state'

const probe: SupportedFunctionProbe = { ready: () => true, supports: () => true }

/**
 * These fields decide cross-call behaviour for a whole workbook (crash
 * recovery, newest-reveal-wins, visual-undo tokens), so "what a new document
 * starts from" is worth pinning: a stale crash flag silently disables sidecar
 * recovery, and a stale token can answer an undo it does not belong to.
 */
describe('univer session state', () => {
  beforeEach(() => {
    resetWorkbookSessionState()
    univerSession().supportedFunctionProbe = null
  })

  it('starts a fresh workbook with no recovery or undo history', () => {
    expect(univerSession()).toMatchObject({
      revealGeneration: 0,
      sidecarCrashNotified: false,
      sessionRecoveryInFlight: null,
      visualUndoSequence: 0,
      supportedFunctionProbe: null,
    })
  })

  it('clears the workbook-scoped fields when a new workbook is opened', () => {
    const state = univerSession()
    state.revealGeneration = 7
    state.sidecarCrashNotified = true
    state.sessionRecoveryInFlight = Promise.resolve(true)
    state.visualUndoSequence = 42

    resetWorkbookSessionState()

    expect(state.revealGeneration).toBe(0)
    expect(state.sidecarCrashNotified).toBe(false)
    expect(state.sessionRecoveryInFlight).toBeNull()
    expect(state.visualUndoSequence).toBe(0)
  })

  it('keeps the function probe, which describes the engine rather than the file', () => {
    univerSession().supportedFunctionProbe = probe

    resetWorkbookSessionState()

    expect(univerSession().supportedFunctionProbe).toBe(probe)
  })

  it('resets in place so code holding the state object sees the new session', () => {
    const held = univerSession()
    held.visualUndoSequence = 3

    resetWorkbookSessionState()

    expect(univerSession()).toBe(held)
    expect(held.visualUndoSequence).toBe(0)
  })
})
