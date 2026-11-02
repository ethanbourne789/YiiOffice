import { describe, expect, it } from 'vitest'
import { normalizeDocxSave, toBase64, toBytes } from './binary'

describe('binary payload adapter', () => {
  it('encodes an ArrayBuffer the way Go decodes it (base64.StdEncoding)', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // "PK\u0003\u0004"
    const encoded = toBase64(bytes.buffer)
    expect(encoded).toBe('UEsDBA==')
    expect(atob(encoded)).toBe('PK\u0003\u0004')
  })

  it('encodes a typed-array view without the surrounding buffer', () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5])
    const view = backing.subarray(1, 4)
    expect(toBase64(view)).toBe(toBase64(new Uint8Array([2, 3, 4])))
  })

  it('passes an already-base64 string through unchanged', () => {
    expect(toBase64('UEsDBA==')).toBe('UEsDBA==')
  })

  it('round-trips a payload larger than one encoding chunk', () => {
    const big = new Uint8Array(70_000)
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251
    const encoded = toBase64(big)
    const decoded = atob(encoded)
    expect(decoded.length).toBe(big.length)
    expect(decoded.charCodeAt(0)).toBe(0)
    expect(decoded.charCodeAt(69_999)).toBe(69_999 % 251)
    expect(toBytes(big).length).toBe(big.length)
  })
})

describe('normalizeDocxSave', () => {
  it('maps the Go DocxSaveResult to the Electron-era shape', () => {
    expect(normalizeDocxSave({ path: 'C:/x.docx', ok: true })).toEqual({
      ok: true,
      path: 'C:/x.docx',
    })
  })

  it('keeps the failure reason the editor shows in its status bar', () => {
    expect(normalizeDocxSave({ ok: false, error: 'disk full' })).toEqual({
      ok: false,
      error: 'disk full',
    })
  })

  it('treats an all-empty result as a canceled dialog', () => {
    expect(normalizeDocxSave({})).toEqual({ ok: false, canceled: true })
  })

  it('never reports ok for a missing or malformed result', () => {
    expect(normalizeDocxSave(null)).toEqual({ ok: false })
    expect(normalizeDocxSave('nope')).toEqual({ ok: false })
  })
})
