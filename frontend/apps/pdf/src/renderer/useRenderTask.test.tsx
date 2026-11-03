// @vitest-environment jsdom
// Tells React that act() is supported in this jsdom test environment
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createRenderTaskController,
  useRenderTask,
  type RenderTaskController,
  type RenderTaskHandle,
} from './useRenderTask'

function makeTask(): RenderTaskHandle & { cancels: number } {
  let cancels = 0
  let reject!: (reason: unknown) => void
  const promise = new Promise<unknown>((_, rej) => {
    reject = rej
  })
  return {
    promise,
    cancel() {
      cancels++
      reject(new Error('RenderingCancelledException'))
    },
    get cancels() {
      return cancels
    },
  }
}

describe('createRenderTaskController', () => {
  it('supersede cancels the previous task and keeps only the newest session live', async () => {
    const controller = createRenderTaskController()
    const first = makeTask()
    const firstSettled = first.promise.catch(() => {})
    const sessionA = controller.begin()
    sessionA.track(first)
    expect(sessionA.live).toBe(true)

    const sessionB = controller.begin()
    expect(sessionA.live).toBe(false)
    expect(sessionB.live).toBe(true)
    expect(first.cancels).toBe(1)
    await firstSettled
  })

  it('cancels a task that is attached after the session was revoked', async () => {
    const controller = createRenderTaskController()
    const session = controller.begin()
    controller.cancel()
    expect(session.live).toBe(false)

    const late = makeTask()
    const lateSettled = late.promise.catch(() => {})
    session.track(late)
    expect(late.cancels).toBe(1)
    await lateSettled
  })

  it('end() settles a session without altering a newer one', () => {
    const controller = createRenderTaskController()
    const sessionA = controller.begin()
    const sessionB = controller.begin()
    sessionB.track(makeTask())

    sessionA.end()
    expect(sessionA.live).toBe(false)
    expect(sessionB.live).toBe(true)
  })

  it('a render that resumes after cancellation never reaches the canvas', async () => {
    const controller = createRenderTaskController()
    const session = controller.begin()
    const render = vi.fn(() => makeTask())
    void (async () => {
      await Promise.resolve() // stands in for `await doc.getPage(pageNo)`
      if (!session.live) return
      const task = render()
      session.track(task)
    })()

    controller.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(render).not.toHaveBeenCalled()
  })
})

describe('useRenderTask', () => {
  it('cancels the active render task when the owning component unmounts', async () => {
    const ref: { current: RenderTaskController | null } = { current: null }

    function Harness({ onReady }: { onReady: (controller: RenderTaskController) => void }) {
      const controller = useRenderTask()
      onReady(controller)
      return null
    }

    const root = createRoot(document.createElement('div'))
    act(() => {
      root.render(<Harness onReady={(controller) => (ref.current = controller)} />)
    })
    const session = ref.current!.begin()
    const task = makeTask()
    const settled = task.promise.catch(() => {})
    session.track(task)

    act(() => {
      root.unmount()
    })
    expect(task.cancels).toBe(1)
    expect(session.live).toBe(false)
    await settled
  })
})
