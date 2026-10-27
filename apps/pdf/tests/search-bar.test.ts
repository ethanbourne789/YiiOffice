/** Find-in-document, tested without the editor.

    The state that used to live in the editor was four `useState`s plus a
    debounced scan, and the part worth pinning is the gap between what the scan
    returns and what the user can navigate to: a page with an unsaved deletion is
    hidden on screen, so its hits must not be reachable, and a cursor that was
    pointing into the hidden set has to land somewhere live instead of nowhere.

    The bar is covered for what it can get wrong on its own -- focus on open, the
    count, Enter/Shift+Enter stepping, the arrows going dead with no results. */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchBar, usePdfSearch, type PdfSearch } from '../src/renderer/SearchBar'
import type { TFunc } from '../src/renderer/i18n/locale'
import type { PageEntry, SearchIndex } from '../src/renderer/search'
import { actRun, renderHook, type RenderedHook } from './helpers/render-hook'

/** Real strings for the two keys the bar formats, so the assertions read as the
    user sees them instead of as key names */
const TEXT: Record<string, string> = {
  search: '搜索',
  searchNoResults: '无结果',
  searchCount: '{current} / {total}',
  searchPrev: '上一个',
  searchNext: '下一个',
}
const t = ((key: string, params?: Record<string, string | number>) => {
  let out = TEXT[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    out = out.replace(`{${name}}`, String(value))
  }
  return out
}) as unknown as TFunc

/** One text run per page: `searchInIndex` drops matches it cannot place, and the
    same item repeated would place every hit on identical geometry */
function page(text: string): PageEntry {
  return {
    text,
    lower: text.toLowerCase(),
    items: [{ start: 0, end: text.length, x: 0, y: 700, w: text.length * 6, h: 10 }],
  }
}

const INDEX: SearchIndex = [page('alpha beta'), page('gamma alpha')]
const index = (): Promise<SearchIndex> => Promise.resolve(INDEX)
const NOTHING_HIDDEN: ReadonlySet<number> = new Set()

const waitForScan = async (): Promise<void> => {
  // Comfortably past the 200ms debounce; the scan itself only awaits a promise
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260))
  })
}

let hook: RenderedHook<PdfSearch> | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null
let api: PdfSearch | null = null

afterEach(async () => {
  await hook?.unmount()
  hook = null
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  api = null
  vi.useRealTimers()
})

describe('usePdfSearch', () => {
  it('does not scan until the bar is open and the query is settled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current

    expect(s().open).toBe(false)

    await actRun(() => s().openSearch())
    expect(s().open).toBe(true)
    await actRun(() => s().setQuery('alpha'))
    expect(s().matches).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199)
    })
    expect(s().matches).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(s().matches.map((m) => m.pageIndex)).toEqual([0, 1])
    expect(s().current).toBe(0)
  })

  it('treats a whitespace-only query as no query', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('   '))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(s().matches).toEqual([])
    expect(s().current).toBe(0)
  })

  it('steps through the hits and wraps at both ends', async () => {
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('alpha'))
    await waitForScan()

    await actRun(() => s().step(1))
    expect(s().current).toBe(1)
    await actRun(() => s().step(1))
    expect(s().current).toBe(0)
    await actRun(() => s().step(-1))
    expect(s().current).toBe(1)
  })

  it('leaves the cursor alone when there is nothing to step through', async () => {
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().step(1))
    expect(s().current).toBe(0)
  })

  it('drops hits on pages an unsaved deletion has hidden, and clamps the cursor', async () => {
    let hidden: ReadonlySet<number> = NOTHING_HIDDEN
    hook = await renderHook(() => usePdfSearch({ index, hidden }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('alpha'))
    await waitForScan()

    await actRun(() => s().step(1))
    expect(s().current).toBe(1)

    // The page the cursor sits on goes away; the cursor must not point past the end
    hidden = new Set([0])
    await hook.rerender()
    expect(s().matches.map((m) => m.pageIndex)).toEqual([1])
    expect(s().current).toBe(0)

    hidden = new Set([0, 1])
    await hook.rerender()
    expect(s().matches).toEqual([])
    expect(s().current).toBe(0)
  })

  it('reports a hit on the page that is hidden only when every page is', async () => {
    // Guard against the filter collapsing the list by accident: hiding one page
    // of two must leave exactly one navigable hit
    const hidden: ReadonlySet<number> = new Set([1])
    hook = await renderHook(() => usePdfSearch({ index, hidden }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('alpha'))
    await waitForScan()
    expect(s().matches.map((m) => m.pageIndex)).toEqual([0])
  })

  it('can drop its results without closing, for a document that changed underneath', async () => {
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('alpha'))
    await waitForScan()
    expect(s().matches).toHaveLength(2)

    await actRun(() => s().clear())
    expect(s().matches).toEqual([])
    expect(s().current).toBe(0)
    expect(s().open).toBe(true)
  })

  it('clears the hits when the bar closes', async () => {
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().openSearch())
    await actRun(() => s().setQuery('alpha'))
    await waitForScan()
    expect(s().matches).toHaveLength(2)

    await actRun(() => s().close())
    expect(s().open).toBe(false)
    expect(s().matches).toEqual([])
  })

  it('toggles from either side', async () => {
    hook = await renderHook(() => usePdfSearch({ index, hidden: NOTHING_HIDDEN }))
    const s = (): PdfSearch => hook!.current
    await actRun(() => s().toggle())
    expect(s().open).toBe(true)
    await actRun(() => s().toggle())
    expect(s().open).toBe(false)
  })
})

/** The bar plus a handle on the hook, so a test can open it without the ribbon */
const Harness = (): ReturnType<typeof createElement> => {
  const search = usePdfSearch({ index, hidden: NOTHING_HIDDEN })
  api = search
  return createElement(SearchBar, { search, t })
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

function part(selector: string): Element | null {
  return container!.querySelector(selector)
}

function input(): HTMLInputElement {
  return part('[data-cmd="searchInput"]') as HTMLInputElement
}

/** React tracks the DOM value, so the property setter is the only way in */
async function type(value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function press(key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

describe('SearchBar', () => {
  it('renders nothing while closed', async () => {
    await mount()
    expect(part('.pdf-search-bar')).toBeNull()
  })

  it('focuses and selects the field as it opens', async () => {
    await mount()
    await actRun(() => api!.openSearch())
    expect(document.activeElement).toBe(input())
  })

  it('counts the current hit against the total', async () => {
    await mount()
    await actRun(() => api!.openSearch())
    await type('alpha')
    await waitForScan()
    expect(part('[data-cmd="searchCount"]')!.textContent).toBe('1 / 2')

    await press('Enter')
    expect(part('[data-cmd="searchCount"]')!.textContent).toBe('2 / 2')
    await press('Enter', true)
    expect(part('[data-cmd="searchCount"]')!.textContent).toBe('1 / 2')
  })

  it('says so when nothing matches, and the arrows go dead', async () => {
    await mount()
    await actRun(() => api!.openSearch())
    await type('zzz')
    await waitForScan()

    expect(part('[data-cmd="searchCount"]')!.textContent).toBe('无结果')
    expect((part('[data-cmd="searchPrev"]') as HTMLButtonElement).disabled).toBe(true)
    expect((part('[data-cmd="searchNext"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no count before a query is typed', async () => {
    await mount()
    await actRun(() => api!.openSearch())
    expect(part('[data-cmd="searchCount"]')!.textContent).toBe('')
    expect((part('[data-cmd="searchNext"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes from its own button', async () => {
    await mount()
    await actRun(() => api!.openSearch())
    expect(part('.pdf-search-bar')).not.toBeNull()

    await actRun(() => (part('[data-cmd="searchClose"]') as HTMLButtonElement).click())
    expect(part('.pdf-search-bar')).toBeNull()
  })
})
