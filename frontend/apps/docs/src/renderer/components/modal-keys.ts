/**
 * Docs dialogs now use the shared modal contract in `@yiioffice/ui`: Escape
 * closes from any focus position, Tab cycles inside the backdrop, the opener
 * gets focus back on close, and the page behind is inert for the duration.
 * The local module stays as the single import point for the ~20 dialogs that
 * already spread `ref` / `onKeyDown` onto their `.modal-backdrop`.
 */
import { trapTab, useModalDialog } from '@yiioffice/ui'

export { trapTab }

export function useModalKeys(onClose: () => void) {
  const modal = useModalDialog(onClose, { restoreFocus: true })
  return { ref: modal.ref, onKeyDown: modal.onKeyDown }
}

export function focusOutsideModal(container: HTMLElement | null): boolean {
  const active = document.activeElement
  return !active || active === document.body || !container?.contains(active)
}
