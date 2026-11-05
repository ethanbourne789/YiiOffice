// Save-before-close coordinator (shell side).
//
// Go owns the "unsaved changes" prompt: the guard runs on the UI thread, where
// a Wails dialog would have to re-enter the message loop, so it uses a plain
// Win32 box. When the user picks "Save" the guard publishes
// `app:close-save-request` and refuses that close — the document bytes live in
// the editor iframes, not in Go.
//
// This module answers that request: it calls the `__yiiofficeCloseSave` hook
// every editor registers on its own window (the frames are same-origin, so a
// direct call is reliable where a broadcast event would have to guess which
// frame it reached), waits for the writes, and reports the aggregate outcome.
// Go retries the quit when the answer is `ok: true`; a failed answer leaves the
// window open so the user can retry or choose "Don't save" instead of losing
// edits to a half-finished write.
import { emit, on } from '@yiioffice/wails-bridge'

/** The hook each editor exposes: persist the document, report success. */
type CloseSaveHook = () => Promise<boolean> | boolean

interface CloseSaveWindow extends Window {
  __yiiofficeCloseSave?: CloseSaveHook
}

/** Payload published by internal/host.CloseFlow. */
interface CloseSaveRequest {
  requestId?: unknown
  tabs?: unknown
}

/** Finds the iframe hosting `tabId`; the shell renders one per open editor. */
function frameFor(tabId: string): HTMLIFrameElement | null {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-tab-id]')) {
    if (frame.dataset.tabId === tabId) return frame
  }
  return null
}

/**
 * Asks one editor frame to persist its document. A missing hook counts as a
 * failed write: closing over a frame we could not save is exactly the data loss
 * this handshake exists to prevent.
 */
async function saveFrame(tabId: string): Promise<boolean> {
  let win: CloseSaveWindow | null = null
  try {
    win = frameFor(tabId)?.contentWindow as CloseSaveWindow | null
  } catch {
    // Cross-origin frame (never happens today, the editors are same-origin).
    win = null
  }
  const hook = win?.__yiiofficeCloseSave
  if (typeof hook !== 'function') {
    console.warn('[close-save] no save hook for tab', tabId)
    return false
  }
  try {
    return (await hook()) === true
  } catch (error) {
    console.warn('[close-save] save failed for tab', tabId, error)
    return false
  }
}

/** Subscribes to the Go request; returns the unsubscribe function. */
export function installCloseSaveBridge(): () => void {
  try {
    return on('app:close-save-request', (payload) => {
      const request = (payload ?? {}) as CloseSaveRequest
      const requestId = typeof request.requestId === 'number' ? request.requestId : 0
      void (async () => {
        const ok = await saveTabsForClose(request.tabs)
        emit('app:close-save-result', { requestId, ok })
      })()
    })
  } catch {
    // No Wails runtime (unit tests, plain browser preview): nothing to answer.
    return () => undefined
  }
}

/**
 * Saves every tab in `tabs` and reports whether all of them landed. Exported
 * separately from the event plumbing so the fan-out itself is testable without
 * a Wails runtime.
 */
export async function saveTabsForClose(tabs: unknown): Promise<boolean> {
  if (!Array.isArray(tabs)) return false
  // Sequential: two editors saving at once would race the same file when the
  // user opened one document in two tabs.
  let ok = true
  for (const tab of tabs) {
    const id = (tab as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id.length === 0) continue
    if (!(await saveFrame(id))) ok = false
  }
  return ok
}
