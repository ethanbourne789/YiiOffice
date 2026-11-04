export interface WailsRuntime {
  Events: {
    /**
     * The official runtime hands the callback a `WailsEvent` envelope
     * (`{ name, data }`), not the emitted payload itself.
     */
    On(name: string, cb: (event: unknown) => void): (() => void) | void
    /** Emits an application event back to Go. Returns a promise in the official runtime. */
    Emit?(name: string, data?: unknown): unknown
    /** Removes *every* listener for the given names — prefer the `On` return value. */
    Off?(...names: string[]): void
  }
}

/**
 * Resolves the Wails runtime. Editors run in same-origin iframes, so the top
 * frame's runtime object is preferred when the current frame has none.
 */
export function runtime(): WailsRuntime {
  const self = window as unknown as { wails?: WailsRuntime }
  if (self.wails) return self.wails
  const top = window.top as unknown as { wails?: WailsRuntime } | null
  if (top && top !== self && top.wails) return top.wails
  throw new Error('Wails runtime is not available')
}

/** Unwraps the runtime's `WailsEvent` envelope down to the emitted payload. */
function eventPayload(event: unknown): unknown {
  if (event && typeof event === 'object' && 'data' in event && 'name' in event) {
    return (event as { data: unknown }).data
  }
  return event
}

/**
 * Subscribes to a Go event and hands the handler the payload Go emitted
 * (not the runtime envelope).
 */
export function on(channel: string, handler: (data: unknown) => void): () => void {
  const rt = runtime()
  const off = rt.Events.On(channel, (event) => handler(eventPayload(event)))
  if (typeof off === 'function') return off
  // Runtime without an unsubscribe return value: drop the whole channel, the
  // only handle available. Callers that need isolation rely on the return value.
  return () => rt.Events.Off?.(channel)
}

/**
 * Emits an application event back to Go. Resolves false when no runtime is
 * present (browser preview, unit tests) instead of throwing: headless-only
 * plumbing must not break normal startup.
 */
export function emit(channel: string, data?: unknown): boolean {
  try {
    const rt = runtime()
    if (typeof rt.Events.Emit !== 'function') return false
    void rt.Events.Emit(channel, data)
    return true
  } catch {
    return false
  }
}
