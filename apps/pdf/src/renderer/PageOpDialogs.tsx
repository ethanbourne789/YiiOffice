/** Page-operation dialogs: extract / split-every-N / merge-N-up / replace / page
    size / split-into-grid.

    They were six inline `{flag && (...)}` blocks inside the editor component,
    each repeating the same mask + card + title + cancel/ok row, and each holding
    its own `open` / `input` / `invalid` triple -- nine states for three dialogs
    that differ only in their title, hint and confirm callback. The shell and the
    state live here now:

    - `useTextEntry` replaces the triples (open + value + invalid) with one
      object, so "open with a value" and "the input was rejected" stop being
      three separate setState calls every caller has to remember.
    - the mask/card/Escape/focus handling comes from `useModalDialog`, the same
      contract the other extracted dialogs follow.

    Escape is deliberately not handled on the input itself: `useModalDialog`
    listens on the window, so the dialog closes from any focus position, and a
    second handler would fire the cancel twice. */

import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'
import { PAPER_SIZES } from './view-config'

/** Open + value + invalid, the state every text-entry dialog needs. */
export interface TextEntry {
  isOpen: boolean
  value: string
  invalid: boolean
  /** Open with a starting value ('' for "type a range", the current page for replace) */
  show: (value: string) => void
  edit: (value: string) => void
  close: () => void
  /** The last confirm was rejected: mark the field, keep the dialog open */
  fail: () => void
}

export function useTextEntry(): TextEntry {
  const [isOpen, setIsOpen] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  return {
    isOpen,
    value,
    invalid,
    show: (next) => {
      setValue(next)
      setInvalid(false)
      setIsOpen(true)
    },
    edit: (next) => {
      setValue(next)
      setInvalid(false)
    },
    close: () => setIsOpen(false),
    fail: () => setInvalid(true),
  }
}

/** N-up merge options: count, sequence and the separator toggle. */
export interface MergeDialogState {
  isOpen: boolean
  count: string
  invalid: boolean
  direction: 'horizontal' | 'vertical'
  separator: boolean
  show: () => void
  editCount: (count: string) => void
  setDirection: (direction: 'horizontal' | 'vertical') => void
  setSeparator: (separator: boolean) => void
  close: () => void
  fail: () => void
}

export function useMergeDialog(): MergeDialogState {
  const [isOpen, setIsOpen] = useState(false)
  const [count, setCount] = useState('2')
  const [invalid, setInvalid] = useState(false)
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('vertical')
  const [separator, setSeparator] = useState(false)
  return {
    isOpen,
    count,
    invalid,
    direction,
    separator,
    // every open starts from the defaults: the previous run's options would
    // otherwise silently apply to the next merge
    show: () => {
      setCount('2')
      setInvalid(false)
      setDirection('vertical')
      setSeparator(false)
      setIsOpen(true)
    },
    editCount: (next) => {
      setCount(next)
      setInvalid(false)
    },
    setDirection,
    setSeparator,
    close: () => setIsOpen(false),
    fail: () => setInvalid(true),
  }
}

/** Mask + card + dialog semantics. One copy instead of one per dialog. */
function ModalCard({
  label,
  onCancel,
  children,
}: {
  label: string
  onCancel: () => void
  children: ReactNode
}): ReactElement {
  const dialogRef = useModalDialog(onCancel)
  return (
    <div className="pdf-modal-mask" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="pdf-modal"
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

function Actions({
  t,
  onCancel,
  onConfirm,
}: {
  t: TFunc
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  return (
    <div className="pdf-modal-actions">
      <button className="pdf-modal-btn" data-cmd="dialogCancel" onClick={onCancel}>
        {t('cancel')}
      </button>
      <button className="pdf-modal-btn primary" data-cmd="dialogOk" onClick={onConfirm}>
        {t('ok')}
      </button>
    </div>
  )
}

export interface RangeDialogProps {
  t: TFunc
  /** Already-translated title (also the accessible name) */
  title: string
  /** Already-translated placeholder, e.g. "1-3,5 (of 12)" */
  hint: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

/** "Which pages" prompt: extract, replace and split-every-N share this shape. */
export function RangeDialog({
  t,
  title,
  hint,
  value,
  invalid,
  onChange,
  onConfirm,
  onCancel,
}: RangeDialogProps): ReactElement {
  return (
    <ModalCard label={title} onCancel={onCancel}>
      <div className="pdf-modal-title">{title}</div>
      <input
        className={`pdf-modal-input${invalid ? ' invalid' : ''}`}
        data-cmd="dialogInput"
        value={value}
        placeholder={hint}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm()
        }}
      />
      <Actions t={t} onCancel={onCancel} onConfirm={onConfirm} />
    </ModalCard>
  )
}

export interface MergePagesDialogProps {
  t: TFunc
  hint: string
  state: MergeDialogState
  onConfirm: () => void
}

/** N-up merge: pages per sheet, horizontal/vertical sequence, optional separator. */
export function MergePagesDialog({
  t,
  hint,
  state,
  onConfirm,
}: MergePagesDialogProps): ReactElement {
  return (
    <ModalCard label={t('mergePages')} onCancel={state.close}>
      <div className="pdf-modal-title">{t('mergePages')}</div>
      <div className="pdf-modal-hint">{hint}</div>
      <label className="pdf-modal-row">
        <span>{t('mergePagesCount')}</span>
        <input
          className={`pdf-modal-input${state.invalid ? ' invalid' : ''}`}
          data-cmd="dialogInput"
          value={state.count}
          autoFocus
          onChange={(e) => state.editCount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm()
          }}
        />
      </label>
      <div className="pdf-modal-row">
        <span>{t('mergePagesSeq')}</span>
        <label className="pdf-modal-check">
          <input
            type="radio"
            name="merge-seq"
            checked={state.direction === 'horizontal'}
            onChange={() => state.setDirection('horizontal')}
          />
          {t('seqHorizontal')}
        </label>
        <label className="pdf-modal-check">
          <input
            type="radio"
            name="merge-seq"
            checked={state.direction === 'vertical'}
            onChange={() => state.setDirection('vertical')}
          />
          {t('seqVertical')}
        </label>
      </div>
      <label className="pdf-modal-check">
        <input
          type="checkbox"
          checked={state.separator}
          onChange={(e) => state.setSeparator(e.target.checked)}
        />
        {t('mergePagesSeparator')}
      </label>
      <Actions t={t} onCancel={state.close} onConfirm={onConfirm} />
    </ModalCard>
  )
}

/** Pick a paper size; the caller resizes every page to it. */
export function PageSizeDialog({
  t,
  hint,
  onPick,
  onCancel,
}: {
  t: TFunc
  hint: string
  onPick: (width: number, height: number) => void
  onCancel: () => void
}): ReactElement {
  const row = (sizes: readonly { label: string; w: number; h: number }[]): ReactElement => (
    <div className="pdf-modal-actions merge-pages-options">
      {sizes.map((p) => (
        <button key={p.label} className="pdf-modal-btn" onClick={() => onPick(p.w, p.h)}>
          {p.label}
        </button>
      ))}
    </div>
  )
  return (
    <ModalCard label={t('pageSize')} onCancel={onCancel}>
      <div className="pdf-modal-title">{t('pageSize')}</div>
      <div className="pdf-modal-hint">{hint}</div>
      {row(PAPER_SIZES.slice(0, 3))}
      {row(PAPER_SIZES.slice(3))}
      <div className="pdf-modal-actions">
        <button className="pdf-modal-btn" data-cmd="dialogCancel" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </ModalCard>
  )
}

/** Split every page into an N-up grid, written to a new file. */
export function SplitPagesDialog({
  t,
  hint,
  onPick,
  onCancel,
}: {
  t: TFunc
  hint: string
  onPick: (perPage: 2 | 4 | 9) => void
  onCancel: () => void
}): ReactElement {
  return (
    <ModalCard label={t('splitPages')} onCancel={onCancel}>
      <div className="pdf-modal-title">{t('splitPages')}</div>
      <div className="pdf-modal-hint">{hint}</div>
      <div className="pdf-modal-actions merge-pages-options">
        {([2, 4, 9] as const).map((n) => (
          <button key={n} className="pdf-modal-btn" onClick={() => onPick(n)}>
            {t('splitNLabel', { n })}
          </button>
        ))}
      </div>
      <div className="pdf-modal-actions">
        <button className="pdf-modal-btn" data-cmd="dialogCancel" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </ModalCard>
  )
}
