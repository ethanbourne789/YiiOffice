/**
 * Bridge errors carry a stable code so the renderer never shows raw Go/os text.
 *
 * Wire format produced by `internal/bridge/errcodes.go`:
 *
 *   <code>: <detail>
 *
 * `<code>` is lowercase snake_case with a domain prefix (`open_read_failed`,
 * `export_render_failed`, `update_feed_http_error`, …). The detail is
 * diagnostics only. A bare code (no colon) is valid too.
 *
 * This lives in the i18n core (not the Wails bridge) so apps can map codes
 * without pulling the bridge runtime into non-browser unit tests.
 */

export interface ParsedBridgeError {
  /** The stable code, or null when the message carries none. */
  code: string | null
  /** Raw diagnostics after the code (empty when there is none). */
  detail: string
}

/** A code token: lowercase letters/digits, at least one underscore. */
const CODE_TOKEN = /^[a-z0-9]+(?:_[a-z0-9]+)+$/

/** Normalizes unknown thrown values (Error, string, anything else) to a message. */
export function bridgeErrorTextOf(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Error) return raw.message
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const message = (raw as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

export function parseBridgeError(raw: unknown): ParsedBridgeError {
  const message = bridgeErrorTextOf(raw).trim()
  if (message === '') return { code: null, detail: '' }
  const colon = message.indexOf(':')
  const head = (colon > 0 ? message.slice(0, colon) : message).trim()
  if (!CODE_TOKEN.test(head)) return { code: null, detail: message }
  return {
    code: head,
    detail: colon > 0 ? message.slice(colon + 1).trim() : '',
  }
}
