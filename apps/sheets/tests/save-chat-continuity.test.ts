/**
 * Saving swaps the sidecar session, which the App reads as "a workbook
 * opened" and rehydrates the AI transcript from the store; the live turn then
 * shows twice. The save path must mark its reopen as continuing the chat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSave, type SaveContext } from '../src/renderer/save-actions'
import { createEditJournal, recordSetRangeValues } from '../src/renderer/edit-journal'
import { t } from '../src/renderer/i18n/locale'

const saveWorkbookEdits = vi.fn()
const writeWorkbookRecovery = vi.fn()

beforeEach(() => {
  saveWorkbookEdits.mockReset()
  writeWorkbookRecovery.mockReset().mockResolvedValue({ ok: true })
  ;(globalThis as unknown as { window: unknown }).window = {
    desktopApi: { saveWorkbookEdits, writeWorkbookRecovery },
  }
})

function ctxWith(): {
  ctx: SaveContext
  openLazyWorkbook: ReturnType<typeof vi.fn>
  messages: string[]
} {
  const journal = createEditJournal()
  recordSetRangeValues(journal, 'sheet-1', { 0: { 0: { v: 'edited' } } })
  const openLazyWorkbook = vi.fn()
  const messages: string[] = []
  return {
    openLazyWorkbook,
    messages,
    ctx: {
      univerRef: { current: null },
      stashViewRestore: () => {},
      lazyWorkbookRef: {
        current: {
          editJournal: journal,
          recalc: {
            timer: null,
            generation: 0,
            failed: false,
            formulaCells: new Map(),
            overlay: new Map(),
          },
          flags: { preloadComplete: true },
          file: {
            sessionId: '11111111-1111-4111-8111-111111111111',
            needsSaveAs: false,
            restoredFromRecovery: false,
          },
        },
      } as never,
      setMessage: (message: string) => {
        messages.push(message)
      },
      openLazyWorkbook,
    },
  }
}

describe('handleSave reopen keeps the AI conversation', () => {
  it('reopens the saved workbook as a continuation of the same chat', async () => {
    const file = { sessionId: '22222222-2222-4222-8222-222222222222', path: '/tmp/a.xlsx' }
    saveWorkbookEdits.mockResolvedValue({ canceled: false, file })
    const { ctx, openLazyWorkbook, messages } = ctxWith()
    // A successful reopen swaps in a fresh session state for the same chat.
    openLazyWorkbook.mockImplementation(async () => {
      ;(ctx.lazyWorkbookRef as { current: unknown }).current = {
        editJournal: createEditJournal(),
        recalc: {
          timer: null,
          generation: 0,
          failed: false,
          formulaCells: new Map(),
          overlay: new Map(),
        },
        flags: { preloadComplete: true },
        file,
      }
      return true
    })
    const outcome = await handleSave(ctx, 'save')
    expect(outcome.ok).toBe(true)
    expect(openLazyWorkbook).toHaveBeenCalledTimes(1)
    expect(openLazyWorkbook).toHaveBeenCalledWith(file, { continueChat: true })
    expect(messages.at(-1)).toBe(t('appSaved'))
  })

  it('still reports success when the committed editor rejects the reopen', async () => {
    const file = { sessionId: '33333333-3333-4333-8333-333333333333', path: '/tmp/a.xlsx' }
    saveWorkbookEdits.mockResolvedValue({ canceled: false, file })
    const { ctx, openLazyWorkbook, messages } = ctxWith()
    openLazyWorkbook.mockResolvedValue(false)

    // The file is already on disk — a failed reopen must not report "save
    // failed" and make the user retry a save that already landed. The final
    // status is the "saved, but could not reopen" warning, not a plain
    // success line that would hide what the user must act on.
    await expect(handleSave(ctx, 'save')).resolves.toEqual({ ok: true, path: '/tmp/a.xlsx' })
    expect(openLazyWorkbook).toHaveBeenCalledTimes(1)
    // The warning is the final status — it must not be overwritten by the
    // plain "saved" line.
    expect(messages.at(-1)).toBe(t('appSaveReopenFailed'))
  })

  it('a canceled save never reopens', async () => {
    saveWorkbookEdits.mockResolvedValue({ canceled: true })
    const { ctx, openLazyWorkbook } = ctxWith()
    await handleSave(ctx, 'save')
    expect(openLazyWorkbook).not.toHaveBeenCalled()
  })
})
