import { useEffect, useRef } from 'react'

/** The slice of pdf.js's RenderTask this hook needs (kept structural so tests can fake it). */
export interface RenderTaskHandle {
  promise: Promise<unknown>
  cancel: () => void
}

/** One revocable canvas render. It stops being live as soon as it is superseded,
 *  cancelled, ended, or its owner unmounts. */
export interface RenderSession {
  /** False once this session was superseded/cancelled/ended. Async work that resumes
   *  after that point must not touch the canvas or hand it to pdf.js. */
  readonly live: boolean
  /** Attach the RenderTask returned by page.render(). A task attached after the
   *  session ended is cancelled immediately: pdf.js owns the canvas until the task
   *  settles, so a late task must never be allowed to draw onto a replaced canvas. */
  track(task: RenderTaskHandle): void
  /** Mark a completed render as settled without cancelling it. */
  end(): void
  /** Revoke this session and cancel its task. Safe to call more than once. */
  cancel(): void
}

export interface RenderTaskController {
  /** Start a new session, cancelling the previous one (a page rerender or a page
   *  change supersedes whatever was drawing before). */
  begin(): RenderSession
  /** Cancel the active session, if any. */
  cancel(): void
}

/** Framework-free core so cancel semantics can be tested without a React renderer. */
export function createRenderTaskController(): RenderTaskController {
  let active: { task: RenderTaskHandle | null; revoked: boolean } | null = null

  const revoke = (session: { task: RenderTaskHandle | null; revoked: boolean }, cancelTask: boolean) => {
    session.revoked = true
    if (cancelTask) session.task?.cancel()
    if (active === session) active = null
  }

  return {
    begin() {
      if (active) revoke(active, true)
      const session = { task: null as RenderTaskHandle | null, revoked: false }
      active = session
      return {
        get live() {
          return !session.revoked
        },
        track(task) {
          if (session.revoked) {
            // The session ended between page.render() and this call: the canvas is
            // already gone, so the task must be cancelled instead of adopted.
            task.cancel()
            return
          }
          session.task = task
        },
        end() {
          if (!session.revoked) revoke(session, false)
        },
        cancel() {
          revoke(session, true)
        },
      }
    },
    cancel() {
      if (active) revoke(active, true)
    },
  }
}

/** A controller that cancels its active render when the owning component unmounts. */
export function useRenderTask(): RenderTaskController {
  const ref = useRef<RenderTaskController | null>(null)
  if (!ref.current) ref.current = createRenderTaskController()
  const controller = ref.current
  useEffect(
    () => () => {
      // Unmount is the one case without a follow-up effect: nothing else would
      // cancel a render still targeting the component's canvas.
      controller.cancel()
    },
    [controller],
  )
  return controller
}
