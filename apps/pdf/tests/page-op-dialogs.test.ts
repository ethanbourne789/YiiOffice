/** The page-operation dialogs were six inline blocks in the editor component:
    four of them were the same "type a range" prompt, each carrying its own
    `open` / `value` / `invalid` triple. They live in `PageOpDialogs` now, which
    means they can be tested without mounting the editor.

    Two things are pinned here that the inline versions could only get wrong
    silently: the merge dialog must start from its defaults on every open (a
    previous run's options used to be carried over by not resetting them), and a
    rejected confirm must keep the dialog open with the field marked. */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  MergePagesDialog,
  RangeDialog,
  useMergeDialog,
  useTextEntry,
} from '../src/renderer/PageOpDialogs'
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

describe('useTextEntry', () => {
  it('opens with the given value and a clean field', async () => {
    hook = await renderHook(() => useTextEntry())
    const entry = (): ReturnType<typeof useTextEntry> =>
      hook!.current as ReturnType<typeof useTextEntry>

    expect(entry().isOpen).toBe(false)
    await actRun(() => entry().show('3'))
    expect(entry().isOpen).toBe(true)
    expect(entry().value).toBe('3')
    expect(entry().invalid).toBe(false)
  })

  it('clears the rejection mark as soon as the value is edited', async () => {
    hook = await renderHook(() => useTextEntry())
    const entry = (): ReturnType<typeof useTextEntry> =>
      hook!.current as ReturnType<typeof useTextEntry>

    await actRun(() => entry().show(''))
    await actRun(() => entry().fail())
    expect(entry().invalid).toBe(true)
    // still open: a rejected confirm must not close the dialog
    expect(entry().isOpen).toBe(true)

    await actRun(() => entry().edit('1-2'))
    expect(entry().invalid).toBe(false)
    expect(entry().value).toBe('1-2')
  })

  it('keeps the typed value after a cancel so a reopen resets it', async () => {
    hook = await renderHook(() => useTextEntry())
    const entry = (): ReturnType<typeof useTextEntry> =>
      hook!.current as ReturnType<typeof useTextEntry>

    await actRun(() => entry().show('1'))
    await actRun(() => entry().edit('9'))
    await actRun(() => entry().close())
    expect(entry().isOpen).toBe(false)
    expect(entry().value).toBe('9')

    await actRun(() => entry().show('2'))
    expect(entry().value).toBe('2')
  })
})

describe('useMergeDialog', () => {
  it('starts every open from the defaults', async () => {
    hook = await renderHook(() => useMergeDialog())
    const merge = (): ReturnType<typeof useMergeDialog> =>
      hook!.current as ReturnType<typeof useMergeDialog>

    await actRun(() => merge().show())
    await actRun(() => merge().editCount('5'))
    await actRun(() => merge().setDirection('horizontal'))
    await actRun(() => merge().setSeparator(true))
    await actRun(() => merge().close())

    await actRun(() => merge().show())
    expect(merge().count).toBe('2')
    expect(merge().direction).toBe('vertical')
    expect(merge().separator).toBe(false)
    expect(merge().invalid).toBe(false)
  })
})

describe('RangeDialog', () => {
  async function renderRange(overrides: {
    onConfirm?: () => void
    onCancel?: () => void
    invalid?: boolean
  }): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(RangeDialog, {
          t,
          title: 'extractRangeTitle',
          hint: 'extractRangeHint',
          value: '1-2',
          invalid: overrides.invalid ?? false,
          onChange: () => {},
          onConfirm: overrides.onConfirm ?? (() => {}),
          onCancel: overrides.onCancel ?? (() => {}),
        }),
      )
      await Promise.resolve()
    })
    return container
  }

  it('is a labelled modal dialog holding the current value', async () => {
    const el = await renderRange({})
    const node = el.querySelector('[role="dialog"]')
    expect(node).not.toBeNull()
    expect(node!.getAttribute('aria-modal')).toBe('true')
    expect(node!.getAttribute('aria-label')).toBe('extractRangeTitle')
    expect(el.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!.value).toBe('1-2')
  })

  it('marks the field when the last confirm was rejected', async () => {
    const el = await renderRange({ invalid: true })
    expect(el.querySelector('[data-cmd="dialogInput"]')!.className).toContain('invalid')
  })

  it('confirms on Enter and cancels on Escape from any focus position', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const el = await renderRange({ onConfirm, onCancel })

    await act(async () => {
      el.querySelector<HTMLElement>('[data-cmd="dialogInput"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Escape goes through the shared modal contract (window-level listener), so
    // it fires even when focus has moved off the input -- and only once
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels from the backdrop and the cancel button but not the card', async () => {
    const onCancel = vi.fn()
    const el = await renderRange({ onCancel })

    await act(async () => {
      el.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(onCancel).not.toHaveBeenCalled()

    await act(async () => {
      el.querySelector<HTMLElement>('.pdf-modal-mask')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await Promise.resolve()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)

    await act(async () => {
      el.querySelector<HTMLElement>('[data-cmd="dialogCancel"]')!.click()
      await Promise.resolve()
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})

describe('MergePagesDialog', () => {
  it('renders the options it is given and confirms with them', async () => {
    const onConfirm = vi.fn()
    const state = {
      isOpen: true,
      count: '3',
      invalid: false,
      direction: 'horizontal' as const,
      separator: true,
      show: () => {},
      editCount: () => {},
      setDirection: () => {},
      setSeparator: () => {},
      close: vi.fn(),
      fail: () => {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(MergePagesDialog, { t, hint: 'mergePagesHint', state, onConfirm }),
      )
      await Promise.resolve()
    })

    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]!.checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)

    await act(async () => {
      container!.querySelector<HTMLElement>('[data-cmd="dialogOk"]')!.click()
      await Promise.resolve()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
