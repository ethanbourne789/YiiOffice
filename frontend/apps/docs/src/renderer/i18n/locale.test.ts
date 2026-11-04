import { describe, expect, it } from 'vitest'
import { bridgeErrorText } from './locale'
import { strings } from './strings'

describe('bridgeErrorText', () => {
  it('shows localized copy for a coded backend failure, never the raw detail', () => {
    const out = bridgeErrorText('open_read_failed: ENOENT: no such file or directory')
    expect(out).toBe(strings.zh.err_open_read_failed)
    expect(out).not.toContain('ENOENT')
  })

  it('falls back to generic copy for unmapped codes and raw English', () => {
    expect(bridgeErrorText('unknown_domain_code: boom')).toBe(strings.zh.errGeneric)
    expect(bridgeErrorText('read file: no such file')).toBe(strings.zh.errGeneric)
    expect(bridgeErrorText('')).toBe(strings.zh.errGeneric)
  })
})
