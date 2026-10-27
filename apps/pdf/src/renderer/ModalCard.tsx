/** The shell every `.pdf-modal` dialog shares: mask, card, dialog semantics, and
    the cancel/ok row.

    It was written six times inline in the editor component before the page-op
    dialogs moved out, and the copies had already drifted (some handled Escape on
    the window, some only on their first input). `useModalDialog` supplies the
    parts that are easy to get subtly wrong: Escape from any focus position,
    focus into the first field, and focus restored to the opener on close.

    `data-cmd` on the two action buttons is the same hook convention the ribbon
    uses, so a test can confirm a dialog without matching translated text. */

import type { ReactElement, ReactNode } from 'react'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'

export function ModalCard({
  label,
  onCancel,
  wide = false,
  children,
}: {
  /** Accessible name; the dialog's own title, already translated */
  label: string
  onCancel: () => void
  wide?: boolean
  children: ReactNode
}): ReactElement {
  const dialogRef = useModalDialog(onCancel)
  return (
    <div className="pdf-modal-mask" onClick={onCancel}>
      <div
        ref={dialogRef}
        className={`pdf-modal${wide ? ' pdf-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/** Cancel + OK. `okLabel` lets a dialog name the action ("Print", "Extract"). */
export function ModalActions({
  t,
  onCancel,
  onConfirm,
  okLabel,
}: {
  t: TFunc
  onCancel: () => void
  onConfirm?: () => void
  okLabel?: string
}): ReactElement {
  return (
    <div className="pdf-modal-actions">
      <button className="pdf-modal-btn" data-cmd="dialogCancel" onClick={onCancel}>
        {t('cancel')}
      </button>
      {onConfirm && (
        <button className="pdf-modal-btn primary" data-cmd="dialogOk" onClick={onConfirm}>
          {okLabel ?? t('ok')}
        </button>
      )}
    </div>
  )
}
