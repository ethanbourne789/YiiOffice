import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { installModalBehavior } from '@yiioffice/ui'
import { useEscOverlay } from '../esc-overlay'

export interface ModalDialogProps {
  ref: RefObject<HTMLDivElement | null>
  role: 'dialog'
  'aria-modal': true
  'aria-labelledby': string
}

/**
 * Dialog contract shared by the .modal cards (same behaviour as PrintDialog):
 * Escape closes through the overlay registry, Tab cycles inside the card, the
 * first control takes focus on open, the opener gets it back on close, the
 * page behind is inert, and the card is announced by its heading. Spread
 * `dialogProps` onto the card and give the <h2> `titleId`.
 */
export function useModalDialog(onClose: () => void): {
  titleId: string
  dialogProps: ModalDialogProps
} {
  useEscOverlay(true, onClose)
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Read during render: an autoFocus child already owns focus once effects run
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    return installModalBehavior(ref.current, {
      onClose: () => closeRef.current(),
      // useEscOverlay already owns Escape for the slide deck (incl. nested popovers)
      escape: false,
      restoreFocus: true,
      opener,
    })
  }, [opener])

  return {
    titleId,
    dialogProps: { ref, role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId },
  }
}
