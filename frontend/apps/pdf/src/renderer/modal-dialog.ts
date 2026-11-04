/**
 * Modal contract shared by the .pdf-modal dialogs, now built on the common
 * `@yiioffice/ui` behaviour: Escape cancels (unless the dialog hands the key to
 * a nested popover), Tab cycles inside the card, the first field takes focus on
 * open, the opener gets it back on close, and the page behind is inert.
 * Put the ref on the dialog card.
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { installModalBehavior } from '@yiioffice/ui'

export function useModalDialog(
  onCancel: () => void,
  { escape = true, initialFocus }: { escape?: boolean; initialFocus?: string } = {},
): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onCancel)
  closeRef.current = onCancel
  const escapeRef = useRef(escape)
  escapeRef.current = escape
  // Read during render: an autoFocus child already owns focus once effects run
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    return installModalBehavior(dialogRef.current, {
      onClose: () => closeRef.current(),
      escape: () => escapeRef.current,
      initialFocus,
      restoreFocus: true,
      opener,
    })
  }, [opener])

  return dialogRef
}
