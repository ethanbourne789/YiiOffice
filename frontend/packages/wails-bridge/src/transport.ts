export interface WailsRuntime {
  Call: {
    ByName(name: string, ...args: unknown[]): Promise<unknown>
  }
  Events: {
    On(name: string, cb: (data: unknown) => void): void
    Off?(name: string, cb: (data: unknown) => void): void
  }
}

/** Generated binding name; update together with wails3 generate bindings output. */
const SERVICE = 'bridge.Service'

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

export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (await runtime().Call.ByName(`${SERVICE}.Invoke`, channel, args)) as T
}

export function on(channel: string, handler: (data: unknown) => void): () => void {
  const rt = runtime()
  rt.Events.On(channel, handler)
  return () => rt.Events.Off?.(channel, handler)
}
