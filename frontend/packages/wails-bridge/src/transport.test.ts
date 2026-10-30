import { beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from './transport'

interface FakeRuntime {
  Events: {
    On: (name: string, cb: (ev: unknown) => void) => () => void
    Off?: (...names: string[]) => void
  }
}

/**
 * Mirrors @wailsio/runtime's dispatch: the callback is handed a WailsEvent
 * (`{ name, data }`), never the bare payload.
 */
function installRuntime(): { runtime: FakeRuntime; fire: (name: string, data: unknown) => void } {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  const runtime: FakeRuntime = {
    Events: {
      On(name, cb) {
        const list = listeners.get(name) ?? []
        list.push(cb)
        listeners.set(name, list)
        return () => {
          const live = listeners.get(name) ?? []
          listeners.set(
            name,
            live.filter((l) => l !== cb),
          )
        }
      },
      Off(...names) {
        for (const n of names) listeners.delete(n)
      },
    },
  }
  ;(window as unknown as { wails?: FakeRuntime }).wails = runtime
  return {
    runtime,
    fire(name, data) {
      for (const cb of listeners.get(name) ?? []) cb({ name, data })
    },
  }
}

describe('transport.on', () => {
  beforeEach(() => {
    delete (window as unknown as { wails?: FakeRuntime }).wails
  })

  it('hands the handler the event payload, not the WailsEvent envelope', () => {
    const { fire } = installRuntime()
    const received: unknown[] = []
    on('tabs:changed', (data) => received.push(data))

    fire('tabs:changed', [{ id: 'tab-1', kind: 'docs', active: true }])

    expect(received).toEqual([[{ id: 'tab-1', kind: 'docs', active: true }]])
  })

  it('unsubscribes only its own listener', () => {
    const { fire } = installRuntime()
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = on('tabs:changed', first)
    on('tabs:changed', second)

    offFirst()
    fire('tabs:changed', [])

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
