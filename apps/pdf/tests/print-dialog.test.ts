/** Print range dialog: which pages, and what a bad range does. */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrintDialog, usePrintDialog } from '../src/renderer/PrintDialog'
import type { TFunc } from '../src/renderer/i18n/locale'
import { actRun, renderHook, type RenderedHook } from './helpers/render-hook'

// Identity translator: keeps the test independent of locale data
const t = ((key: string) => key) as unknown as TFunc

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let container: HTMLDivElement | null = null
let hook: RenderedHook<unknown> | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  await hook?.unmount()
  hook = null
})

const state = (): ReturnType<typeof usePrintDialog> =>
  hook!.current as ReturnType<typeof usePrintDialog>

describe('usePrintDialog', () => {
  it('opens on all pages, seeded with the page the user is looking at', async () => {
    hook = await renderHook(() => usePrintDialog())
    await actRun(() => state().show(4))
    expect(state().isOpen).toBe(true)
    expect(state().mode).toBe('all')
    // the seed is only used if the user switches to "current page"
    expect(state().input).toBe('4')
    expect(state().invalid).toBe(false)
  })

  it('starts from all pages again on every open', async () => {
    hook = await renderHook(() => usePrintDialog())
    await actRun(() => state().show(1))
    await actRun(() => state().setMode('custom'))
    await actRun(() => state().close())
    await actRun(() => state().show(2))
    // printing writes paper: a previous range must not carry over
    expect(state().mode).toBe('all')
  })

  it('keeps the typed range across mode switches and clears the mark on edit', async () => {
    hook = await renderHook(() => usePrintDialog())
    await actRun(() => state().show(1))
    await actRun(() => state().setMode('custom'))
    await actRun(() => state().editInput('2-3'))
    await actRun(() => state().fail())
    expect(state().invalid).toBe(true)

    await actRun(() => state().editInput('2-4'))
    expect(state().invalid).toBe(false)
    expect(state().input).toBe('2-4')
    expect(state().isOpen).toBe(true)
  })
})

describe('PrintDialog', () => {
  async function renderPrint(overrides: {
    mode?: 'all' | 'current' | 'custom'
    invalid?: boolean
    onConfirm?: () => void
    onCancel?: () => void
  }): Promise<HTMLDivElement> {
    const base = {
      isOpen: true,
      mode: overrides.mode ?? ('all' as const),
      input: '2-3',
      invalid: overrides.invalid ?? false,
      show: () => {},
      setMode: () => {},
      editInput: () => {},
      close: overrides.onCancel ?? (() => {}),
      fail: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(PrintDialog, {
          t,
          currentPage: 3,
          state: base,
          onConfirm: overrides.onConfirm ?? (() => {}),
        }),
      )
      await Promise.resolve()
    })
    return container
  }

  it('offers the three ranges and names the current page', async () => {
    const el = await renderPrint({})
    const radios = el.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(3)
    expect(radios[0]!.checked).toBe(true)
    expect(el.textContent).toContain('(3)')
    // the ok button says what it does, not the generic "ok"
    expect(el.querySelector('[data-cmd="dialogOk"]')!.textContent).toBe('print')
  })

  it('only shows the range field for a custom range', async () => {
    expect((await renderPrint({})).querySelector('[data-cmd="dialogInput"]')).toBeNull()
    const custom = await renderPrint({ mode: 'custom' })
    expect(custom.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!.value).toBe('2-3')
  })

  it('marks a rejected range and keeps the dialog open', async () => {
    const el = await renderPrint({ mode: 'custom', invalid: true })
    expect(el.querySelector('[data-cmd="dialogInput"]')!.className).toContain('invalid')
  })

  it('confirms on Enter and cancels on the backdrop', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const el = await renderPrint({ mode: 'custom', onConfirm, onCancel })

    await act(async () => {
      el.querySelector<HTMLElement>('[data-cmd="dialogInput"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => {
      el.querySelector<HTMLElement>('.pdf-modal-mask')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
