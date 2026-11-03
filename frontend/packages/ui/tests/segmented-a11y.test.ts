/** @vitest-environment jsdom */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl, type SegmentedOption } from '../src/segmented'

const OPTIONS: SegmentedOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onPick: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  onPick = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Harness({
  options = OPTIONS,
  initial = 'a',
  disabled,
}: {
  options?: SegmentedOption[]
  initial?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(initial)
  return createElement(SegmentedControl, {
    value,
    options,
    ariaLabel: 'test group',
    disabled,
    onPick: (next: string) => {
      setValue(next)
      onPick(next)
    },
  })
}

const mount = (props: { options?: SegmentedOption[]; initial?: string; disabled?: boolean } = {}) => {
  act(() => root.render(createElement(Harness, props)))
  return host
}

const radios = (scope: HTMLElement): HTMLButtonElement[] =>
  Array.from(scope.querySelectorAll('.gs-seg-radio'))

const press = (scope: HTMLElement, key: string) =>
  act(() => {
    scope
      .querySelector('.gs-seg')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

describe('SegmentedControl semantics', () => {
  it('exposes a radiogroup with one checked radio per option', () => {
    const scope = mount()
    const group = scope.querySelector('.gs-seg')!
    expect(group.getAttribute('role')).toBe('radiogroup')
    const items = radios(scope)
    expect(items).toHaveLength(3)
    expect(items.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
  })

  it('uses a roving tabindex: only the selected segment is a tab stop', () => {
    const scope = mount({ initial: 'b' })
    expect(radios(scope).map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('clicking another segment switches the selection (mutually exclusive)', () => {
    const scope = mount()
    act(() => radios(scope)[2]!.click())
    expect(onPick).toHaveBeenCalledWith('c')
    expect(radios(scope).map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ])
  })

  it('clicking the selected segment does not re-fire onPick', () => {
    const scope = mount()
    act(() => radios(scope)[0]!.click())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('arrow keys move the selection and skip disabled segments', () => {
    const scope = mount({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta', disabled: true },
        { value: 'c', label: 'Gamma' },
      ],
      initial: 'a',
    })
    press(scope, 'ArrowRight')
    expect(onPick).toHaveBeenLastCalledWith('c')
    press(scope, 'ArrowLeft')
    expect(onPick).toHaveBeenLastCalledWith('a')
  })

  it('Home/End jump to the first/last enabled segment', () => {
    const scope = mount({ initial: 'b' })
    press(scope, 'End')
    expect(onPick).toHaveBeenLastCalledWith('c')
    press(scope, 'Home')
    expect(onPick).toHaveBeenLastCalledWith('a')
  })

  it('arrows wrap around the ends', () => {
    const scope = mount({ initial: 'c' })
    press(scope, 'ArrowRight')
    expect(onPick).toHaveBeenLastCalledWith('a')
  })

  it('disabled option never fires onPick', () => {
    const scope = mount({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta', disabled: true },
      ],
    })
    act(() => radios(scope)[1]!.click())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a disabled group disables every segment', () => {
    const scope = mount({ disabled: true })
    expect(radios(scope).every((r) => r.disabled)).toBe(true)
    act(() => radios(scope)[1]!.click())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('an off-list stored value keeps the first enabled segment focusable', () => {
    const scope = mount({ initial: 'zzz' })
    expect(radios(scope).map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })
})
