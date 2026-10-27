/** The smallest thing that runs a hook under `act`.

    The repo has no `@testing-library/react` and this is not the reason to add
    it: `renderHook` there is about 40 lines around a probe component, which is
    what this is. What it buys is that a state domain can be lifted out of the
    editor component (`useTextEntry`, `useMergeDialog`, and the ones that follow)
    and be tested on its own instead of only through a 9.7k-line component.

    `current` is a getter, not a snapshot: it reads the last render's return
    value, so asserting after a setter sees the new state without a manual
    `rerender()` in every test. */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

export interface RenderedHook<T> {
  readonly current: T
  rerender: () => Promise<void>
  unmount: () => Promise<void>
}

/** Run a state update and let the re-render land. */
export async function actRun(fn: () => void): Promise<void> {
  await act(async () => {
    fn()
    await Promise.resolve()
  })
}

export async function renderHook<T>(useHook: () => T): Promise<RenderedHook<T>> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let latest: T
  const Probe = (): null => {
    latest = useHook()
    return null
  }
  await act(async () => {
    root.render(createElement(Probe))
  })
  return {
    get current(): T {
      return latest
    },
    rerender: async () => {
      await act(async () => {
        root.render(createElement(Probe))
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
