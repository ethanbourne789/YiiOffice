import { emit, on } from './transport'

/** Request emitted by Go after the renderer signalled `headless-ready`. */
export interface HeadlessExportRequest {
  inputPath: string
  outPath: string
  format: string
}

/** Completion report the renderer sends back to Go. */
export interface HeadlessExportResult {
  ok: boolean
  error?: string
}

export interface HeadlessExportChannel {
  /**
   * Resolves with the pending export request once Go emits it (or immediately
   * if it arrived before the editor subscribed). Resolves null in a normal GUI
   * session where no headless run is driving this window.
   */
  consume(): Promise<HeadlessExportRequest | null>
  /** Reports success/failure to Go, which prints it and picks the exit code. */
  done(result: HeadlessExportResult): void
}

function parseRequest(data: unknown): HeadlessExportRequest | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (typeof raw.outPath !== 'string' || raw.outPath === '') return null
  return {
    inputPath: typeof raw.inputPath === 'string' ? raw.inputPath : '',
    outPath: raw.outPath,
    format: typeof raw.format === 'string' ? raw.format : '',
  }
}

/**
 * Builds the headless channel for one editor module.
 *
 * The listener is installed and `headless-ready` is emitted synchronously when
 * this is called (at bridge install time, before React mounts). Go waits for
 * that signal before emitting the request, which removes the old race where
 * the CLI emitted into a page that had not subscribed yet.
 */
export function createHeadlessExportChannel(module: string): HeadlessExportChannel {
  let pending: HeadlessExportRequest | null = null
  let delivered = false
  let waiter: ((request: HeadlessExportRequest | null) => void) | null = null
  let listening = false

  try {
    on(`${module}:consume-headless-export`, (data) => {
      const request = parseRequest(data)
      if (!request) return
      if (waiter) {
        const resolve = waiter
        waiter = null
        delivered = true
        resolve(request)
        return
      }
      pending = request
    })
    listening = true
  } catch {
    // No Wails runtime (browser preview / unit tests): stay inert.
  }
  if (listening) {
    emit(`${module}:headless-ready`)
  }

  return {
    consume(): Promise<HeadlessExportRequest | null> {
      if (pending) {
        const request = pending
        pending = null
        delivered = true
        return Promise.resolve(request)
      }
      if (delivered || !listening) return Promise.resolve(null)
      return new Promise((resolve) => {
        waiter = resolve
      })
    },
    done(result: HeadlessExportResult): void {
      emit(`${module}:headless-export-done`, result)
    },
  }
}

const channels = new Map<string, HeadlessExportChannel>()

/** Returns (and lazily creates) the process-wide channel for a module. */
export function headlessExportChannel(module: string): HeadlessExportChannel {
  const existing = channels.get(module)
  if (existing) return existing
  const channel = createHeadlessExportChannel(module)
  channels.set(module, channel)
  return channel
}
