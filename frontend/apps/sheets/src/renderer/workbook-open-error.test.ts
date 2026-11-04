import { describe, expect, it } from 'vitest'
import { classifyWorkbookOpenError, workbookOpenErrorMessage } from './workbook-open-error'

describe('classifyWorkbookOpenError', () => {
  it('extracts the retry path from a password-required error', () => {
    expect(classifyWorkbookOpenError(String.raw`workbook_password_required|C:\Users\a\Book1.xlsx`)).toEqual({
      kind: 'password-required',
      path: String.raw`C:\Users\a\Book1.xlsx`,
    })
  })

  it('classifies the remaining codes', () => {
    expect(classifyWorkbookOpenError('workbook_password_incorrect')).toEqual({ kind: 'password-incorrect' })
    expect(classifyWorkbookOpenError('workbook_encryption_unsupported: mech')).toEqual({
      kind: 'encryption-unsupported',
    })
    expect(classifyWorkbookOpenError('workbook_corrupt: zip: not a valid zip file')).toEqual({
      kind: 'damaged',
    })
  })

  it('does not prompt when the code carries no path', () => {
    expect(classifyWorkbookOpenError('workbook_password_required')).toBeNull()
  })

  it('returns null for unrelated failures', () => {
    expect(classifyWorkbookOpenError('unknown session "x"')).toBeNull()
    expect(classifyWorkbookOpenError('')).toBeNull()
  })

  it('reads the message of a rejected bridge call', () => {
    expect(workbookOpenErrorMessage(new Error('workbook_corrupt'))).toBe('workbook_corrupt')
    expect(workbookOpenErrorMessage('workbook_corrupt')).toBe('workbook_corrupt')
    expect(workbookOpenErrorMessage({})).toBe('')
  })
})
