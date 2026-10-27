/** Form authoring on its own: the arming/selection state, the ribbon group, and
    the field context menu.

    The editor used to hold nine states for this and read the selection in six
    places. What is worth pinning here is the invariant that had no single owner
    before: one authoring mode at a time, and a selection that never outlives the
    fields it points at. */

import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FormDesignRibbon,
  FormFieldMenu,
  useFormDesign,
  type Arrange,
  type FormDesign,
} from '../src/renderer/FormDesignBar'
import type { DesignField } from '../src/renderer/FormDesignLayer'
import type { TFunc } from '../src/renderer/i18n/locale'
import { actRun, renderHook, type RenderedHook } from './helpers/render-hook'

const t = ((key: string) => key) as unknown as TFunc

const field = (id: string, pageIndex = 0): DesignField => ({
  id,
  kind: 'text',
  name: id,
  pageIndex,
  rect: [0, 0, 10, 10],
  required: false,
  existing: false,
})

const fields = new Map<number, DesignField[]>([
  [0, [field('a'), field('b')]],
  [1, [field('c', 1)]],
])

let hook: RenderedHook<FormDesign> | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  await hook?.unmount()
  hook = null
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/** Mount a component the way the editor does and hand back its container */
async function mount(node: ReactElement): Promise<HTMLDivElement> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(node))
  return container
}

const byCmd = (root: ParentNode, cmd: string): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)
  if (!el) throw new Error(`no control for ${cmd}`)
  return el
}

const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    el.click()
    await Promise.resolve()
  })
}

describe('useFormDesign', () => {
  it('starts idle: no tool, no preview, nothing selected', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current
    expect(d().tool).toBeNull()
    expect(d().keepTool).toBe(false)
    expect(d().preview).toBe(false)
    expect(d().selectedIds).toEqual([])
    expect(d().selected).toEqual([])
    expect(d().selectedOne).toBeNull()
  })

  it('arms a tool, and pressing the armed one disarms it', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    let armed = false
    await actRun(() => {
      armed = d().toggleTool('text')
    })
    expect(armed).toBe(true)
    expect(d().tool).toBe('text')

    await actRun(() => {
      armed = d().toggleTool('text')
    })
    expect(armed).toBe(false)
    expect(d().tool).toBeNull()
  })

  it('keeps one authoring mode: arming a tool leaves preview and drops the selection', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().togglePreview())
    await actRun(() => d().select(['a'], 'replace'))
    expect(d().preview).toBe(true)
    expect(d().selectedIds).toEqual(['a'])

    await actRun(() => d().toggleTool('checkbox'))
    expect(d().tool).toBe('checkbox')
    expect(d().preview).toBe(false)
    expect(d().selectedIds).toEqual([])
  })

  it('toggling preview also drops the tool and the selection', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().toggleTool('text'))
    await actRun(() => d().select(['a'], 'replace'))
    await actRun(() => d().togglePreview())
    expect(d().preview).toBe(true)
    expect(d().tool).toBeNull()
    expect(d().selectedIds).toEqual([])
  })

  it('replace selection overwrites; toggle adds what is missing and removes what is there', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().select(['a'], 'replace'))
    await actRun(() => d().select(['b'], 'replace'))
    expect(d().selectedIds).toEqual(['b'])

    await actRun(() => d().select(['a'], 'toggle'))
    expect(d().selectedIds).toEqual(['b', 'a'])

    await actRun(() => d().select(['b'], 'toggle'))
    expect(d().selectedIds).toEqual(['a'])
  })

  it('resolves the selection to fields, and reports a single one only when there is exactly one', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().select(['b', 'c'], 'replace'))
    expect(d().selected.map((f) => f.id)).toEqual(['b', 'c'])
    expect(d().selectedOne).toBeNull()

    await actRun(() => d().select(['c'], 'replace'))
    expect(d().selectedOne?.id).toBe('c')
  })

  it('drops ids the field set no longer has (undo restored an earlier document)', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().select(['a', 'b'], 'replace'))
    await actRun(() => d().retain((id) => id !== 'a'))
    expect(d().selectedIds).toEqual(['b'])
    expect(d().selected.map((f) => f.id)).toEqual(['b'])
  })

  it('selects a whole page, and nothing for a page that is not visible', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().selectPage(1))
    expect(d().selectedIds).toEqual(['c'])

    await actRun(() => d().selectPage(undefined))
    expect(d().selectedIds).toEqual([])
  })

  it('reset clears the mode but keeps "keep the tool"', async () => {
    hook = await renderHook(() => useFormDesign(fields))
    const d = (): FormDesign => hook!.current

    await actRun(() => d().toggleKeepTool())
    await actRun(() => d().toggleTool('radio'))
    await actRun(() => d().select(['a'], 'replace'))

    await actRun(() => d().reset())
    expect(d().tool).toBeNull()
    expect(d().preview).toBe(false)
    expect(d().selectedIds).toEqual([])
    // a preference, not per-document state
    expect(d().keepTool).toBe(true)
  })
})

/** A ribbon wired to a live hook, the way the editor renders it. Rendering it
    with a frozen `design` prop would hide the very flow these tests are about:
    pressing the arrange button only works because the parent re-renders and
    hands down the new state. */
function RibbonHarness({
  readOnly = false,
  canDetect = true,
  pendingCount = 0,
  calls,
  box,
}: {
  readOnly?: boolean
  canDetect?: boolean
  pendingCount?: number
  calls: string[]
  box: { current: FormDesign | null }
}): ReactElement {
  const design = useFormDesign(fields)
  box.current = design
  return createElement(FormDesignRibbon, {
    t,
    readOnly,
    canDetect,
    pendingCount,
    design,
    onTool: (kind: string) => calls.push(`tool:${kind}`),
    onPreview: () => calls.push('preview'),
    onDetect: () => calls.push('detect'),
    onArrange: (how: Arrange) => calls.push(`arrange:${how}`),
    onDelete: () => calls.push('delete'),
  })
}

describe('FormDesignRibbon', () => {
  interface Ribbon {
    el: HTMLDivElement
    calls: string[]
    /** Live hook state; drive it to move the ribbon */
    design: () => FormDesign
  }

  const ribbon = async (
    props: { readOnly?: boolean; canDetect?: boolean; pendingCount?: number } = {},
  ): Promise<Ribbon> => {
    const calls: string[] = []
    const box: { current: FormDesign | null } = { current: null }
    const el = await mount(createElement(RibbonHarness, { ...props, calls, box }))
    return { el, calls, design: () => box.current! }
  }

  it('offers every field kind, and only the armed one reads as pressed', async () => {
    const { el, calls, design } = await ribbon()
    for (const cmd of [
      'formDesignText',
      'formDesignDate',
      'formDesignCheckbox',
      'formDesignRadio',
      'formDesignChoice',
      'formDesignSignature',
    ]) {
      expect(byCmd(el, cmd).getAttribute('aria-pressed')).toBe('false')
    }

    await click(byCmd(el, 'formDesignCheckbox'))
    expect(calls).toEqual(['tool:checkbox'])

    await actRun(() => design().toggleTool('checkbox'))
    expect(byCmd(el, 'formDesignCheckbox').getAttribute('aria-pressed')).toBe('true')
    expect(byCmd(el, 'formDesignText').getAttribute('aria-pressed')).toBe('false')
  })

  it('disables arranging until two fields are selected, and each action at its own minimum', async () => {
    const { el, design } = await ribbon()
    expect(byCmd(el, 'formDesignArrange').hasAttribute('disabled')).toBe(true)

    await actRun(() => design().select(['a'], 'replace'))
    expect(byCmd(el, 'formDesignArrange').hasAttribute('disabled')).toBe(true)

    await actRun(() => design().select(['a', 'b'], 'replace'))
    expect(byCmd(el, 'formDesignArrange').hasAttribute('disabled')).toBe(false)

    await click(byCmd(el, 'formDesignArrange'))
    expect(byCmd(el, 'formDesignArrange-left').hasAttribute('disabled')).toBe(false)
    // distributing needs three fields
    expect(byCmd(el, 'formDesignArrange-distributeH').hasAttribute('disabled')).toBe(true)
  })

  it('picking an arrange action closes the menu before applying it', async () => {
    const { el, calls, design } = await ribbon()
    await actRun(() => design().select(['a', 'b'], 'replace'))
    await click(byCmd(el, 'formDesignArrange'))
    await click(byCmd(el, 'formDesignArrange-sameWidth'))
    expect(calls).toEqual(['arrange:sameWidth'])
    expect(el.querySelector('[data-cmd="formDesignArrange-left"]')).toBeNull()
  })

  it('reports the detecting state on the button instead of in a second place', async () => {
    const { el, design } = await ribbon()
    expect(byCmd(el, 'formDesignDetect').textContent).toBe('formDesignDetect')

    await actRun(() => design().setDetecting(true))
    expect(byCmd(el, 'formDesignDetect').textContent).toBe('formDesignDetecting')
    expect(byCmd(el, 'formDesignDetect').hasAttribute('disabled')).toBe(true)
  })

  it('cannot detect without a document', async () => {
    const { el } = await ribbon({ canDetect: false })
    expect(byCmd(el, 'formDesignDetect').hasAttribute('disabled')).toBe(true)
  })

  it('tells the user which of the four states the tab is in', async () => {
    const idle = await ribbon()
    const progress = (): string | null | undefined =>
      idle.el.querySelector('.form-ribbon-progress')?.textContent

    expect(progress()).toBe('formDesignEmptyHint')
    await actRun(() => idle.design().toggleTool('text'))
    expect(progress()).toBe('formDesignPlaceHint')
    await actRun(() => idle.design().togglePreview())
    expect(progress()).toBe('formDesignPreviewOn')

    await act(async () => root?.unmount())
    root = null
    const pending = await ribbon({ pendingCount: 2 })
    expect(pending.el.querySelector('.form-ribbon-progress')?.textContent).toBe(
      'formDesignPending',
    )
  })

  it('disables every authoring control in a read-only document', async () => {
    const { el } = await ribbon({ readOnly: true })
    for (const cmd of ['formDesignText', 'formDesignKeepTool', 'formDesignPreview']) {
      expect(byCmd(el, cmd).hasAttribute('disabled')).toBe(true)
    }
  })
})

describe('FormFieldMenu', () => {
  const menu = async (
    overrides: Partial<Parameters<typeof FormFieldMenu>[0]> = {},
  ): Promise<{ el: HTMLDivElement; calls: string[] }> => {
    const calls: string[] = []
    const el = await mount(
      createElement(FormFieldMenu, {
        t,
        menu: { x: 40, y: 60, fieldId: 'a', pageIndex: 0 },
        selectedCount: 1,
        clipboardEmpty: true,
        onClose: () => calls.push('close'),
        onProperties: (id) => calls.push(`properties:${id}`),
        onCopy: () => calls.push('copy'),
        onDuplicate: () => calls.push('duplicate'),
        onPaste: (page) => calls.push(`paste:${page}`),
        onArrange: (how) => calls.push(`arrange:${how}`),
        onDelete: () => calls.push('delete'),
        ...overrides,
      }),
    )
    return { el, calls }
  }

  const labels = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('button')).map((b) => b.textContent ?? '')

  it('offers paste only when the click missed a field', async () => {
    const { el } = await menu({ menu: { x: 0, y: 0, fieldId: null, pageIndex: 1 } })
    expect(labels(el)).toEqual(['formDesignPaste'])
  })

  it('needs exactly one field selected to open its properties', async () => {
    const { el } = await menu({ selectedCount: 2 })
    const props = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'formDesignProperties',
    )!
    expect(props.hasAttribute('disabled')).toBe(true)
  })

  it('closes first, then acts, so the action never runs against a stale menu', async () => {
    const { el, calls } = await menu()
    await click(el.querySelectorAll('button')[1] as HTMLElement)
    expect(calls).toEqual(['close', 'copy'])
  })

  it('pastes into the page that was right-clicked', async () => {
    const { el, calls } = await menu({
      menu: { x: 0, y: 0, fieldId: null, pageIndex: 3 },
      clipboardEmpty: false,
    })
    await click(el.querySelector('button') as HTMLElement)
    expect(calls).toEqual(['close', 'paste:3'])
  })

  it('keeps itself inside the window when opened near an edge', async () => {
    // jsdom reports a zero-size box, so the clamp falls back to "4px from the edge"
    const { el } = await menu({ menu: { x: 2000, y: 2000, fieldId: 'a', pageIndex: 0 } })
    const card = el.querySelector<HTMLElement>('.thumb-menu')!
    expect(card.style.left).toBe(`${window.innerWidth - 4}px`)
    expect(card.style.top).toBe(`${window.innerHeight - 4}px`)
  })
})
