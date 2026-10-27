/** The text dialog on its own: the draft, what it is editing, and the shell.

    The interesting properties are the ones the inline version got wrong by
    having to remember them at four call sites -- a close must forget the edit
    target (the old mask click did, the old OK of the insert case did not), and
    the draft must survive a close, because placing a form label is
    click-to-place *after* the dialog is gone and the placed image is rendered
    from the draft at that moment. */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  StaticTextDialog,
  useStaticTextDialog,
  type StaticTextState,
} from '../src/renderer/StaticTextDialog'
import type { TFunc } from '../src/renderer/i18n/locale'
import { actRun, renderHook, type RenderedHook } from './helpers/render-hook'

const t = ((key: string) => key) as unknown as TFunc

interface Target {
  id: string
}

let hook: RenderedHook<StaticTextState<Target>> | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null
let api: StaticTextState<Target> | null = null
let confirmed = 0

afterEach(async () => {
  await hook?.unmount()
  hook = null
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  api = null
  confirmed = 0
})

describe('useStaticTextDialog', () => {
  it('starts closed on the defaults', async () => {
    hook = await renderHook(() => useStaticTextDialog<Target>())
    const s = (): StaticTextState<Target> => hook!.current
    expect(s().open).toBe(false)
    expect(s().purpose).toBe('form')
    expect(s().target).toBeNull()
    expect(s().draft).toEqual({ text: '', size: 14, color: '#111111', align: 'left' })
  })

  it('takes only the fields it is given, and remembers the rest', async () => {
    hook = await renderHook(() => useStaticTextDialog<Target>())
    const s = (): StaticTextState<Target> => hook!.current

    await actRun(() => s().show({ purpose: 'form', target: { id: 'a' }, size: 24, color: '#ff0000' }))
    await actRun(() => s().show({ purpose: 'form', text: 'hello' }))

    // the second open asked for a fresh text only -- styling carries over, which is
    // what the ribbon's "add text" does
    expect(s().draft).toEqual({ text: 'hello', size: 24, color: '#ff0000', align: 'left' })
    // ...but the target is always whatever this open said, here nothing
    expect(s().target).toBeNull()
  })

  it('forgets the target on close but keeps the draft', async () => {
    hook = await renderHook(() => useStaticTextDialog<Target>())
    const s = (): StaticTextState<Target> => hook!.current
    await actRun(() => s().show({ purpose: 'form', target: { id: 'a' }, text: 'label' }))
    await actRun(() => s().close())

    expect(s().open).toBe(false)
    expect(s().target).toBeNull()
    expect(s().draft.text).toBe('label')
  })

  it('clamps the size, and reads a cleared field as "default" rather than "tiny"', async () => {
    hook = await renderHook(() => useStaticTextDialog<Target>())
    const s = (): StaticTextState<Target> => hook!.current
    await actRun(() => s().show({ purpose: 'form' }))

    await actRun(() => s().setSize(4))
    expect(s().draft.size).toBe(6)
    await actRun(() => s().setSize(200))
    expect(s().draft.size).toBe(72)
    // clearing a number input yields 0, and 0-point text is invisible
    await actRun(() => s().setSize(0))
    expect(s().draft.size).toBe(14)
    await actRun(() => s().setSize(Number.NaN))
    expect(s().draft.size).toBe(14)
  })

  it('opens with the colour popover shut even if it was left open', async () => {
    hook = await renderHook(() => useStaticTextDialog<Target>())
    const s = (): StaticTextState<Target> => hook!.current
    await actRun(() => s().show({ purpose: 'form' }))
    await actRun(() => s().toggleColor())
    expect(s().colorOpen).toBe(true)
    await actRun(() => s().close())
    await actRun(() => s().show({ purpose: 'insert' }))
    expect(s().colorOpen).toBe(false)
    // the purpose follows the last open, so the title cannot lag behind
    expect(s().purpose).toBe('insert')
  })
})

const Harness = (): ReturnType<typeof createElement> => {
  const state = useStaticTextDialog<Target>()
  api = state
  return createElement(StaticTextDialog, {
    t,
    state,
    title: 'TITLE',
    onConfirm: () => {
      confirmed += 1
    },
    onCancel: state.close,
  })
}

async function mount(): Promise<void> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(Harness))
  })
}

const part = (selector: string): Element | null => container!.querySelector(selector)

async function type(value: string): Promise<void> {
  const textarea = part('[data-cmd="dialogInput"]') as HTMLTextAreaElement
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  await act(async () => {
    setValue.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('StaticTextDialog', () => {
  it('renders nothing while closed', async () => {
    await mount()
    expect(part('[role="dialog"]')).toBeNull()
  })

  it('names itself with the title it was given', async () => {
    await mount()
    await actRun(() => api!.show({ purpose: 'form' }))
    const dialog = part('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBe('TITLE')
    expect(dialog!.getAttribute('aria-modal')).toBe('true')
  })

  it('keeps OK dead until there is text to commit', async () => {
    await mount()
    await actRun(() => api!.show({ purpose: 'form' }))
    const ok = (): HTMLButtonElement => part('[data-cmd="dialogOk"]') as HTMLButtonElement
    expect(ok().disabled).toBe(true)

    await type('   ')
    // whitespace alone is still nothing
    expect(ok().disabled).toBe(true)

    await type('label')
    expect(ok().disabled).toBe(false)
    await actRun(() => ok().click())
    expect(confirmed).toBe(1)
  })

  it('drops whatever it was editing when cancelled', async () => {
    await mount()
    await actRun(() => api!.show({ purpose: 'form', target: { id: 'a' }, text: 'x' }))
    await actRun(() => (part('[data-cmd="dialogCancel"]') as HTMLButtonElement).click())
    expect(part('[role="dialog"]')).toBeNull()
    expect(api!.target).toBeNull()
    // the draft stays for click-to-place
    expect(api!.draft.text).toBe('x')
  })

  it('closes on Escape without confirming', async () => {
    await mount()
    await actRun(() => api!.show({ purpose: 'form', text: 'x' }))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(part('[role="dialog"]')).toBeNull()
    expect(confirmed).toBe(0)
  })
})
