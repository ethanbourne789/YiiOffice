/**
 * Ribbon: tab bar + grouped buttons for the Docs (Word-like) editor.
 *
 * Structure mirrors the slides Ribbon: local state switches tabs, the
 * .ribbon-tabs bar renders tab buttons, and .ribbon-body dispatches to
 * per-tab content. The Home tab content is inlined (clipboard, font,
 * paragraph, styles groups). All other tabs delegate to components exported
 * from ribbon-tabs.tsx.
 */
import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block, HeaderFooter, SectionSettings, SourceInfo, ThemeColors, ThemeFonts } from '@yiioffice/docx-engine'
import type { InkTool } from '../editor/ink'
import type { InkPenSettings } from './ribbon-tabs'
import type { StyleInfo } from '@yiioffice/docx-engine'
import type { RevisionDisplayMode, ViewMode } from './ribbon-tabs'
import type { RibbonFormatState } from './ribbon-format-state'
import { t, useI18n, type StringKey } from '../i18n/locale'
import { Dropdown } from '@yiioffice/ui'
import {
  ReviewTab,
  ViewTab,
  DrawTab,
  BIG,
  SetDropdown,
  toggleDropdown,
  clearParagraphFormatting,
  applyParagraphStyle,
  applyParagraphStyleId,
  activeParaAttrs,
} from './ribbon-tabs'
import { InsertTab } from './ribbon-insert-tab'
import { DesignTab } from './ribbon-design-tab'
import { LayoutTab } from './ribbon-layout-tab'
import { ReferencesTab } from './ribbon-references-tab'
import { HeaderFooterTab, type HfAction, type HfEditingInfo } from './ribbon-hf-tab'
import {
  IconPaste,
  IconCut,
  IconCopy,
  IconFormatPainter,
  IconBullets,
  IconNumbered,
  IconMultilevel,
  IconIndentDec,
  IconIndentInc,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignJustify,
  IconDirLtr,
  IconDirRtl,
  IconLineSpacing,
  IconClearFormat,
  IconGrowFont,
  IconShrinkFont,
  IconFontColorA,
  IconSuperscript,
  IconSubscript,
  IconHighlight,
  IconSearch,
  IconReplace,
  IconCaret,
  IconPilcrow,
  IconStylesPane,
} from './icons'
import { RibbonColorPalette } from './ribbon-color-palette'

/* ================= Tab list ================= */

type DocsTab = 'home' | 'insert' | 'draw' | 'design' | 'layout' | 'references' | 'review' | 'view'
type ContextTab = 'tableDesign' | 'tableLayout' | 'pictureFormat' | 'shapeFormat' | 'headerFooter'

const TABS: readonly DocsTab[] = [
  'home',
  'insert',
  'draw',
  'design',
  'layout',
  'references',
  'review',
  'view',
]

const TAB_LABEL: Record<DocsTab | ContextTab, string> = {
  home: 'ribbonTabHome',
  insert: 'ribbonTabInsert',
  draw: 'ribbonTabDraw',
  design: 'ribbonTabDesign',
  layout: 'ribbonTabLayout',
  references: 'ribbonTabReferences',
  review: 'ribbonTabReview',
  view: 'ribbonTabView',
  tableDesign: 'ribbonTabTableDesign',
  tableLayout: 'ribbonTabTableLayout',
  pictureFormat: 'ribbonTabPictureFormat',
  shapeFormat: 'ribbonTabShapeFormat',
  headerFooter: 'ribbonTabHeaderFooter',
}

/* ================= Props ================= */

export interface RibbonProps {
  /** Mutable holder for ribbon-exposed actions (used by keyboard shortcuts) */
  actionsRef: React.RefObject<unknown>
  /** QAT row content (save/undo/redo/autosave buttons) */
  quickActions: ReactNode
  editor: Editor | null
  formatState: RibbonFormatState
  hasDoc: boolean
  onFind: () => void
  onReplace: () => void
  blocks: Block[]
  styles: Map<string, StyleInfo> | undefined
  docDefaults: import('@yiioffice/docx-engine').DocDefaults | undefined
  documentListPresets: unknown
  recentListPresets: unknown
  section: SectionSettings | null
  tableGridlines: boolean
  activeSection: number | null
  mirrorMargins: boolean
  pageColor: string | null
  watermark: string | null
  themeFonts: ThemeFonts | null
  themeColors: ThemeColors | null
  inkTool: InkTool
  inkPen: InkPenSettings
  inkHighlighter: InkPenSettings
  inkCount: number
  sources: SourceInfo[]
  zoom: number
  darkPage: boolean
  tabRequest: { tab: string; nonce?: number; seq?: number } | null
  header: HeaderFooter | null
  footer: HeaderFooter | null
  hfEditing: HfEditingInfo | null
  showMarks: boolean
  showRuler: boolean
  showNav: boolean
  showStylesPane: boolean
  onShowStylesPane: (v: boolean) => void
  commentCount: number
  openCommentCount: number
  resolvedCommentCount: number
  commentAtCaret: boolean
  canComment: boolean
  trackChanges: boolean
  spellcheck: boolean
  revisionDisplay: RevisionDisplayMode
  revisionCount: number
  isProtected: boolean
  commentsAllowed: boolean
  trackChangesForced: boolean
  protectActive: boolean
  filePath: string | null
  viewMode: ViewMode
  readMode: boolean
  showGrid: boolean
  splitView: boolean

  // ribbonActions spread
  allocateNumId: (kind: 'bullet' | 'ordered') => string | null
  createListDef: (levels: any[]) => string | null | void
  onListDialog: (kind: string) => void
  onParagraphDialog: () => void
  onPasteDefaults: () => void
  onTableDialog: (kind: string) => void
  onToggleTableGridlines: (v: boolean) => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onSection: (next: SectionSettings) => void
  onPaperSizeAll: (portraitW: number, portraitH: number, orientation: SectionSettings['orientation']) => void
  onMirrorMargins: (on: boolean) => void
  onInsertSectionBreak: (type: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage') => void
  onPageColor: (next: string | null) => void
  onWatermark: (next: string | null) => void
  onThemeFonts: (fonts: ThemeFonts) => void
  onThemeColors: (colors: ThemeColors) => void
  onInkTool: (tool: InkTool) => void
  onInkPen: (settings: InkPenSettings) => void
  onInkHighlighter: (settings: InkPenSettings) => void
  onInkClearAll: () => void
  onInsertNote: (kind: 'footnote' | 'endnote') => void
  onAddSource: (source: SourceInfo) => void
  headingPages: () => number[] | null
  onZoom: (zoom: number) => void
  onZoomFit: (mode: 'width' | 'page' | 'multi') => void
  onZoomDialog: () => void
  onDarkPage: (v: boolean) => void
  onHeader: (next: HeaderFooter) => void
  onPageNumFormat: () => void
  onInsertField: (instr: string) => void
  onFooter: (next: HeaderFooter) => void
  onHfAction: (action: HfAction) => void
  onHfEdit: (kind: 'header' | 'footer') => void
  onShowMarks: (v: boolean) => void
  onShowRuler: (v: boolean) => void
  onShowNav: (v: boolean) => void
  onShowComments: () => void
  onNewComment: () => void
  onDeleteComment: () => void
  onDeleteAllComments: (resolvedOnly: boolean) => void
  onGotoComment: (dir: 1 | -1) => void
  onTrackChanges: (on: boolean) => void
  onSpellcheck: (on: boolean) => void
  onRevisionDisplay: (mode: RevisionDisplayMode) => void
  onAcceptRevision: (all: boolean) => void
  onRejectRevision: (all: boolean) => void
  onGotoRevision: (dir: 1 | -1) => void
  onProtectDoc: () => void
  onCompare: () => void
  onViewMode: (mode: ViewMode) => void
  onReadMode: (v: boolean) => void
  onShowGrid: (v: boolean) => void
  onSplitView: (v: boolean) => void
  onPagePreview: () => void
}

/* ================= Font / Size lists ================= */

const FONT_LIST = [
  'Arial',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Impact',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  '黑体',
  '宋体',
  '微软雅黑',
  '楷体',
  '仿宋',
  '等线',
  '苹方-简',
  '华文细黑',
  '思源黑体 CN',
]

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

/* ================= Size step helpers ================= */

function nextFontSize(current: number): number {
  const idx = FONT_SIZES.indexOf(current)
  if (idx === -1) {
    // find next size >= current
    for (let i = 0; i < FONT_SIZES.length; i++) {
      if (FONT_SIZES[i] >= current) return FONT_SIZES[i] ?? current + 2
    }
    return current + 2
  }
  return FONT_SIZES[Math.min(idx + 1, FONT_SIZES.length - 1)] ?? current + 2
}

function prevFontSize(current: number): number {
  const idx = FONT_SIZES.indexOf(current)
  if (idx === -1) {
    let best = FONT_SIZES[0]
    for (const s of FONT_SIZES) {
      if (s <= current) best = s
      else break
    }
    return best
  }
  return FONT_SIZES[Math.max(idx - 1, 0)]
}

/* ================= Main Ribbon ================= */

export function Ribbon({
  actionsRef,
  quickActions,
  editor,
  formatState,
  hasDoc,
  onFind,
  onReplace,
  blocks,
  styles,
  docDefaults,
  documentListPresets,
  recentListPresets,
  section,
  tableGridlines,
  activeSection,
  mirrorMargins,
  pageColor,
  watermark,
  themeFonts,
  themeColors,
  inkTool,
  inkPen,
  inkHighlighter,
  inkCount,
  sources,
  zoom,
  darkPage,
  tabRequest,
  header,
  footer,
  hfEditing,
  showMarks,
  showRuler,
  showNav,
  showStylesPane,
  onShowStylesPane,
  commentCount,
  openCommentCount,
  resolvedCommentCount,
  commentAtCaret,
  canComment,
  trackChanges,
  spellcheck,
  revisionDisplay,
  revisionCount,
  isProtected,
  commentsAllowed,
  trackChangesForced,
  protectActive,
  filePath,
  viewMode,
  readMode,
  showGrid,
  splitView,
  // ribbonActions spread
  allocateNumId,
  createListDef,
  onListDialog,
  onParagraphDialog,
  onPasteDefaults,
  onTableDialog,
  onToggleTableGridlines,
  onOpen,
  onSave,
  onSaveAs,
  onSection,
  onPaperSizeAll,
  onMirrorMargins,
  onInsertSectionBreak,
  onPageColor,
  onWatermark,
  onThemeFonts,
  onThemeColors,
  onInkTool,
  onInkPen,
  onInkHighlighter,
  onInkClearAll,
  onInsertNote,
  onAddSource,
  headingPages,
  onZoom,
  onZoomFit,
  onZoomDialog,
  onDarkPage,
  onHeader,
  onPageNumFormat,
  onInsertField,
  onFooter,
  onHfAction,
  onHfEdit,
  onShowMarks,
  onShowRuler,
  onShowNav,
  onShowComments,
  onNewComment,
  onDeleteComment,
  onDeleteAllComments,
  onGotoComment,
  onTrackChanges,
  onSpellcheck,
  onRevisionDisplay,
  onAcceptRevision,
  onRejectRevision,
  onGotoRevision,
  onProtectDoc,
  onCompare,
  onViewMode,
  onReadMode,
  onShowGrid,
  onSplitView,
  onPagePreview,
}: RibbonProps) {
  const { t } = useI18n()

  const [tab, setTab] = useState<DocsTab | ContextTab>('home')
  const [dropdown, setDropdown] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [lineSpacingOpen, setLineSpacingOpen] = useState(false)

  const setDrop: SetDropdown = setDropdown

  // Expose find/replace actions for keyboard shortcut binding
  useEffect(() => {
    actionsRef.current = { find: onFind, replace: onReplace }
  }, [actionsRef, onFind, onReplace])

  // Respond to external tab requests (e.g. from keyboard shortcuts or commands)
  const handledSeq = useRef(0)
  useEffect(() => {
    if (!tabRequest || (tabRequest.seq ?? 0) === handledSeq.current) return
    handledSeq.current = tabRequest.seq ?? 0
    const target = tabRequest.tab as DocsTab | ContextTab
    if (TABS.includes(target as DocsTab) || isContextTab(target)) {
      setTab(target)
    }
  }, [tabRequest])

  function isContextTab(t: string): t is ContextTab {
    return ['tableDesign', 'tableLayout', 'pictureFormat', 'shapeFormat', 'headerFooter'].includes(t)
  }

  // --- Format button helpers (onMouseDown + preventDefault to keep contentEditable focus) ---
  const fmtBtn = (
    label: ReactNode,
    title: string,
    className?: string,
    onClick?: () => void,
    disabled = false,
  ) => (
    <button
      className={`rb-icon${className ? ` ${className}` : ''}`}
      disabled={disabled || !formatState.editable}
      data-tip={formatState.editable ? title : t('ribbonEditableHint', { title })}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick?.()
      }}
    >
      {label}
    </button>
  )

  // --- Contextual tabs ---
  const contextTab: ContextTab | null = hfEditing
    ? 'headerFooter'
    : formatState.inTable
      ? null // both tableDesign and tableLayout are shown together in practice
      : formatState.imageSelected
        ? 'pictureFormat'
        : formatState.shapeFill || formatState.shapePrst
          ? 'shapeFormat'
          : null

  // When a contextual tab should be visible but the user is on a regular tab, stay put.
  // When leaving a contextual tab that is no longer relevant, fall back to home.
  const prevContextRef = useRef<ContextTab | null>(null)
  useEffect(() => {
    const prev = prevContextRef.current
    if (contextTab && prev !== contextTab) {
      // auto-switch to contextual tab
      setTab(contextTab)
    } else if (!contextTab && prev && prev === tab) {
      setTab('home')
    }
    prevContextRef.current = contextTab
  }, [contextTab, prevContextRef, tab])

  /* ================= Render ================= */

  return (
    <div className="ribbon">
      {/* ── Tab bar ── */}
      <div className="ribbon-tabs">
        {/* QAT buttons */}
        {quickActions}

        {/* Main tabs */}
        {TABS.map((tb) => (
          <button
            key={tb}
            className={`ribbon-tab ${tab === tb ? 'open' : ''}`}
            onClick={() => setTab(tb)}
          >
            {t(TAB_LABEL[tb] as StringKey)}
          </button>
        ))}

        {/* Contextual tabs */}
        {contextTab && (
          <button
            key={contextTab}
            className={`ribbon-tab ribbon-tab-context ${tab === contextTab ? 'open' : ''}`}
            onClick={() => setTab(contextTab)}
          >
            {t(TAB_LABEL[contextTab] as StringKey)}
          </button>
        )}

        {/* Spacer */}
        <span className="ribbon-tabs-spacer" />

        {/* Find/Replace buttons on the right */}
        <button
          className="qa-btn"
          data-tip={t('ribbonFindTip')}
          aria-label={t('ribbonFindTip')}
          onClick={onFind}
        >
          <IconSearch size={16} />
        </button>
        <button
          className="qa-btn"
          data-tip={t('ribbonReplaceTip')}
          aria-label={t('ribbonReplaceTip')}
          onClick={onReplace}
        >
          <IconReplace size={16} />
        </button>
      </div>

      {/* ── Ribbon body ── */}
      <div className="ribbon-body" data-ribbon-body="">
        {/* ================= Home Tab ================= */}
        {tab === 'home' ? (
          <>
            {/* Clipboard group */}
            <div className="ribbon-group">
              <div className="ribbon-group-items">
                <div className="rb-split-wrap">
                  <button
                    className="rb-big"
                    disabled={!hasDoc}
                    data-tip={t('ribbonPasteTip')}
                    onClick={() => toggleDropdown(setDropdown, 'paste')}
                  >
                    <span className="rb-big-icon">
                      <IconPaste size={BIG} />
                      <IconCaret />
                    </span>
                    <span>{t('ribbonPaste')}</span>
                  </button>
                  {dropdown === 'paste' && (
                    <div data-rb-panel="" className="layout-menu">
                      <button
                        onClick={() => {
                          ;(editor?.chain().focus() as any)?.paste()?.run()
                          setDropdown(null)
                        }}
                      >
                        {t('ribbonPasteDefault')}
                      </button>
                      <button
                        onClick={() => {
                          // Keep source formatting paste
                          ;(editor?.chain().focus() as any)?.paste()?.run()
                          setDropdown(null)
                        }}
                      >
                        {t('ribbonPasteSource')}
                      </button>
                      <button
                        onClick={() => {
                          // Merge formatting paste
                          ;(editor?.chain().focus() as any)?.paste()?.run()
                          setDropdown(null)
                        }}
                      >
                        {t('ribbonPasteMerge')}
                      </button>
                      <button
                        onClick={() => {
                          // Text only paste
                          const text = navigator.clipboard?.readText?.()
                          if (text && editor) {
                            editor.chain().focus().insertContent(text).run()
                          }
                          setDropdown(null)
                        }}
                      >
                        {t('ribbonPasteText')}
                      </button>
                    </div>
                  )}
                </div>
                {fmtBtn(<IconCut size={14} />, t('ribbonCutTip'), '', () => { if (!editor) return; (editor.chain().focus() as any).cut(0, 0).run() })}
                {fmtBtn(<IconCopy size={14} />, t('ribbonCopyTip'), '', () => { if (!editor) return; (editor.chain().focus() as any).copy().run() })}
                {fmtBtn(
                  <IconFormatPainter size={14} />,
                  t('ribbonFormatPainterTip'),
                  '',
                  () => {
                    // format painter: capture current selection marks and apply on next click
                    // Simplified: toggle a format painter mode
                  },
                )}
              </div>
              <div className="ribbon-group-label">{t('ribbonGroupClipboard')}</div>
            </div>

            <div className="ribbon-sep" />

            {/* Font group */}
            <div className="ribbon-group">
              <div className="ribbon-group-items rb-font-group">
                {/* Row 1: font family, size, grow/shrink, B/I/U/ab */}
                <div className="rb-row">
                  {/* Font name dropdown */}
                  <div className="rb-split-wrap">
                    <Dropdown
                      className="rb-font-dd"
                      value={formatState.fontFamily || ''}
                      tip={t('ribbonFontNameTip')}
                      options={FONT_LIST.map((f) => ({ value: f, label: f }))}
                      onPick={(v) => {
                        editor?.chain().focus().setMark('docTextStyle', { font: v }).run()
                      }}
                    />
                  </div>

                  {/* Font size */}
                  <div className="rb-split-wrap">
                    <Dropdown
                      className="rb-size-dd"
                      value={formatState.fontSizeMixed ? '' : String(formatState.fontSizePt)}
                      tip={t('ribbonFontSizeTip')}
                      options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                      onPick={(v) => {
                        const pt = Number(v)
                        if (Number.isFinite(pt)) {
                          editor?.chain().focus().setMark('docTextStyle', { sizeHalfPoints: pt * 2 }).run()
                        }
                      }}
                    />
                  </div>

                  {/* Grow / Shrink */}
                  {fmtBtn(
                    <IconGrowFont size={14} />,
                    t('ribbonGrowFontTip'),
                    '',
                    () => editor?.chain().focus().setMark('docTextStyle', {
                      sizeHalfPoints: (formatState.fontSizePt + 1) * 2,
                    }).run(),
                  )}
                  {fmtBtn(
                    <IconShrinkFont size={14} />,
                    t('ribbonShrinkFontTip'),
                    '',
                    () => editor?.chain().focus().setMark('docTextStyle', {
                      sizeHalfPoints: Math.max(2, (formatState.fontSizePt - 1) * 2),
                    }).run(),
                  )}

                  {/* Bold / Italic / Underline / Strike */}
                  {fmtBtn(
                    <strong style={{ fontSize: 14, fontWeight: 700 }}>B</strong>,
                    t('ribbonBoldTip'),
                    formatState.bold ? 'active' : undefined,
                    () => editor?.chain().focus().toggleMark('bold').run(),
                  )}
                  {fmtBtn(
                    <em style={{ fontSize: 14, fontStyle: 'italic', fontWeight: 700 }}>I</em>,
                    t('ribbonItalicTip'),
                    formatState.italic ? 'active' : undefined,
                    () => editor?.chain().focus().toggleMark('italic').run(),
                  )}
                  {fmtBtn(
                    <span style={{ fontSize: 14, fontWeight: 700, textDecoration: 'underline' }}>
                      U
                    </span>,
                    t('ribbonUnderlineTip'),
                    formatState.underline ? 'active' : undefined,
                    () => editor?.chain().focus().toggleMark('underline').run(),
                  )}
                  {fmtBtn(
                    <span style={{ fontSize: 14, fontWeight: 700, textDecoration: 'line-through' }}>
                      ab
                    </span>,
                    t('ribbonStrikeTip'),
                    formatState.strike ? 'active' : undefined,
                    () => editor?.chain().focus().toggleMark('strike').run(),
                  )}
                </div>

                {/* Row 2: subscript/superscript, text color, highlight, clear */}
                <div className="rb-row">
                  {/* Subscript / Superscript */}
                  {fmtBtn(
                    <IconSubscript size={14} />,
                    t('ribbonSubscriptTip'),
                    formatState.vertAlign === 'sub' ? 'active' : undefined,
                    () => {
                      const ed = editor!
                      const isSub = ed.isActive('docTextStyle', { vertAlign: 'sub' })
                      ed.chain().focus().setMark('docTextStyle', { vertAlign: isSub ? null : 'sub' }).run()
                    },
                  )}
                  {fmtBtn(
                    <IconSuperscript size={14} />,
                    t('ribbonSuperscriptTip'),
                    formatState.vertAlign === 'super' ? 'active' : undefined,
                    () => {
                      const ed = editor!
                      const isSuper = ed.isActive('docTextStyle', { vertAlign: 'super' })
                      ed.chain().focus().setMark('docTextStyle', { vertAlign: isSuper ? null : 'super' }).run()
                    },
                  )}

                  {/* Text Color */}
                  <div className="rb-split-wrap">
                    <button
                      className={`rb-icon icon-over-label ${formatState.textColor ? 'active' : ''}`}
                      disabled={!formatState.editable}
                      data-tip={t('ribbonFontColorTip')}
                      onClick={() => toggleDropdown(setDropdown, 'fontColor')}
                      style={{ position: 'relative' }}
                    >
                      <IconFontColorA size={14} />
                      {formatState.textColor && (
                        <span
                          className="rb-color-bar"
                          style={{ background: `#${formatState.textColor}`, position: 'absolute', bottom: 2, left: 2, right: 2, height: 3 }}
                        />
                      )}
                      <IconCaret />
                    </button>
                    {dropdown === 'fontColor' && (
                      <RibbonColorPalette
                        current={formatState.textColor}
                        noneLabel={t('ribbonAutoColor')}
                        onPick={(hex) => {
                          editor?.chain().focus().setMark('docTextStyle', {
                            color: hex || 'auto',
                          }).run()
                          setDropdown(null)
                        }}
                      />
                    )}
                  </div>

                  {/* Highlight Color */}
                  <div className="rb-split-wrap">
                    <button
                      className={`rb-icon ${formatState.highlight ? 'active' : ''}`}
                      disabled={!formatState.editable}
                      data-tip={t('ribbonHighlightTip')}
                      onClick={() => toggleDropdown(setDropdown, 'highlight')}
                    >
                      <IconHighlight size={14} />
                      <IconCaret />
                    </button>
                    {dropdown === 'highlight' && (
                      <RibbonColorPalette
                        current={formatState.highlight}
                        noneLabel={t('ribbonNoHighlight')}
                        onPick={(hex) => {
                          editor?.chain().focus().setMark('docTextStyle', {
                            highlight: hex || null,
                          }).run()
                          setDropdown(null)
                        }}
                      />
                    )}
                  </div>

                  {/* Clear Formatting */}
                  {fmtBtn(
                    <IconClearFormat size={14} />,
                    t('ribbonClearFormatTip'),
                    '',
                    () => {
                      if (!editor) return
                      // Clear direct character formatting
                      editor.chain().focus().unsetMark('bold').unsetMark('italic').unsetMark('underline').unsetMark('strike').unsetMark('docTextStyle').run()
                      clearParagraphFormatting(editor)
                    },
                  )}
                </div>
              </div>
              <div className="ribbon-group-label">{t('ribbonGroupFont')}</div>
            </div>

            <div className="ribbon-sep" />

            {/* Paragraph group */}
            <div className="ribbon-group">
              <div className="ribbon-group-items rb-font-group">
                {/* Row 1: bullets, numbering, multilevel, indent */}
                <div className="rb-row">
                  {/* Bullets / Numbering / Multilevel */}
                  {fmtBtn(
                    <IconBullets size={14} />,
                    t('ribbonBulletsTip'),
                    formatState.listBullet ? 'active' : undefined,
                    () => {
                      if (!editor) return
                      if (formatState.listBullet) {
                        (editor.chain().focus() as any).unsetList().run()
                      } else {
                        const numId = ((allocateNumId) as (k: 'bullet' | 'ordered') => string | null)('bullet')
                        if (numId) (editor.chain().focus() as any).toggleListItem({ kind: 'bullet', numId, level: 0 }).run()
                      }
                    },
                  )}
                  {fmtBtn(
                    <IconNumbered size={14} />,
                    t('ribbonNumberingTip'),
                    formatState.listOrdered ? 'active' : undefined,
                    () => {
                      if (!editor) return
                      if (formatState.listOrdered) {
                        (editor.chain().focus() as any).unsetList().run()
                      } else {
                        const numId = ((allocateNumId) as (k: 'bullet' | 'ordered') => string | null)('ordered')
                        if (numId) (editor.chain().focus() as any).toggleListItem({ kind: 'ordered', numId, level: 0 }).run()
                      }
                    },
                  )}
                  <div className="rb-split-wrap">
                    <button
                      className={`rb-icon ${formatState.listBullet || formatState.listOrdered ? 'active' : ''}`}
                      disabled={!formatState.editable}
                      data-tip={t('ribbonListOptionsTip')}
                      onClick={() => toggleDropdown(setDropdown, 'list')}
                    >
                      <IconMultilevel size={14} />
                      <IconCaret />
                    </button>
                    {dropdown === 'list' && (
                      <div data-rb-panel="" className="layout-menu">
                        <button onClick={() => { onListDialog('new'); setDropdown(null) }}>
                          {t('ribbonNewList')}
                        </button>
                        <button onClick={() => { onListDialog('define'); setDropdown(null) }}>
                          {t('ribbonDefineList')}
                        </button>
                        <button onClick={() => { onListDialog('update'); setDropdown(null) }}>
                          {t('ribbonUpdateList')}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Indent */}
                  {fmtBtn(
                    <IconIndentDec size={14} />,
                    t('ribbonOutdentTip'),
                    '',
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ indentLeft: Math.max(0, (activeParaAttrs(editor).indentLeft as number) - 360) }).run() },
                  )}
                  {fmtBtn(
                    <IconIndentInc size={14} />,
                    t('ribbonIndentTip'),
                    '',
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ indentLeft: (activeParaAttrs(editor).indentLeft as number) + 360 }).run() },
                  )}
                </div>

                {/* Row 2: align, direction, line spacing, paragraph dialog */}
                <div className="rb-row">
                  {/* Align */}
                  {fmtBtn(
                    <IconAlignLeft size={14} />,
                    t('ribbonAlignLeftTip'),
                    formatState.align === 'left' || (!formatState.align && !formatState.bidi) ? 'active' : undefined,
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ align: formatState.align === 'left' ? null : 'left' }).run() },
                  )}
                  {fmtBtn(
                    <IconAlignCenter size={14} />,
                    t('ribbonAlignCenterTip'),
                    formatState.align === 'center' ? 'active' : undefined,
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ align: formatState.align === 'center' ? null : 'center' }).run() },
                  )}
                  {fmtBtn(
                    <IconAlignRight size={14} />,
                    t('ribbonAlignRightTip'),
                    formatState.align === 'right' ? 'active' : undefined,
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ align: formatState.align === 'right' ? null : 'right' }).run() },
                  )}
                  {fmtBtn(
                    <IconAlignJustify size={14} />,
                    t('ribbonAlignJustifyTip'),
                    formatState.align === 'both' ? 'active' : undefined,
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ align: formatState.align === 'both' ? null : 'both' }).run() },
                  )}

                  {/* Direction (LTR/RTL) */}
                  {fmtBtn(
                    formatState.bidi ? <IconDirRtl size={14} /> : <IconDirLtr size={14} />,
                    formatState.bidi ? t('ribbonRtlTip') : t('ribbonLtrTip'),
                    formatState.bidi ? 'active' : undefined,
                    () => { if (!editor) return; (editor.chain().focus() as any).setParagraphAttrs({ bidi: !formatState.bidi }).run() },
                  )}

                  {/* Line Spacing */}
                  <div className="rb-split-wrap">
                    <button
                      className={`rb-icon ${formatState.lineSpacing ? 'active' : ''}`}
                      disabled={!formatState.editable}
                      data-tip={t('ribbonLineSpacingTip')}
                      onClick={() => toggleDropdown(setDropdown, 'lineSpacing')}
                    >
                      <IconLineSpacing size={14} />
                      <IconCaret />
                    </button>
                    {dropdown === 'lineSpacing' && (
                      <div data-rb-panel="" className="layout-menu">
                        {[
                          [1, t('ribbonSpacingSingle')],
                          [1.5, t('ribbonSpacing15')],
                          [2, t('ribbonSpacingDouble')],
                          [2.5, t('ribbonSpacing25')],
                          [3, t('ribbonSpacing3')],
                        ].map(([val, label]) => (
                          <button
                            key={val}
                            className={formatState.lineSpacing === val ? 'active' : ''}
                            onClick={() => {
                              if (!editor) return
                              const v = val as number
                              ;(editor.chain().focus() as any).setParagraphAttrs({ lineSpacing: v, lineRule: 'exact', lineRawTwips: v * 240 }).run()
                              setDropdown(null)
                            }}
                          >
                            {label}
                          </button>
                        ))}
                        <button
                          className={!formatState.lineSpacing ? 'active' : ''}
                          onClick={() => {
                            if (!editor) return
                            ;(editor.chain().focus() as any).setParagraphAttrs({ lineSpacing: null, lineRule: null, lineRawTwips: null }).run()
                            setDropdown(null)
                          }}
                        >
                          {t('ribbonSpacingDefault')}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Paragraph dialog button */}
                  {fmtBtn(
                    <IconPilcrow size={14} />,
                    t('ribbonParagraphDialogTip'),
                    '',
                    onParagraphDialog,
                  )}
                </div>
              </div>
              <div className="ribbon-group-label">{t('ribbonGroupParagraph')}</div>
            </div>

            <div className="ribbon-sep" />

            {/* Styles group */}
            <div className="ribbon-group">
              <div className="ribbon-group-items">
                <div className="rb-split-wrap">
                  <button
                    className="rb-big"
                    disabled={!hasDoc}
                    data-tip={t('ribbonStylesTip')}
                    onClick={() => toggleDropdown(setDropdown, 'styles')}
                  >
                    <span className="rb-big-icon">
                      <IconFontColorA size={BIG} />
                      <IconCaret />
                    </span>
                    <span>{t('ribbonStyles')}</span>
                  </button>
                  {dropdown === 'styles' && (
                    <div data-rb-panel="" className="layout-menu">
                      {/* Default paragraph style */}
                      <button
                        className={!formatState.headingLevel ? 'active' : ''}
                        onClick={() => editor && applyParagraphStyle(editor, 'p', styles)}
                      >
                        {t('ribbonStyleNormal')}
                      </button>
                      {/* Heading styles */}
                      {[1, 2, 3].map((level) => (
                        <button
                          key={level}
                          className={formatState.headingLevel === level ? 'active' : ''}
                          style={{ fontWeight: 700, fontSize: level === 1 ? 15 : level === 2 ? 13 : 12 }}
                          onClick={() => editor && applyParagraphStyle(editor, ['h1', 'h2', 'h3'][level - 1] as 'h1' | 'h2' | 'h3', styles)}
                        >
                          {t('ribbonHeading', { n: level })}
                        </button>
                      ))}
                      {/* Custom styles from the document */}
                      {styles && Array.from(styles.entries())
                        .filter(([, info]) => info.type === 'paragraph' && info.styleId && !info.styleId.startsWith('Heading') && info.styleId !== 'Normal')
                        .slice(0, 8)
                        .map(([id, info]) => (
                          <button
                            key={id}
                            className={formatState.paraStyleId === id ? 'active' : ''}
                            onClick={() => editor && applyParagraphStyleId(editor, id, info.headingLevel ?? null)}
                          >
                            {info.name || id}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Styles Pane toggle */}
                <button
                  className={`rb-big ${showStylesPane ? 'active' : ''}`}
                  data-tip={t('ribbonStylesPaneTip')}
                  onClick={() => onShowStylesPane(!showStylesPane)}
                >
                  <span className="rb-big-icon">
                    <IconStylesPane size={BIG} />
                  </span>
                  <span>{t('ribbonStylesPane')}</span>
                </button>
              </div>
              <div className="ribbon-group-label">{t('ribbonGroupStyles')}</div>
            </div>
          </>
        ) : tab === 'insert' ? (
          <InsertTab
            editor={editor!}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDrop}
            header={header}
            onHeader={onHeader}
            footer={footer}
            onFooter={onFooter}
            onPageNumFormat={onPageNumFormat}
            onInsertField={onInsertField}
            onHfEdit={onHfEdit}
            canComment={canComment}
            onNewComment={onNewComment}
            isProtected={isProtected}
            commentsAllowed={commentsAllowed}
            onTableInserted={() => {}}
          />
        ) : tab === 'draw' ? (
          <DrawTab
            hasDoc={hasDoc}
            tool={inkTool}
            onTool={onInkTool}
            pen={inkPen}
            onPen={onInkPen}
            highlighter={inkHighlighter}
            onHighlighter={onInkHighlighter}
            annotationCount={inkCount}
            onClearAll={onInkClearAll}
          />
        ) : tab === 'design' ? (
          <DesignTab
            editor={editor!}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDrop}
            pageColor={pageColor}
            onPageColor={onPageColor}
            section={section}
            onSection={onSection}
            watermark={watermark}
            onWatermark={onWatermark}
            themeFonts={themeFonts}
            onThemeFonts={onThemeFonts}
            onThemeColors={onThemeColors}
          />
        ) : tab === 'layout' ? (
          <LayoutTab
            editor={editor!}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDrop}
            section={section}
            onSection={onSection}
            activeSection={activeSection}
            onInsertSectionBreak={onInsertSectionBreak}
            onPaperSizeAll={onPaperSizeAll}
            mirrorMargins={mirrorMargins}
            onMirrorMargins={onMirrorMargins}
          />
        ) : tab === 'references' ? (
          <ReferencesTab
            editor={editor!}
            hasDoc={hasDoc}
            blocks={blocks}
            dropdown={dropdown}
            setDropdown={setDrop}
            onInsertNote={onInsertNote}
            sources={sources}
            onAddSource={onAddSource}
            headingPages={headingPages}
          />
        ) : tab === 'review' ? (
          <ReviewTab
            editor={editor!}
            hasDoc={hasDoc}
            dropdown={dropdown}
            setDropdown={setDrop}
            commentCount={commentCount}
            openCommentCount={openCommentCount}
            resolvedCommentCount={resolvedCommentCount}
            onShowComments={onShowComments}
            canComment={canComment}
            onNewComment={onNewComment}
            commentAtCaret={commentAtCaret}
            onDeleteComment={onDeleteComment}
            onDeleteAllComments={onDeleteAllComments}
            onGotoComment={onGotoComment}
            trackChanges={trackChanges}
            onTrackChanges={onTrackChanges}
            spellcheck={spellcheck}
            onSpellcheck={onSpellcheck}
            revisionDisplay={revisionDisplay}
            onRevisionDisplay={onRevisionDisplay}
            revisionCount={revisionCount}
            onAcceptRevision={onAcceptRevision}
            onRejectRevision={onRejectRevision}
            onGotoRevision={onGotoRevision}
            isProtected={isProtected}
            commentsAllowed={commentsAllowed}
            trackChangesForced={trackChangesForced}
            protectActive={protectActive}
            onProtectDoc={onProtectDoc}
            onCompare={onCompare}
          />
        ) : tab === 'view' ? (
          <ViewTab
            hasDoc={hasDoc}
            filePath={filePath}
            zoom={zoom}
            onZoom={onZoom}
            onZoomFit={onZoomFit}
            onZoomDialog={onZoomDialog}
            darkPage={darkPage}
            onDarkPage={onDarkPage}
            showRuler={showRuler}
            onShowRuler={onShowRuler}
            showNav={showNav}
            onShowNav={onShowNav}
            viewMode={viewMode}
            onViewMode={onViewMode}
            readMode={readMode}
            onReadMode={onReadMode}
            showGrid={showGrid}
            onShowGrid={onShowGrid}
            splitView={splitView}
            onSplitView={onSplitView}
            onPagePreview={onPagePreview}
          />
        ) : tab === 'headerFooter' && hfEditing ? (
          <HeaderFooterTab
            info={hfEditing}
            dropdown={dropdown}
            setDropdown={setDrop}
            onAction={onHfAction}
          />
        ) : null}
      </div>
    </div>
  )
}