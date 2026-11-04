/**
 * Excel-style modal contract for the Sheets dialogs, now a thin adapter over
 * the shared `@yiioffice/ui` modal behaviour: Escape closes, Tab cycles inside
 * the card, the first control takes focus on open, the opener gets it back on
 * close, and the page behind is inert while the card is open. The imperative
 * dialogs (`save-loss-dialog`, `workbook-password-dialog`, `csv-confirm`) call
 * `installModalBehavior` from the same module directly.
 */
import { useModalDialog as useSharedModalDialog } from '@yiioffice/ui'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

export interface ModalDialogProps {
  readonly ref: RefObject<HTMLDivElement | null>
  readonly 'aria-modal': true
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/// Spread the result onto the role="dialog" node.
export function useModalDialog(onClose: () => void): ModalDialogProps {
  const modal = useSharedModalDialog(onClose, { restoreFocus: true })
  return { ref: modal.ref, 'aria-modal': true, onKeyDown: modal.onKeyDown }
}
