/**
 * Binary payload adapter between the Electron-era renderers and Wails bindings.
 *
 * The preload/IPC bridge accepted `ArrayBuffer`/`Buffer` and structured-cloned
 * them across the process boundary. Wails v3 bindings are JSON, so binary
 * arguments must travel as base64 strings and the Go services decode them with
 * `base64.StdEncoding`. Passing an ArrayBuffer straight through serialises it
 * to `{}`, and the runtime rejects the call:
 *
 *   could not parse argument #1: json: cannot unmarshal object into Go value
 *   of type string
 *
 * which is exactly what happened on every Ctrl+S in the docs editor.
 */

/** A payload a renderer may hand to a binary binding. */
export type BinaryPayload = string | ArrayBuffer | ArrayBufferView

const CHUNK = 0x8000

/** Normalise an ArrayBuffer / typed-array view to bytes. */
export function toBytes(content: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (content instanceof Uint8Array) return content
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  }
  return new Uint8Array(content)
}

/**
 * Return `content` as base64. Already-base64 strings pass through unchanged, so
 * callers may mix text-era and binary-era arguments.
 */
export function toBase64(content: BinaryPayload): string {
  if (typeof content === 'string') return content
  const bytes = toBytes(content)
  let binary = ''
  // Chunked to stay under the argument limit of String.fromCharCode.apply.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Shape the docs editor expects back from a save call (Electron-era contract). */
export interface DocxSaveOutcome {
  ok: boolean
  path?: string
  error?: string
  canceled?: boolean
  passwordIntentPending?: boolean
  dataUrl?: string
  reason?: string
}

/** Normalise the Go `DocxSaveResult` (`{path, ok, error}`) to that contract. */
export function normalizeDocxSave(raw: unknown): DocxSaveOutcome {
  if (!raw || typeof raw !== 'object') return { ok: false }
  const value = raw as Record<string, unknown>
  const outcome: DocxSaveOutcome = { ok: value.ok === true }
  if (typeof value.path === 'string') outcome.path = value.path
  if (typeof value.error === 'string' && value.error !== '') outcome.error = value.error
  if (typeof value.reason === 'string') outcome.reason = value.reason
  if (typeof value.dataUrl === 'string') outcome.dataUrl = value.dataUrl
  if (value.passwordIntentPending === true) outcome.passwordIntentPending = true
  // A canceled native dialog comes back as an all-empty result.
  if (!outcome.ok && !outcome.error && !outcome.path) outcome.canceled = true
  return outcome
}
