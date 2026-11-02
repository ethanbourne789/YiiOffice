/** Browser-compatible replacements for Node.js builtins.
 *  All functions have the same signature as their Node.js counterparts. */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Buffer.from(string, 'utf8') → TextEncoder.encode */
export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text)
}

/** Buffer.from(bytes).toString('utf8') → TextDecoder.decode */
export function bytesToText(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

/** Buffer.from(bytes).toString('base64') — encode Uint8Array to base64 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/** Buffer.from(str, 'base64') → Uint8Array — decode base64 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Buffer.from(str, 'base64').toString('utf8') — base64 to UTF-8 string */
export function base64ToText(base64: string): string {
  return decoder.decode(base64ToBytes(base64))
}

/** Buffer.from(str, 'utf8').toString('base64') — UTF-8 string to base64 */
export function textToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text))
}

/** Buffer.from(existing).equals(other) — byte equality check */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Buffer.from(bytes.buffer, byteOffset, byteLength) — create view */
export function bytesSlice(
  ab: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): Uint8Array {
  return new Uint8Array(ab, byteOffset, byteLength)
}

/** Buffer.includes(marker) — search for a byte sequence */
export function bytesIncludes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true
  const needle0 = needle[0]
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (haystack[i] !== needle0) continue
    let j = 1
    for (; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) break
    }
    if (j === needle.length) return true
  }
  return false
}

// --- PNG helpers ---

/** Buffer.alloc(size) → new Uint8Array(size) */
export function allocBytes(size: number): Uint8Array {
  return new Uint8Array(size)
}

/** Buffer.from([0x01, 0x02, ...]) → new Uint8Array */
export function fromBytes(arr: number[]): Uint8Array {
  return new Uint8Array(arr)
}

/** buf.writeUInt32BE(value, offset) */
export function writeUInt32BE(buf: Uint8Array, value: number, offset: number) {
  const dv = new DataView(buf.buffer, buf.byteOffset + offset, 4)
  dv.setUint32(0, value, false) // false = big endian
}

/** buf.write(str, offset, 'ascii') — write ASCII string */
export function writeAscii(buf: Uint8Array, str: string, offset: number) {
  for (let i = 0; i < str.length; i++) {
    buf[offset + i] = str.charCodeAt(i)
  }
}

/** Buffer.from(str, 'ascii') → Uint8Array of ASCII bytes */
export function asciiToBytes(str: string): Uint8Array {
  const buf = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i)
  }
  return buf
}

/** Buffer.concat([a, b, c]) → concat Uint8Arrays */
export function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

/** CRC32 computation (PNG needs this) — simple implementation */
function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let crc = n
    for (let k = 0; k < 8; k++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[n] = crc
  }
  return table
}
const CRC_TABLE = makeCrcTable()

export function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// --- Crypto helpers ---

/** SHA-256 hash using Web Crypto API */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Copy into an ArrayBuffer-backed view: `digest` types its input as BufferSource,
  // which excludes Uint8Array over a SharedArrayBuffer.
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(data))
  return new Uint8Array(hash)
}

/** SHA-256 hex string */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await sha256(data)
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** UUID using Web Crypto */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

// --- Deflate ---

/**
 * Sync deflate for PNG IDAT chunks. Uses pako if available,
 * otherwise a minimal DEFLATE implementation for solid-color PNG.
 *
 * Import note: this re-exports from pako. Add pako as a dependency:
 * npm install pako --save
 */
export async function loadDeflate(): Promise<(data: Uint8Array) => Uint8Array> {
  const pako = (await import('pako')) as unknown as {
    deflate(data: Uint8Array, options?: { level?: number }): Uint8Array
  }
  return (data: Uint8Array) => {
    const result = pako.deflate(data)
    return new Uint8Array(result)
  }
}
