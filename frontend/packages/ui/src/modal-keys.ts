/**
 * Shared modal keyboard and focus contract for every renderer dialog.
 *
 * One implementation owns the parts the per-app copies kept getting subtly
 * wrong:
 *  - focus moves into the dialog on open (a named control, else the first
 *    enabled control);
 *  - Tab / Shift+Tab cycle inside the dialog and never walk into the page
 *    behind it;
 *  - Escape closes through a handler attached to the dialog itself, so it
 *    works even after a click moved focus onto non-focusable card content;
 *  - focus returns to the element that opened the dialog;
 *  - the rest of the page is marked `inert` + `aria-hidden` while the dialog
 *    is open, and every dialog node carries `role="dialog"` semantics.
 *
 * React callers use `useModalDialog`; imperative DOM dialogs (the pre-save
 * confirmation, the workbook password prompt) call `installModalBehavior`
 * directly. `useModalKeys` is the older, narrower shape kept for call sites
 * that only spread `ref` / `onKeyDown`.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE', 'HEAD'])

export interface ModalBehaviorOptions {
  /** Called by Escape and by the fallback listener when focus left the dialog */
  onClose: () => void
  /** Escape closes the dialog (default true); pass a function for dynamic state */
  escape?: boolean | (() => boolean) | undefined
  /**
   * Control focused on open: a selector or element. When omitted the first
   * enabled focusable element is used (an autoFocus child keeps its focus).
   */
  initialFocus?: string | HTMLElement | null | undefined
  /** Return focus to the opener on close (default true) */
  restoreFocus?: boolean | undefined
  /** Mark the page behind the dialog inert / aria-hidden (default true) */
  hideBackground?: boolean | undefined
  /** Element that opened the dialog; defaults to the element focused at install */
  opener?: HTMLElement | null | undefined
}

export interface ModalDialogProps {
  ref: RefObject<HTMLDivElement | null>
  'aria-modal': true
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

const focusable = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0,
  )

/** Cycle Tab/Shift+Tab inside a container (pure DOM helper, exported for tests). */
export function trapTab(
  container: HTMLElement | null,
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
): void {
  if (!container || e.key !== 'Tab') return
  const items = focusable(container)
  if (items.length === 0) {
    e.preventDefault()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  const inside = active !== null && container.contains(active)
  // The backdrop may hold focus itself (tabIndex={-1}), and a click on plain
  // card content leaves focus on <body>: both count as "at the edge" so the
  // wrap has to name them, otherwise Tab walks into the page behind.
  if (e.shiftKey && (active === first || active === container || !inside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || active === container || !inside)) {
    e.preventDefault()
    first.focus()
  }
}

interface BackgroundMark {
  count: number
  ariaHidden: string | null
  inert: boolean
}

/** Shared by every open dialog so nested/stacked dialogs cannot un-hide early. */
const backgroundMarks = new Map<HTMLElement, BackgroundMark>()

function markHidden(node: HTMLElement): void {
  const mark = backgroundMarks.get(node)
  if (mark) {
    mark.count += 1
    return
  }
  backgroundMarks.set(node, {
    count: 1,
    ariaHidden: node.getAttribute('aria-hidden'),
    inert: node.hasAttribute('inert'),
  })
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('inert', '')
}

function unmarkHidden(node: HTMLElement): void {
  const mark = backgroundMarks.get(node)
  if (!mark) return
  mark.count -= 1
  if (mark.count > 0) return
  backgroundMarks.delete(node)
  if (mark.ariaHidden === null) node.removeAttribute('aria-hidden')
  else node.setAttribute('aria-hidden', mark.ariaHidden)
  if (!mark.inert) node.removeAttribute('inert')
}

/**
 * Hide everything that is not an ancestor of the dialog: siblings at every
 * level up to <body>, so both an in-app overlay and a body-level portal work.
 * Returns the undo function.
 */
function hideBackground(container: HTMLElement): () => void {
  const marked: HTMLElement[] = []
  let node: HTMLElement = container
  while (node.parentElement) {
    const parent = node.parentElement
    for (const child of [...parent.children]) {
      if (child === node || !(child instanceof HTMLElement)) continue
      if (NON_CONTENT_TAGS.has(child.tagName)) continue
      markHidden(child)
      marked.push(child)
    }
    if (parent === document.body) break
    node = parent
  }
  return () => marked.forEach(unmarkHidden)
}

let modalTitleSeq = 0

/**
 * Make the dialog node announced as a modal with a name. Existing labels win;
 * when a dialog has neither aria-label nor aria-labelledby its first heading
 * supplies the name (no new copy, the id is generated).
 */
function ensureDialogSemantics(container: HTMLElement): () => void {
  const dialog = container.matches('[role="dialog"]')
    ? container
    : container.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) return () => {}
  const hadAriaModal = dialog.getAttribute('aria-modal')
  if (hadAriaModal === null) dialog.setAttribute('aria-modal', 'true')

  let generatedLabelFor: string | null = null
  if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
    const heading = dialog.querySelector<HTMLElement>('h1, h2, h3')
    if (heading) {
      const hadId = heading.id !== ''
      if (!hadId) heading.id = `yiioffice-modal-title-${++modalTitleSeq}`
      generatedLabelFor = heading.id
      dialog.setAttribute('aria-labelledby', generatedLabelFor)
      return () => {
        if (hadAriaModal === null) dialog.removeAttribute('aria-modal')
        else dialog.setAttribute('aria-modal', hadAriaModal)
        dialog.removeAttribute('aria-labelledby')
        if (!hadId) heading.removeAttribute('id')
      }
    }
  }
  return () => {
    if (hadAriaModal === null) dialog.removeAttribute('aria-modal')
    else dialog.setAttribute('aria-modal', hadAriaModal)
  }
}

function resolveInitialFocus(
  container: HTMLElement,
  initialFocus: ModalBehaviorOptions['initialFocus'],
): HTMLElement | null {
  if (initialFocus instanceof HTMLElement) return initialFocus
  if (typeof initialFocus === 'string') return container.querySelector<HTMLElement>(initialFocus)
  return null
}

function escapeEnabled(option: ModalBehaviorOptions['escape']): boolean {
  return typeof option === 'function' ? option() : option !== false
}

/**
 * Attach the shared modal behaviour to an already-mounted dialog container
 * (the node that receives keyboard events, usually the card or backdrop).
 * Returns a cleanup that also restores focus and un-hides the background.
 */
export function installModalBehavior(
  container: HTMLElement | null,
  options: ModalBehaviorOptions,
): () => void {
  if (!container) return () => {}
  const close = options.onClose
  const opener =
    options.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)

  // Focus in first, so marking the opener's subtree inert cannot blur it.
  let addedContainerTabIndex = false
  if (!container.contains(document.activeElement)) {
    const preferred = resolveInitialFocus(container, options.initialFocus)
    // A named control that is disabled while content loads (e.g. the cutout
    // tolerance slider) cannot take focus; fall back to the first enabled
    // control instead of leaving focus outside the dialog.
    const target =
      (preferred && !preferred.hasAttribute('disabled') ? preferred : null) ??
      focusable(container)[0] ??
      preferred ??
      container
    if (target === container && container.tabIndex < 0) {
      container.setAttribute('tabindex', '-1')
      addedContainerTabIndex = true
    }
    target.focus()
  }

  const restoreSemantics = ensureDialogSemantics(container)
  const restoreBackground = options.hideBackground === false ? () => {} : hideBackground(container)

  const handleKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (!escapeEnabled(options.escape)) return
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Tab') trapTab(container, event)
  }

  // A click on non-focusable card content drops focus to <body>, where the
  // container never sees the key: catch it on window while focus is outside.
  const onWindowKey = (event: KeyboardEvent): void => {
    if (container.contains(document.activeElement)) return
    handleKey(event)
  }

  container.addEventListener('keydown', handleKey)
  window.addEventListener('keydown', onWindowKey)

  return () => {
    container.removeEventListener('keydown', handleKey)
    window.removeEventListener('keydown', onWindowKey)
    // Un-hide before restoring focus: browsers refuse focus into an inert tree.
    restoreBackground()
    restoreSemantics()
    if (addedContainerTabIndex) container.removeAttribute('tabindex')
    if (options.restoreFocus !== false && opener && opener !== document.body && opener.isConnected) {
      opener.focus()
    }
  }
}

/**
 * React binding for `installModalBehavior`. Spread `ref` and `onKeyDown` onto
 * the element that wraps the dialog content (the card when it fills the
 * overlay, otherwise the backdrop).
 */
export function useModalDialog(
  onClose: () => void,
  options?: Omit<ModalBehaviorOptions, 'onClose' | 'opener'>,
): ModalDialogProps {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const optionsRef = useRef(options)
  optionsRef.current = options
  // Capture during render: an autoFocus child owns focus once the effect runs.
  const [opener] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  useEffect(() => {
    const current = optionsRef.current
    return installModalBehavior(ref.current, {
      onClose: () => closeRef.current(),
      escape: current?.escape,
      initialFocus: current?.initialFocus,
      restoreFocus: current?.restoreFocus,
      hideBackground: current?.hideBackground,
      opener,
    })
  }, [opener])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (!escapeEnabled(optionsRef.current?.escape)) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
      return
    }
    if (event.key === 'Tab') trapTab(ref.current, event)
  }

  return { ref, 'aria-modal': true, onKeyDown }
}

/**
 * Narrow compatibility wrapper: `restoreFocus` stays opt-in here because this
 * shape predates the shared contract and is still spread by older call sites.
 */
export function useModalKeys(
  onClose: () => void,
  options?: { restoreFocus?: boolean | undefined },
): { ref: RefObject<HTMLDivElement | null>; onKeyDown: ModalDialogProps['onKeyDown'] } {
  const { ref, onKeyDown } = useModalDialog(onClose, { restoreFocus: options?.restoreFocus })
  return { ref, onKeyDown }
}
