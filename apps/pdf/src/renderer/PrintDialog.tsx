/** Print range dialog: all / current / a typed range.

    Same open + value + invalid shape as the page-operation prompts, plus a mode;
    it keeps its own state rather than reusing `useTextEntry` because the typed
    range has to survive a switch to "all pages" and back. The shell and the
    action row come from `ModalCard`.

    What matters is which pages the choice resolves to: the prompt counts visible
    (1-based) pages, and the caller flushes the file to that visible order before
    printing, so visible page v prints as file page v. */

import { useState } from 'react'
import type { ReactElement } from 'react'
import type { TFunc } from './i18n/locale'
import { ModalActions, ModalCard } from './ModalCard'

export type PrintMode = 'all' | 'current' | 'custom'

export interface PrintDialogState {
  isOpen: boolean
  mode: PrintMode
  /** The typed range, kept while the mode is not `custom` so switching back does not lose it */
  input: string
  invalid: boolean
  show: (currentPage: number) => void
  setMode: (mode: PrintMode) => void
  editInput: (value: string) => void
  close: () => void
  fail: () => void
}

export function usePrintDialog(): PrintDialogState {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<PrintMode>('all')
  const [input, setInput] = useState('1')
  const [invalid, setInvalid] = useState(false)
  return {
    isOpen,
    mode,
    input,
    invalid,
    // every open starts at "all pages": printing is the one action that writes
    // paper, so it must not inherit the previous range
    show: (currentPage) => {
      setMode('all')
      setInput(String(currentPage))
      setInvalid(false)
      setIsOpen(true)
    },
    setMode,
    editInput: (value) => {
      setInput(value)
      setInvalid(false)
    },
    close: () => setIsOpen(false),
    fail: () => setInvalid(true),
  }
}

export function PrintDialog({
  t,
  currentPage,
  state,
  onConfirm,
}: {
  t: TFunc
  /** Visible page number the "current page" option refers to */
  currentPage: number
  state: PrintDialogState
  onConfirm: () => void
}): ReactElement {
  const radio = (mode: PrintMode, label: string): ReactElement => (
    <label className="pdf-modal-row">
      <input
        type="radio"
        name="print-range"
        data-cmd={`printRange-${mode}`}
        checked={state.mode === mode}
        onChange={() => state.setMode(mode)}
      />
      <span>{label}</span>
    </label>
  )
  return (
    <ModalCard label={t('print')} onCancel={state.close}>
      <div className="pdf-modal-title">{t('print')}</div>
      {radio('all', t('printRangeAll'))}
      {radio('current', `${t('printRangeCurrent')} (${currentPage})`)}
      {radio('custom', t('printRangeCustom'))}
      {state.mode === 'custom' && (
        <input
          className={`pdf-modal-input${state.invalid ? ' invalid' : ''}`}
          data-cmd="dialogInput"
          value={state.input}
          placeholder={t('printRangeHint')}
          autoFocus
          onChange={(e) => state.editInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm()
          }}
        />
      )}
      <ModalActions t={t} onCancel={state.close} onConfirm={onConfirm} okLabel={t('print')} />
    </ModalCard>
  )
}
