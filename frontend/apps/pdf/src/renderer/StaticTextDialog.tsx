/** The text-entry dialog, and the draft behind it.

    One dialog serves four jobs: label a static form, insert a real text object,
    edit an inserted object, edit a baked form label. Three of them used to be
    tracked as separate editor states (`purpose`, an edit target of two shapes, and
    the id of an inserted object being edited), which meant every open path had to
    set all of them and every close path had to clear all of them -- and the two
    sides disagreed: the mask cleared the target, the OK button of the insert case
    did not.

    Here `target` is opaque and generic: the dialog never asks what it holds, only
    whether there is one (which decides the title), and closing clears it in one
    place. The draft deliberately survives a close -- placing a static form label
    is click-to-place after the dialog is gone, and the placed image is rendered
    from the draft at that moment. */

import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Dropdown, useDismissablePopover } from '@yiioffice/ui'
import { ColorPickerPopover } from './ColorPicker'
import type { TFunc } from './i18n/locale'
import { ModalActions, ModalCard } from './ModalCard'

export type TextAlign = 'left' | 'center' | 'right'
export type StaticTextPurpose = 'form' | 'insert'

export interface TextDraft {
  text: string
  size: number
  color: string
  align: TextAlign
}

/** Fields to set on open; anything omitted keeps its previous value, because the
    openers disagree on purpose -- "add a label" clears the text but keeps the size
    you used last time, "edit this one" takes all four from the record. */
export interface StaticTextOpen<T> {
  purpose: StaticTextPurpose
  target?: T | null
  text?: string
  size?: number
  color?: string
  align?: TextAlign
}

export interface StaticTextState<T> {
  open: boolean
  purpose: StaticTextPurpose
  /** What is being edited, if anything; opaque to this module */
  target: T | null
  draft: TextDraft
  colorOpen: boolean
  show: (init: StaticTextOpen<T>) => void
  /** Closes and forgets the target; the draft stays for click-to-place */
  close: () => void
  setText: (value: string) => void
  setSize: (value: number) => void
  setColor: (value: string) => void
  setAlign: (value: TextAlign) => void
  toggleColor: () => void
  closeColor: () => void
}

const SIZE_MIN = 6
const SIZE_MAX = 72
const DEFAULT_SIZE = 14
const DEFAULT_COLOR = '#111111'

export function useStaticTextDialog<T = never>(): StaticTextState<T> {
  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState<StaticTextPurpose>('form')
  const [target, setTarget] = useState<T | null>(null)
  const [text, setText] = useState('')
  const [size, setSizeValue] = useState(DEFAULT_SIZE)
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [align, setAlign] = useState<TextAlign>('left')
  const [colorOpen, setColorOpen] = useState(false)

  return {
    open,
    purpose,
    target,
    draft: { text, size, color, align },
    colorOpen,
    show: (init) => {
      setPurpose(init.purpose)
      setTarget(init.target ?? null)
      if (init.text !== undefined) setText(init.text)
      if (init.size !== undefined) setSizeValue(clampSize(init.size))
      if (init.color !== undefined) setColor(init.color)
      if (init.align !== undefined) setAlign(init.align)
      setColorOpen(false)
      setOpen(true)
    },
    close: () => {
      setOpen(false)
      setTarget(null)
      setColorOpen(false)
    },
    setText,
    // A cleared number field reads as 0, and 0-point text is invisible; fall back
    // to the default instead of clamping to the minimum
    setSize: (value) => setSizeValue(clampSize(value)),
    setColor,
    setAlign,
    toggleColor: () => setColorOpen((was) => !was),
    closeColor: () => setColorOpen(false),
  }
}

function clampSize(value: number): number {
  if (!Number.isFinite(value) || value === 0) return DEFAULT_SIZE
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, value))
}

export interface StaticTextDialogProps<T> {
  t: TFunc
  state: StaticTextState<T>
  /** Already translated; the dialog does not know what it is editing */
  title: string
  onConfirm: () => void
  onCancel: () => void
}

export function StaticTextDialog<T>({
  t,
  state,
  title,
  onConfirm,
  onCancel,
}: StaticTextDialogProps<T>): ReactElement | null {
  const colorFieldRef = useRef<HTMLDivElement | null>(null)
  // The color popover is inside the dialog, so clicking it must not count as an
  // outside click -- the dialog itself stays open
  useDismissablePopover(state.colorOpen, state.closeColor, {
    inside: () => [colorFieldRef.current],
  })

  if (!state.open) return null
  const { text, size, color, align } = state.draft

  return (
    <ModalCard label={title} onCancel={onCancel}>
      <div className="pdf-modal-title">{title}</div>
      <textarea
        className="pdf-modal-textarea"
        data-cmd="dialogInput"
        value={text}
        placeholder={t('formAddTextPlaceholder')}
        autoFocus
        onChange={(e) => state.setText(e.target.value)}
      />
      <label className="pdf-field">
        <span>{t('formTextSize')}</span>
        <input
          className="pdf-modal-input"
          data-cmd="dialogTextSize"
          type="number"
          min={SIZE_MIN}
          max={SIZE_MAX}
          value={size}
          onChange={(e) => state.setSize(Number(e.target.value))}
        />
      </label>
      <div className="pdf-field-grid">
        <div ref={colorFieldRef} className="pdf-field pdf-color-field">
          <span>{t('formTextColor')}</span>
          <button
            type="button"
            className="pdf-color-trigger"
            data-cmd="dialogTextColor"
            aria-expanded={state.colorOpen}
            onClick={state.toggleColor}
          >
            <span className="pdf-color-trigger-swatch" style={{ background: color }} />
            <span>{color.toUpperCase()}</span>
          </button>
          {state.colorOpen && (
            <ColorPickerPopover value={color} onPick={state.setColor} onClose={state.closeColor} />
          )}
        </div>
        <label className="pdf-field">
          <span>{t('formTextAlign')}</span>
          <Dropdown
            className="pdf-modal-dd"
            ariaLabel={t('formTextAlign')}
            value={align}
            options={[
              { value: 'left', label: t('formAlignLeft') },
              { value: 'center', label: t('formAlignCenter') },
              { value: 'right', label: t('formAlignRight') },
            ]}
            onPick={state.setAlign}
          />
        </label>
      </div>
      <ModalActions
        t={t}
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmDisabled={!text.trim()}
      />
    </ModalCard>
  )
}
