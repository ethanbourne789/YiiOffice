import { describe, expect, it } from 'vitest'
import { parseBridgeError } from './error-code'

describe('parseBridgeError', () => {
  it('splits a coded error into code and diagnostics', () => {
    expect(parseBridgeError('export_render_failed: printer offline')).toEqual({
      code: 'export_render_failed',
      detail: 'printer offline',
    })
  })

  it('accepts a bare code without detail', () => {
    expect(parseBridgeError('workbook_password_required')).toEqual({
      code: 'workbook_password_required',
      detail: '',
    })
  })

  it('keeps detail that itself contains a colon', () => {
    const parsed = parseBridgeError('update_feed_http_error: HTTP 500: upstream error')
    expect(parsed.code).toBe('update_feed_http_error')
    expect(parsed.detail).toBe('HTTP 500: upstream error')
  })

  it('treats plain English as unmapped so the caller can fall back', () => {
    expect(parseBridgeError('read file: no such file')).toEqual({
      code: null,
      detail: 'read file: no such file',
    })
    expect(parseBridgeError('save failed')).toEqual({ code: null, detail: 'save failed' })
  })

  it('reads Error instances and ignores non-strings', () => {
    expect(parseBridgeError(new Error('open_read_failed: gone')).code).toBe('open_read_failed')
    expect(parseBridgeError(undefined)).toEqual({ code: null, detail: '' })
  })
})
