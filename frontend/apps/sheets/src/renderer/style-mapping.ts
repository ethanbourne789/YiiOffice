/**
 * File-model style → Univer IStyleData mapping (extracted verbatim from
 * univer-sync.ts).
 *
 * Pure translation between the xlsx-gateway cell style (resolved xf) and
 * Univer's style record, including the deliberate Excel-compat quirks
 * (NO_FILL sentinel, centerContinuous overflow routing, justify→middle).
 * No runtime, no commands, no Univer internals — the first slice of the
 * sync layer carved out so Univer upgrades only ever touch this leaf.
 */
import {
  BaselineOffset,
  BooleanNumber,
  BorderStyleTypes,
  HorizontalAlign,
  VerticalAlign,
  WrapStrategy,
  type IStyleData,
} from '@univerjs/core'
import type { WorkbookCellStyle } from '../shared/desktop-api'
import { escapeCssLeadingDigit, NO_FILL_STYLE, ooxmlTextRotationToUniver } from './edit-journal'
import { INDENT_STEP_PX } from './selection-format'
import { CELL_HIDDEN_KEY, CELL_LOCKED_KEY } from './sheet-protection'

// Univer's "nothing frozen on this axis" is -1, as the in-app freeze commands
// send; a 0 start renders the same but makes its popup-clipping math NaN.
export function toUniverFreeze(freeze: { frozenRows: number; frozenColumns: number } | null): {
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number }
} {
  if (freeze === null) return {}
  return {
    freeze: {
      xSplit: freeze.frozenColumns,
      ySplit: freeze.frozenRows,
      startRow: freeze.frozenRows === 0 ? -1 : freeze.frozenRows,
      startColumn: freeze.frozenColumns === 0 ? -1 : freeze.frozenColumns,
    },
  }
}

/// The cell xf's font as a text style — the base a rich-text document
/// inherits. Univer applies a cell's `s` font only to plain `v` cells; a `p`
/// document renders purely from its textRuns, so runs without explicit
/// formatting must carry the cell font themselves (Excel semantics: a run
/// without rPr uses the cell font).
export function cellFontTextStyle(style: WorkbookCellStyle | undefined): IStyleData {
  if (!style) return {}
  return {
    ...(style.fontFamily ? { ff: escapeCssLeadingDigit(style.fontFamily) } : {}),
    ...(style.fontSize ? { fs: style.fontSize } : {}),
    ...(style.bold ? { bl: BooleanNumber.TRUE } : {}),
    ...(style.italic ? { it: BooleanNumber.TRUE } : {}),
    ...(style.underline ? { ul: { s: BooleanNumber.TRUE } } : {}),
    ...(style.strikethrough ? { st: { s: BooleanNumber.TRUE } } : {}),
    ...(style.vertAlign ? { va: baselineOffsetOf(style.vertAlign) } : {}),
    ...(style.fontColor ? { cl: { rgb: style.fontColor } } : {}),
  }
}

export function baselineOffsetOf(vertAlign: 'superscript' | 'subscript'): BaselineOffset {
  return vertAlign === 'subscript' ? BaselineOffset.SUBSCRIPT : BaselineOffset.SUPERSCRIPT
}

/// The font subset of an already-composed Univer style — the rich-document
/// base for journal-replayed cells, whose family is already CSS-escaped.
export function fontTextStyleOf(s: IStyleData | null | undefined): IStyleData {
  if (!s) return {}
  return {
    ...(s.ff ? { ff: s.ff } : {}),
    ...(s.fs ? { fs: s.fs } : {}),
    ...(s.bl ? { bl: s.bl } : {}),
    ...(s.it ? { it: s.it } : {}),
    ...(s.ul?.s ? { ul: { s: BooleanNumber.TRUE } } : {}),
    ...(s.st?.s ? { st: { s: BooleanNumber.TRUE } } : {}),
    ...(s.va ? { va: s.va } : {}),
    ...(s.cl?.rgb ? { cl: { rgb: s.cl.rgb } } : {}),
  }
}

/// xf protection flags ride along in ICellData.custom (Univer has no model).
export function protectionCustom(style: WorkbookCellStyle | undefined): {
  custom?: Record<string, boolean>
} {
  if (!style || (style.locked === undefined && style.hidden !== true)) return {}
  return {
    custom: {
      ...(style.locked === undefined ? {} : { [CELL_LOCKED_KEY]: style.locked }),
      ...(style.hidden === true ? { [CELL_HIDDEN_KEY]: true } : {}),
    },
  }
}

export function toUniverStyle(style: WorkbookCellStyle): IStyleData {
  const diagonal = style.borderDiagonal ? toUniverBorder(style.borderDiagonal) : undefined
  const borders = {
    ...(style.borderTop ? { t: toUniverBorder(style.borderTop) } : {}),
    ...(style.borderBottom ? { b: toUniverBorder(style.borderBottom) } : {}),
    ...(style.borderLeft ? { l: toUniverBorder(style.borderLeft) } : {}),
    ...(style.borderRight ? { r: toUniverBorder(style.borderRight) } : {}),
    ...(diagonal && style.diagonalDown ? { tl_br: diagonal } : {}),
    ...(diagonal && style.diagonalUp ? { bl_tr: diagonal } : {}),
  }
  return {
    ...(style.fontFamily ? { ff: escapeCssLeadingDigit(style.fontFamily) } : {}),
    ...(style.fontSize ? { fs: style.fontSize } : {}),
    bl: style.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    it: style.italic ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    ...(style.underline ? { ul: { s: BooleanNumber.TRUE } } : {}),
    ...(style.strikethrough ? { st: { s: BooleanNumber.TRUE } } : {}),
    ...(style.vertAlign ? { va: baselineOffsetOf(style.vertAlign) } : {}),
    // xf alignment is fully resolved in the file: an explicit non-wrap cell
    // must override a WRAP column/row style at compose time.
    // centerContinuous rides on the overflow machinery (center-continuous.ts),
    // so it must not wrap: Excel renders a wrapText+centerContinuous title on
    // one line across the run, not folded inside the anchor cell (prod ref).
    tb:
      style.wrapText && style.horizontalAlignment !== 'centerContinuous'
        ? WrapStrategy.WRAP
        : WrapStrategy.OVERFLOW,
    ...(style.fontColor ? { cl: { rgb: style.fontColor } } : {}),
    // Like tb above: an explicit xf without a fill must BLOCK a filled
    // column/row style at compose time — Univer merges styles by key, so a
    // missing bg lets a <col style=> fill bleed through explicitly-styled
    // cells (Excel treats each xf as complete, never a merge). See
    // NO_FILL_STYLE for why the sentinel rather than bg: null.
    ...(style.fillColor ? { bg: { rgb: style.fillColor } } : { bg: { ...NO_FILL_STYLE } }),
    ...(style.numberFormat ? { n: { pattern: style.numberFormat } } : {}),
    ...(Object.keys(borders).length > 0 ? { bd: borders } : {}),
    ...(mapHorizontalAlignment(style.horizontalAlignment) === undefined
      ? {}
      : { ht: mapHorizontalAlignment(style.horizontalAlignment) }),
    ...(mapVerticalAlignment(style.verticalAlignment) === undefined
      ? {}
      : { vt: mapVerticalAlignment(style.verticalAlignment) }),
    ...(style.indent ? { pd: { l: style.indent * INDENT_STEP_PX } } : {}),
    ...(style.textRotation
      ? { tr: ooxmlTextRotationToUniver(style.textRotation) ?? undefined }
      : {}),
  }
}

export function toUniverBorder(edge: NonNullable<WorkbookCellStyle['borderTop']>): {
  s: BorderStyleTypes
  cl: { rgb: string }
} {
  return {
    s: mapBorderStyle(edge.style),
    cl: { rgb: edge.color ?? '#000000' },
  }
}

export function mapBorderStyle(style: string): BorderStyleTypes {
  switch (style) {
    case 'hair':
      return BorderStyleTypes.HAIR
    case 'dotted':
      return BorderStyleTypes.DOTTED
    case 'dashed':
      return BorderStyleTypes.DASHED
    case 'dashDot':
      return BorderStyleTypes.DASH_DOT
    case 'dashDotDot':
      return BorderStyleTypes.DASH_DOT_DOT
    case 'double':
      return BorderStyleTypes.DOUBLE
    case 'medium':
      return BorderStyleTypes.MEDIUM
    case 'mediumDashed':
      return BorderStyleTypes.MEDIUM_DASHED
    case 'mediumDashDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT
    case 'mediumDashDotDot':
      return BorderStyleTypes.MEDIUM_DASH_DOT_DOT
    case 'slantDashDot':
      return BorderStyleTypes.SLANT_DASH_DOT
    case 'thick':
      return BorderStyleTypes.THICK
    default:
      return BorderStyleTypes.THIN
  }
}

function mapHorizontalAlignment(value: string | undefined): HorizontalAlign | undefined {
  if (value === 'left') return HorizontalAlign.LEFT
  if (value === 'center') return HorizontalAlign.CENTER
  // The center-across-selection box is widened by center-continuous.ts.
  if (value === 'centerContinuous') return HorizontalAlign.CENTER
  if (value === 'right') return HorizontalAlign.RIGHT
  if (value === 'justify') return HorizontalAlign.JUSTIFIED
  if (value === 'distributed') return HorizontalAlign.DISTRIBUTED
  return undefined
}

function mapVerticalAlignment(value: string | undefined): VerticalAlign | undefined {
  if (value === 'top') return VerticalAlign.TOP
  if (value === 'center') return VerticalAlign.MIDDLE
  if (value === 'bottom') return VerticalAlign.BOTTOM
  // Excel centres a justify/distributed block; Univer has no equivalent and
  // would otherwise fall through to its bottom default.
  if (value === 'justify' || value === 'distributed') return VerticalAlign.MIDDLE
  return undefined
}
