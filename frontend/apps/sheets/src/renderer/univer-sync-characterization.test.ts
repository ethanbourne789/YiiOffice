/**
 * Characterization tests for the pure-mapping surface of univer-sync.ts.
 *
 * These lock CURRENT behavior (including deliberate Excel-compat quirks) so
 * the planned module split and any future Univer upgrade cannot silently
 * change snapshot↔Univer translation semantics. They are not aspirational
 * specs: if a value here looks odd, it encodes a production Excel reference
 * documented next to the implementation.
 */
import { describe, expect, it } from 'vitest'
import {
  BaselineOffset,
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  VerticalAlign,
  WrapStrategy,
  type IStyleData,
} from '@univerjs/core'
import type { WorkbookCellStyle } from '../shared/desktop-api'
import { NO_FILL_STYLE } from './edit-journal'
import { INDENT_STEP_PX } from './selection-format'
import {
  EXCEL_ERROR_LITERALS,
  a1RangeRef,
  a1RowRangeRef,
  absRangeRef,
  baselineOffsetOf,
  cachedFormulaCellData,
  cellFontTextStyle,
  cellValueBounds,
  columnLetter,
  engineResultKeepsCache,
  formulaKeepsCache,
  fontTextStyleOf,
  hasUsableCachedValue,
  mapBorderStyle,
  matrixBounds,
  numericWrapOverride,
  recalcResultKeepsCache,
  toUniverFreeze,
  toUniverStyle,
  usesLocaleDependentFunction,
} from './univer-sync'

/// cellStyleSchema requires these booleans on every style.
function makeStyle(over: Partial<WorkbookCellStyle> = {}): WorkbookCellStyle {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    wrapText: false,
    diagonalUp: false,
    diagonalDown: false,
    ...over,
  }
}

describe('toUniverStyle (file xf → Univer IStyleData)', () => {
  it('maps font, color and flag keys', () => {
    const s = toUniverStyle(
      makeStyle({
        fontFamily: 'Calibri',
        fontSize: 11,
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        fontColor: '#FF0000',
        vertAlign: 'superscript',
      }),
    )
    expect(s.ff).toBe('Calibri')
    expect(s.fs).toBe(11)
    expect(s.bl).toBe(BooleanNumber.TRUE)
    expect(s.it).toBe(BooleanNumber.TRUE)
    expect(s.ul).toEqual({ s: BooleanNumber.TRUE })
    expect(s.st).toEqual({ s: BooleanNumber.TRUE })
    expect(s.cl).toEqual({ rgb: '#FF0000' })
    expect(s.va).toBe(BaselineOffset.SUPERSCRIPT)
  })

  it('always emits bl/it as TRUE/FALSE (never absent)', () => {
    const s = toUniverStyle(makeStyle())
    expect(s.bl).toBe(BooleanNumber.FALSE)
    expect(s.it).toBe(BooleanNumber.FALSE)
  })

  it('wrapText maps to WRAP, but centerContinuous must NOT wrap', () => {
    expect(toUniverStyle(makeStyle({ wrapText: true })).tb).toBe(WrapStrategy.WRAP)
    expect(
      toUniverStyle(makeStyle({ wrapText: true, horizontalAlignment: 'centerContinuous' })).tb,
    ).toBe(WrapStrategy.OVERFLOW)
    expect(toUniverStyle(makeStyle()).tb).toBe(WrapStrategy.OVERFLOW)
  })

  it('an explicit xf without a fill emits the NO_FILL sentinel (blocks col/row bleed)', () => {
    expect(toUniverStyle(makeStyle()).bg).toEqual(NO_FILL_STYLE)
    expect(toUniverStyle(makeStyle({ fillColor: '#00FF00' })).bg).toEqual({ rgb: '#00FF00' })
  })

  it('maps alignment, indent and number format', () => {
    const s = toUniverStyle(
      makeStyle({
        horizontalAlignment: 'center',
        verticalAlignment: 'center',
        indent: 2,
        numberFormat: '0.00',
      }),
    )
    expect(s.ht).toBe(HorizontalAlign.CENTER)
    expect(s.vt).toBe(VerticalAlign.MIDDLE)
    expect(s.n).toEqual({ pattern: '0.00' })
    expect(s.pd).toEqual({ l: 2 * INDENT_STEP_PX })
  })

  it('centerContinuous maps to CENTER (run widening is done by the render patch)', () => {
    expect(toUniverStyle(makeStyle({ horizontalAlignment: 'centerContinuous' })).ht).toBe(
      HorizontalAlign.CENTER,
    )
  })

  it('justify/distributed vertical alignment falls back to MIDDLE', () => {
    expect(toUniverStyle(makeStyle({ verticalAlignment: 'justify' })).vt).toBe(VerticalAlign.MIDDLE)
    expect(toUniverStyle(makeStyle({ verticalAlignment: 'distributed' })).vt).toBe(
      VerticalAlign.MIDDLE,
    )
  })

  it('maps borders incl. diagonal direction pairing', () => {
    const s = toUniverStyle(
      makeStyle({
        borderTop: { style: 'thick', color: '#111111' },
        borderDiagonal: { style: 'thin' },
        diagonalDown: true,
      }),
    )
    expect(s.bd?.t).toEqual({ s: BorderStyleTypes.THICK, cl: { rgb: '#111111' } })
    expect(s.bd?.tl_br).toEqual({ s: BorderStyleTypes.THIN, cl: { rgb: '#000000' } })
    expect(s.bd?.bl_tr).toBeUndefined()
  })

  it('emits tr only for a text rotation', () => {
    expect(toUniverStyle(makeStyle()).tr).toBeUndefined()
    expect(toUniverStyle(makeStyle({ textRotation: 45 })).tr).toBeDefined()
  })
})

describe('mapBorderStyle', () => {
  it.each([
    ['hair', BorderStyleTypes.HAIR],
    ['dotted', BorderStyleTypes.DOTTED],
    ['dashed', BorderStyleTypes.DASHED],
    ['dashDot', BorderStyleTypes.DASH_DOT],
    ['dashDotDot', BorderStyleTypes.DASH_DOT_DOT],
    ['double', BorderStyleTypes.DOUBLE],
    ['medium', BorderStyleTypes.MEDIUM],
    ['mediumDashed', BorderStyleTypes.MEDIUM_DASHED],
    ['mediumDashDot', BorderStyleTypes.MEDIUM_DASH_DOT],
    ['mediumDashDotDot', BorderStyleTypes.MEDIUM_DASH_DOT_DOT],
    ['slantDashDot', BorderStyleTypes.SLANT_DASH_DOT],
    ['thick', BorderStyleTypes.THICK],
    ['thin', BorderStyleTypes.THIN],
    ['anything-unknown', BorderStyleTypes.THIN],
  ] as const)('maps %s', (input, expected) => {
    expect(mapBorderStyle(input)).toBe(expected)
  })
})

describe('font style helpers', () => {
  it('cellFontTextStyle skips falsy keys and keeps only font subset', () => {
    expect(cellFontTextStyle(undefined)).toEqual({})
    const s = cellFontTextStyle(makeStyle({ fontFamily: 'Arial', fontSize: 9, bold: true }))
    expect(s).toEqual({ ff: 'Arial', fs: 9, bl: BooleanNumber.TRUE })
  })

  it('baselineOffsetOf maps subscript/superscript', () => {
    expect(baselineOffsetOf('subscript')).toBe(BaselineOffset.SUBSCRIPT)
    expect(baselineOffsetOf('superscript')).toBe(BaselineOffset.SUPERSCRIPT)
  })

  it('fontTextStyleOf extracts the font subset from a composed style', () => {
    const composed: IStyleData = {
      ff: 'Arial',
      fs: 10,
      bl: BooleanNumber.TRUE,
      ul: { s: BooleanNumber.TRUE },
      cl: { rgb: '#123456' },
      ht: HorizontalAlign.CENTER,
      bg: { rgb: '#ffffff' },
    }
    expect(fontTextStyleOf(composed)).toEqual({
      ff: 'Arial',
      fs: 10,
      bl: BooleanNumber.TRUE,
      ul: { s: BooleanNumber.TRUE },
      cl: { rgb: '#123456' },
    })
    expect(fontTextStyleOf(null)).toEqual({})
  })
})

describe('toUniverFreeze', () => {
  it('null freeze yields an empty patch', () => {
    expect(toUniverFreeze(null)).toEqual({})
  })
  it('maps counts and uses -1 sentinels for zero splits', () => {
    expect(toUniverFreeze({ frozenRows: 2, frozenColumns: 3 })).toEqual({
      freeze: { xSplit: 3, ySplit: 2, startRow: 2, startColumn: 3 },
    })
    expect(toUniverFreeze({ frozenRows: 0, frozenColumns: 0 })).toEqual({
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    })
  })
})

describe('cell address utilities', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('columnLetter(%i) === %s', (index, label) => {
    expect(columnLetter(index)).toBe(label)
  })

  it('absRangeRef emits $A$1-style refs with doubled apostrophes in the name', () => {
    expect(absRangeRef('Sheet1', 'A1:B2')).toBe("'Sheet1'!$A$1:$B$2")
    expect(absRangeRef("O'Brien", 'C3:D4')).toBe("'O''Brien'!$C$3:$D$4")
  })

  it('a1RangeRef spans one column (0-based rows)', () => {
    expect(a1RangeRef('S', 0, 0, 4)).toBe("'S'!$A$1:$A$5")
  })

  it('a1RowRangeRef spans one row (0-based columns)', () => {
    expect(a1RowRangeRef('S', 2, 1, 3)).toBe("'S'!$B$3:$D$3")
  })

  it('matrixBounds computes the bounding IRange of a row→col matrix', () => {
    expect(matrixBounds({ '0': { '0': 1 }, '2': { '5': 2 } })).toEqual({
      startRow: 0,
      endRow: 2,
      startColumn: 0,
      endColumn: 5,
    })
    expect(matrixBounds('not-an-object')).toBeNull()
    expect(matrixBounds({})).toBeNull()
  })

  it('cellValueBounds ignores negative and non-integer keys', () => {
    expect(cellValueBounds({ '1': { '2': 'x' } })).toEqual({
      startRow: 1,
      endRow: 1,
      startColumn: 2,
      endColumn: 2,
    })
    expect(cellValueBounds({ '-1': { '0': 'x' } })).toBeNull()
    expect(cellValueBounds('scalar')).toBeNull()
  })
})

describe('formula cache policy (Excel keeps cached values the engine cannot reproduce)', () => {
  it('EXCEL_ERROR_LITERALS covers the full Excel error set', () => {
    for (const lit of ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#ERROR!']) {
      expect(EXCEL_ERROR_LITERALS.has(lit)).toBe(true)
    }
    expect(EXCEL_ERROR_LITERALS.has('#OK')).toBe(false)
  })

  it('hasUsableCachedValue rejects null/undefined and error literals', () => {
    expect(hasUsableCachedValue(5)).toBe(true)
    expect(hasUsableCachedValue('text')).toBe(true)
    expect(hasUsableCachedValue('')).toBe(true)
    expect(hasUsableCachedValue(null)).toBe(false)
    expect(hasUsableCachedValue(undefined)).toBe(false)
    expect(hasUsableCachedValue('#REF!')).toBe(false)
  })

  it('usesLocaleDependentFunction matches calls outside string literals only', () => {
    expect(usesLocaleDependentFunction('=DOLLAR(A1)')).toBe(true)
    expect(usesLocaleDependentFunction('=NUMBERSTRING(A1,1)')).toBe(true)
    expect(usesLocaleDependentFunction('=dollar(a1)')).toBe(true)
    expect(usesLocaleDependentFunction('=IF(A1="DOLLAR(",1,2)')).toBe(false)
    expect(usesLocaleDependentFunction('=PDOLLAR(A1)')).toBe(false)
  })

  it('engineResultKeepsCache keeps cache for #NAME?/#ERROR! and locale functions', () => {
    expect(engineResultKeepsCache('#NAME?', undefined)).toBe(true)
    expect(engineResultKeepsCache('#ERROR!', undefined)).toBe(true)
    expect(engineResultKeepsCache('#REF!', '=A1/B1')).toBe(false)
    expect(engineResultKeepsCache('whatever', '=DOLLAR(A1)')).toBe(true)
  })

  it('recalcResultKeepsCache only preserves blank/error over cache before edits', () => {
    expect(recalcResultKeepsCache('#REF!', '=A1/B1', 5, false)).toBe(true)
    expect(recalcResultKeepsCache('', '=A1/B1', 5, false)).toBe(true)
    expect(recalcResultKeepsCache('#REF!', '=A1/B1', 5, true)).toBe(false)
    expect(recalcResultKeepsCache('#REF!', '=A1/B1', '#NAME?', false)).toBe(false)
  })

  it('formulaKeepsCache pins __xludf and locale formulas regardless of cache', () => {
    expect(formulaKeepsCache('=IFERROR(__xludf.DUMMYFUNCTION("x"),46235.0)', false)).toBe(true)
    expect(formulaKeepsCache('=DOLLAR(A1)', false)).toBe(true)
    expect(formulaKeepsCache('=SUM(A1:A9)', false)).toBe(false)
  })

  it('cachedFormulaCellData tags string values as STRING to block numeric coercion', () => {
    expect(cachedFormulaCellData('=A1', '1')).toEqual({ f: '=A1', v: '1', t: CellValueType.STRING })
    expect(cachedFormulaCellData('=A1', 1)).toEqual({ f: '=A1', v: 1 })
    expect(cachedFormulaCellData('=A1', null)).toEqual({ f: '=A1' })
  })

  it('numericWrapOverride: Excel never wraps numbers', () => {
    expect(numericWrapOverride(5, true)).toBe(true)
    expect(numericWrapOverride('text', true)).toBe(false)
    expect(numericWrapOverride(5, false)).toBe(false)
  })
})
