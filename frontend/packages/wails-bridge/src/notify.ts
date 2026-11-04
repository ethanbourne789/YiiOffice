import { Notify } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/notificationservice'

export interface SystemNotifyOptions {
  /** Skip the toast while the app has focus, where the in-app toast/status
   * already tells the user what happened. Default true. */
  whenUnfocused?: boolean
  title?: string
}

/** Repeat window for identical messages (autosave retries). */
const DEDUPE_MS = 60_000
let lastBody = ''
let lastAt = 0

/**
 * Raises a Windows system notification for a result the user may miss (a long
 * export finishing, a background autosave failing). Fire-and-forget: a missing
 * Wails runtime (browser preview / unit tests) or a toast delivery failure is
 * ignored rather than escalated to the caller.
 */
export function systemNotify(body: string, options: SystemNotifyOptions = {}): void {
  const { whenUnfocused = true, title = 'YiiOffice' } = options
  if (!body) return
  try {
    if (whenUnfocused && typeof document !== 'undefined' && document.hasFocus()) return
    // Repeating alerts (autosave/export failures) retry on a timer; suppress
    // the same message for a minute so a broken disk does not toast every
    // interval. One-off user-initiated successes are never deduped.
    if (!whenUnfocused) {
      const now = Date.now()
      if (body === lastBody && now - lastAt < DEDUPE_MS) return
      lastBody = body
      lastAt = now
    }
    void Notify(title, body).catch(() => undefined)
  } catch {
    // No Wails runtime: notifications are inert.
  }
}
