/**
 * Classifies workbook open failures by the stable codes internal/workbook
 * prefixes onto its errors, so the renderer can tell an encrypted workbook
 * (ask for a password) from a damaged one (report corruption). The raw
 * message is never shown once a code matched.
 */
export type WorkbookOpenFailure =
  | { readonly kind: 'password-required'; readonly path: string }
  | { readonly kind: 'password-incorrect' }
  | { readonly kind: 'encryption-unsupported' }
  | { readonly kind: 'damaged' }

const PASSWORD_REQUIRED = 'workbook_password_required'
const PASSWORD_INCORRECT = 'workbook_password_incorrect'
const ENCRYPTION_UNSUPPORTED = 'workbook_encryption_unsupported'
const CORRUPT = 'workbook_corrupt'

/** Error text of a rejected bridge call (Wails rejects with an Error). */
export function workbookOpenErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

export function classifyWorkbookOpenError(message: string): WorkbookOpenFailure | null {
  const required = message.indexOf(PASSWORD_REQUIRED)
  if (required >= 0) {
    // The Go side appends '|' + the original path so the retry can reopen the
    // same file without a second picker. Windows forbids '|' in file names,
    // so everything after the first separator is the path.
    const rest = message.slice(required + PASSWORD_REQUIRED.length).trim()
    const path = (rest.startsWith('|') ? rest.slice(1) : '').replace(/^["']|["']$/g, '').trim()
    return path === '' ? null : { kind: 'password-required', path }
  }
  if (message.includes(PASSWORD_INCORRECT)) return { kind: 'password-incorrect' }
  if (message.includes(ENCRYPTION_UNSUPPORTED)) return { kind: 'encryption-unsupported' }
  if (message.includes(CORRUPT)) return { kind: 'damaged' }
  return null
}
