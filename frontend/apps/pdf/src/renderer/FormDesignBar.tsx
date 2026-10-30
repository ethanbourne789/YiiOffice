/** Form authoring: the ribbon group that arms the tools, the field context menu,
 *  and the state both drive.
 *
 *  Nine pieces of state used to live in the editor for this: which tool is
 *  armed, "keep the tool", preview, "detecting", the selection, the menu
 *  position with its ref, and the arrange popover. The selection alone was read
 *  in six places (nudge, delete, shortcuts, layer, ribbon, menu), and the menu
 *  corrected its own position by writing it back through App state -- a
 *  cosmetic clamp that re-rendered a 9k-line component.
 *
 *  What stays in the editor is what this module cannot decide: `applyEditOps`,
 *  the signed-widget check, the field catalog. The ribbon reports intent
 *  (`onArrange('left')`), not the ops.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useDismissablePopover } from '@yiioffice/ui'
import {
  IconFieldArrange,
  IconFieldCheckbox,
  IconFieldChoice,
  IconFieldDate,
  IconFieldDetect,
  IconFieldKeep,
  IconFieldPreview,
  IconFieldRadio,
  IconFieldSignature,
  IconFieldText,
  IconTrash,
  RbCaret,
} from './icons'
import type { DesignField, FormDesignTool } from './FormDesignLayer'
import type { StringKey, TFunc } from './i18n/locale'

export type Arrange =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'centerH'
  | 'centerV'
  | 'distributeH'
  | 'distributeV'
  | 'sameWidth'
  | 'sameHeight'
  | 'sameSize'

/** Action, label, and how many fields it needs before it means anything */
export const arrangeItems = (t: TFunc): readonly (readonly [Arrange, string, number])[] => [
  ['left', t('formDesignAlignLeft'), 2],
  ['centerH', t('formDesignAlignCenterH'), 2],
  ['right', t('formDesignAlignRight'), 2],
  ['top', t('formDesignAlignTop'), 2],
  ['centerV', t('formDesignAlignCenterV'), 2],
  ['bottom', t('formDesignAlignBottom'), 2],
  ['distributeH', t('formDesignDistributeH'), 3],
  ['distributeV', t('formDesignDistributeV'), 3],
  ['sameWidth', t('formDesignSameWidth'), 2],
  ['sameHeight', t('formDesignSameHeight'), 2],
  ['sameSize', t('formDesignSameSize'), 2],
]

const TOOLS: readonly (readonly [FormDesignTool, () => ReactElement, StringKey, StringKey])[] = [
  ['text', IconFieldText, 'formDesignText', 'formDesignTextHint'],
  ['date', IconFieldDate, 'formDesignDate', 'formDesignDateHint'],
  ['checkbox', IconFieldCheckbox, 'formDesignCheckbox', 'formDesignCheckboxHint'],
  ['radio', IconFieldRadio, 'formDesignRadio', 'formDesignRadioHint'],
  ['choice', IconFieldChoice, 'formDesignChoice', 'formDesignChoiceHint'],
  ['signature', IconFieldSignature, 'formDesignSignature', 'formDesignSignatureHint'],
]

export interface FormDesign {
  tool: FormDesignTool | null
  keepTool: boolean
  preview: boolean
  detecting: boolean
  selectedIds: readonly string[]
  selectedIdSet: ReadonlySet<string>
  /** Selected fields, in the order they were selected */
  selected: readonly DesignField[]
  /** The single selected field, or null when the selection is empty or plural */
  selectedOne: DesignField | null
  arranging: boolean
  /** Arm `kind`, or disarm it when it is already armed. True when it is now armed. */
  toggleTool: (kind: FormDesignTool) => boolean
  /** Drop the armed tool without touching anything else */
  disarm: () => void
  toggleKeepTool: () => void
  togglePreview: () => void
  setDetecting: (on: boolean) => void
  /** `toggle` adds the ids that are missing and removes the ones that were there */
  select: (ids: readonly string[], mode: 'replace' | 'toggle') => void
  selectOne: (id: string | null) => void
  clearSelection: () => void
  deselect: (id: string) => void
  /** Drop the ids that no longer exist (undo restored an earlier field set) */
  retain: (keep: (id: string) => boolean) => void
  selectPage: (pageIndex: number | undefined) => void
  toggleArrange: () => void
  closeArrange: () => void
  /** Leaving the tab: no tool, no preview, nothing selected */
  reset: () => void
}

/** Authoring mode + selection for the form-design tab.
 *
 *  `fieldsByPage` is the page's own list of selectable fields, so the selection
 *  resolves to real fields and an id that is no longer on the page simply drops
 *  out -- deleting the last selected field leaves an empty selection without a
 *  second bookkeeping path. */
export function useFormDesign(fieldsByPage: Map<number, DesignField[]>): FormDesign {
  const [tool, setTool] = useState<FormDesignTool | null>(null)
  const [keepTool, setKeepTool] = useState(false)
  const [preview, setPreview] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [arranging, setArranging] = useState(false)

  const all = useMemo(() => [...fieldsByPage.values()].flat(), [fieldsByPage])
  const selected = useMemo(
    () => selectedIds.flatMap((id) => all.filter((f) => f.id === id)),
    [all, selectedIds],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Stable so the caller's "left the tab" effect can depend on it without
  // re-firing on every render (which would reset the selection in a loop)
  const reset = useCallback(() => {
    setTool(null)
    setPreview(false)
    setSelectedIds([])
  }, [])

  return {
    tool,
    keepTool,
    preview,
    detecting,
    selectedIds,
    selectedIdSet,
    selected,
    selectedOne: selected.length === 1 ? selected[0]! : null,
    arranging,
    toggleTool: (kind) => {
      if (tool === kind) {
        setTool(null)
        return false
      }
      setTool(kind)
      // One authoring mode at a time: arming a tool leaves preview
      setPreview(false)
      setSelectedIds([])
      return true
    },
    disarm: () => setTool(null),
    toggleKeepTool: () => setKeepTool((v) => !v),
    togglePreview: () => {
      setPreview((v) => !v)
      setTool(null)
      setSelectedIds([])
    },
    setDetecting,
    select: (ids, mode) => {
      if (mode === 'replace') {
        setSelectedIds([...ids])
        return
      }
      setSelectedIds((cur) => {
        const next = cur.filter((x) => !ids.includes(x))
        for (const id of ids) if (!cur.includes(id)) next.push(id)
        return next
      })
    },
    selectOne: (id) => setSelectedIds(id ? [id] : []),
    clearSelection: () => setSelectedIds([]),
    deselect: (id) => setSelectedIds((cur) => cur.filter((x) => x !== id)),
    retain: (keep) => setSelectedIds((cur) => cur.filter(keep)),
    selectPage: (pageIndex) =>
      setSelectedIds(pageIndex === undefined ? [] : (fieldsByPage.get(pageIndex) ?? []).map((f) => f.id)),
    toggleArrange: () => setArranging((v) => !v),
    closeArrange: () => setArranging(false),
    reset,
  }
}

export interface FormDesignRibbonProps {
  t: TFunc
  readOnly: boolean
  /** A document is open, so there is something to scan */
  canDetect: boolean
  /** Authored fields + edited widgets, for the status line */
  pendingCount: number
  design: FormDesign
  onTool: (kind: FormDesignTool) => void
  onPreview: () => void
  onDetect: () => void
  onArrange: (how: Arrange) => void
  onDelete: () => void
}

/** Everything the form-design tab puts on the ribbon */
export function FormDesignRibbon({
  t,
  readOnly,
  canDetect,
  pendingCount,
  design,
  onTool,
  onPreview,
  onDetect,
  onArrange,
  onDelete,
}: FormDesignRibbonProps): ReactElement {
  const arrangeRef = useRef<HTMLDivElement | null>(null)
  useDismissablePopover(design.arranging, design.closeArrange, {
    inside: () => [arrangeRef.current],
  })
  const items = arrangeItems(t)

  return (
    <>
      <div className="ribbon-group">
        <div className="ribbon-group-items">
          {TOOLS.map(([kind, FieldIcon, labelKey, hintKey]) => (
            <button
              key={kind}
              className={`rb-big${design.tool === kind ? ' active' : ''}`}
              data-cmd={labelKey}
              disabled={readOnly}
              data-tip={t(hintKey)}
              aria-pressed={design.tool === kind}
              onClick={() => onTool(kind)}
            >
              <span className="rb-big-icon">
                <FieldIcon />
              </span>
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="ribbon-sep" />
      <div className="ribbon-group">
        <div className="ribbon-group-items">
          <button
            className={`rb-big${design.keepTool ? ' active' : ''}`}
            data-cmd="formDesignKeepTool"
            disabled={readOnly}
            data-tip={t('formDesignKeepToolHint')}
            aria-pressed={design.keepTool}
            onClick={design.toggleKeepTool}
          >
            <span className="rb-big-icon">
              <IconFieldKeep />
            </span>
            {t('formDesignKeepTool')}
          </button>
          <button
            className={`rb-big${design.preview ? ' active' : ''}`}
            data-cmd="formDesignPreview"
            disabled={readOnly}
            data-tip={t('formDesignPreviewHint')}
            aria-pressed={design.preview}
            onClick={onPreview}
          >
            <span className="rb-big-icon">
              <IconFieldPreview />
            </span>
            {t('formDesignPreview')}
          </button>
          <button
            className="rb-big"
            data-cmd="formDesignDetect"
            disabled={readOnly || design.detecting || !canDetect}
            data-tip={t('formDesignDetectHint')}
            onClick={onDetect}
          >
            <span className="rb-big-icon">
              <IconFieldDetect />
            </span>
            {design.detecting ? t('formDesignDetecting') : t('formDesignDetect')}
          </button>
          <div className="rb-drop-wrap" ref={arrangeRef}>
            <button
              className={`rb-big${design.arranging ? ' active' : ''}`}
              data-cmd="formDesignArrange"
              disabled={design.selectedIds.length < 2}
              data-tip={t('formDesignArrangeHint')}
              onClick={design.toggleArrange}
            >
              <span className="rb-big-icon">
                <IconFieldArrange />
                <RbCaret />
              </span>
              {t('formDesignArrange')}
            </button>
            {design.arranging && (
              <div className="rb-drop rb-menu">
                {items.map(([how, label, min]) => (
                  <button
                    key={how}
                    data-cmd={`formDesignArrange-${how}`}
                    disabled={design.selectedIds.length < min}
                    onClick={() => {
                      design.closeArrange()
                      onArrange(how)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="rb-big"
            data-cmd="formDesignDelete"
            disabled={design.selectedIds.length === 0}
            data-tip={t('formDesignDelete')}
            onClick={onDelete}
          >
            <span className="rb-big-icon">
              <IconTrash />
            </span>
            {t('formDesignDelete')}
          </button>
          <span className="form-ribbon-progress">
            {design.preview
              ? t('formDesignPreviewOn')
              : design.tool
                ? t('formDesignPlaceHint')
                : pendingCount > 0
                  ? t('formDesignPending', { count: pendingCount })
                  : t('formDesignEmptyHint')}
          </span>
        </div>
      </div>
    </>
  )
}

export interface FormFieldMenuRequest {
  /** Where the right-click landed, in viewport coordinates */
  x: number
  y: number
  /** Null when the click missed a field: only "paste here" applies */
  fieldId: string | null
  pageIndex: number
}

export interface FormFieldMenuProps {
  t: TFunc
  menu: FormFieldMenuRequest
  selectedCount: number
  clipboardEmpty: boolean
  onClose: () => void
  onProperties: (fieldId: string) => void
  onCopy: () => void
  onDuplicate: () => void
  onPaste: (pageIndex: number) => void
  onArrange: (how: Arrange) => void
  onDelete: () => void
}

/** Right-click menu on a designed field (or on empty page space, for paste) */
export function FormFieldMenu({
  t,
  menu,
  selectedCount,
  clipboardEmpty,
  onClose,
  onProperties,
  onCopy,
  onDuplicate,
  onPaste,
  onArrange,
  onDelete,
}: FormFieldMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  // The menu is tall and can be opened near an edge; shifting it here rather
  // than through the caller keeps a cosmetic correction from re-rendering the editor
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(0, Math.min(menu.x, window.innerWidth - r.width - 4)),
      top: Math.max(0, Math.min(menu.y, window.innerHeight - r.height - 4)),
    })
  }, [menu.x, menu.y])
  useDismissablePopover(true, onClose, { inside: () => [ref.current] })

  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const items = arrangeItems(t)

  return (
    <div
      ref={ref}
      className="thumb-menu file-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
    >
      {menu.fieldId && (
        <>
          <button
            disabled={selectedCount !== 1}
            onClick={run(() => onProperties(menu.fieldId!))}
          >
            {t('formDesignProperties')}
          </button>
          <button onClick={run(onCopy)}>{t('formDesignCopy')}</button>
          <button onClick={run(onDuplicate)}>{t('formDesignDuplicate')}</button>
        </>
      )}
      <button disabled={clipboardEmpty} onClick={run(() => onPaste(menu.pageIndex))}>
        {t('formDesignPaste')}
      </button>
      {menu.fieldId && (
        <>
          <div className="thumb-menu-sep" />
          {items.map(([how, label, min]) => (
            <button key={how} disabled={selectedCount < min} onClick={run(() => onArrange(how))}>
              {label}
            </button>
          ))}
          <div className="thumb-menu-sep" />
          <button onClick={run(onDelete)}>{t('formDesignDelete')}</button>
        </>
      )}
    </div>
  )
}
