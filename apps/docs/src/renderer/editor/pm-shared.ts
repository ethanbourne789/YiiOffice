/**
 * Primitives shared by both conversion directions: the ProseMirror node shape,
 * run/paragraph formatting normalisation, the ProseMirror-table -> TableModel
 * reader and the content signatures that decide whether a block really changed.
 *
 * doc -> Pm lives in `convert.ts`, Pm -> SaveBlock[] in `pm-save-plan.ts`. Both
 * import from here, so neither has to reach into the other.
 */

import {
  symbolGlyph,
  symbolPuaChar,
  type ParaFormat,
  type Run,
  type TableCell,
  type TableModel,
  type TextboxDisplay,
} from '@yiioffice/docx-engine'
import { symbolFontCovers } from '../font-check'
import { parseRunBorderAttr } from './run-border'
import { parseTextOutlineAttr } from './text-outline'
import { parseGlowAttr, parseTextEffectAttr } from './text-effects'

/** minimal ProseMirror JSON shapes */
export interface PmMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  text?: string
  marks?: PmMark[]
}

export function tableStructureSignature(table: PmNode): string {
  return JSON.stringify({
    widths: table.attrs?.colWidthsPct ?? null,
    widthPx: table.attrs?.widthPx ?? null,
    widthPct: table.attrs?.widthPct ?? null,
    autoFit: table.attrs?.tblAutoFit ?? null,
    autoFitEdited: table.attrs?.tblAutoFitEdited ?? false,
    cellMar: table.attrs?.cellMar ?? null,
    cellMarEdited: table.attrs?.cellMarEdited ?? false,
    tblStyle: table.attrs?.tblStyleId ?? null,
    tblAlign: table.attrs?.tblAlign ?? null,
    tblFloat: table.attrs?.tblFloat ?? null,
    tblFloatXTwips: table.attrs?.tblFloatXTwips ?? null,
    tblFloatYTwips: table.attrs?.tblFloatYTwips ?? null,
    tblFloatHorzAnchor: table.attrs?.tblFloatHorzAnchor ?? null,
    tblFloatVertAnchor: table.attrs?.tblFloatVertAnchor ?? null,
    tblFloatDistance: table.attrs?.tblFloatDistance ?? null,
    tblFloatEdited: table.attrs?.tblFloatEdited ?? false,
    tblLook: table.attrs?.tblLook ?? null,
    tblLookEdited: table.attrs?.tblLookEdited ?? false,
    tblCaption: table.attrs?.tblCaption ?? null,
    tblDescription: table.attrs?.tblDescription ?? null,
    tblAltEdited: table.attrs?.tblAltEdited ?? false,
    rows: (table.content ?? []).map((row) => [
      row.attrs?.heightTwips ?? null,
      row.attrs?.heightRule ?? null,
      row.attrs?.repeatHeader ?? false,
      row.attrs?.repeatHeaderEdited ?? false,
      row.attrs?.cantSplit ?? false,
      row.attrs?.cantSplitEdited ?? false,
      // accepting/rejecting revisions strips records from trPr/tcPr: include them in the signature to trigger regeneration (works for empty rows too)
      row.attrs?.rawTrPr ?? null,
      row.attrs?.rowRevision ?? null,
      ...(row.content ?? []).map((cell) => [
        cell.type,
        cell.attrs?.colspan ?? 1,
        cell.attrs?.rowspan ?? 1,
        cell.attrs?.colwidth ?? null,
        cell.attrs?.fill ?? null,
        cell.attrs?.color ?? null,
        cell.attrs?.bold ?? false,
        cell.attrs?.align ?? null,
        cell.attrs?.vAlign ?? null,
        cell.attrs?.borders ?? null,
        cell.attrs?.rawTcPr ?? null,
        cell.attrs?.cellRevision ?? null,
        cell.attrs?.textDirection ?? null,
        cell.attrs?.cellMar ?? null,
        cell.attrs?.noWrap ?? null,
        cell.attrs?.tcPrEdited ?? false,
      ]),
    ]),
  })
}

function inlineFormattingSignature(content: PmNode[] | undefined): string[] {
  const styles: string[] = []
  for (const node of content ?? []) {
    // the schema re-sorts marks by rank on load, so the parse-side order must not count
    const style =
      node.type === 'text'
        ? JSON.stringify(
            [...(node.marks ?? [])]
              .sort((a, b) => a.type.localeCompare(b.type))
              .map((mark) => [mark.type, mark.attrs ?? null]),
          )
        : node.type
    if (styles[styles.length - 1] !== style) styles.push(style)
  }
  return styles
}

export function tableFormattingSignature(table: PmNode): string {
  return JSON.stringify(
    (table.content ?? []).map((row) =>
      (row.content ?? []).map((cell) =>
        (cell.content ?? []).map((paragraph) => [
          normalizedFormat(nodeFormat(paragraph)),
          // list toggles must force regeneration (the text patch keeps old pPr)
          paragraph.type === 'docListItem'
            ? [paragraph.attrs?.kind, paragraph.attrs?.numId, paragraph.attrs?.ilvl]
            : null,
          inlineFormattingSignature(paragraph.content),
        ]),
      ),
    ),
  )
}

function paragraphText(node: PmNode): string {
  return inlineToRuns(node.content ?? [])
    .map((run) => run.text)
    .join('')
}

export function unwrapBlockRevisionXml(xml: string): string {
  const match = /^<w:(ins|del)\b[^>]*>([\s\S]*)<\/w:\1>$/.exec(xml)
  return match ? match[2] : xml
}

/** Convert native table cells back to the physical OOXML-style TableModel grid. */
export function pmTableToModel(table: PmNode): TableModel {
  type ActiveSpan = {
    remaining: number
    span: number
    cell: Omit<TableModel['rows'][number][number], 'paras'>
  }
  let active = new Map<number, ActiveSpan>()
  const rows: TableModel['rows'] = []
  let maximumColumns = 0

  const rowHeightsTwips: Array<number | null> = []
  const rowHeightRules: NonNullable<TableModel['rowHeightRules']> = []
  const repeatHeaderRows: Array<boolean | null> = []
  const rowCantSplit: Array<boolean | null> = []
  const rawTrPrs: Array<string | null> = []
  const rowRevisions: TableModel['rowRevisions'] = []
  for (const rowNode of table.content ?? []) {
    rowHeightsTwips.push((rowNode.attrs?.heightTwips as number | null) ?? null)
    rowHeightRules.push(
      (rowNode.attrs?.heightRule as NonNullable<TableModel['rowHeightRules']>[number]) ?? null,
    )
    repeatHeaderRows.push(
      rowNode.attrs?.repeatHeaderEdited || table.attrs?.docxIndex == null
        ? !!rowNode.attrs?.repeatHeader
        : null,
    )
    rowCantSplit.push(
      rowNode.attrs?.cantSplitEdited || table.attrs?.docxIndex == null
        ? !!rowNode.attrs?.cantSplit
        : null,
    )
    rawTrPrs.push((rowNode.attrs?.rawTrPr as string | null) ?? null)
    rowRevisions.push(
      (rowNode.attrs?.rowRevision as NonNullable<TableModel['rowRevisions']>[number]) ?? null,
    )
    const entries: Array<{
      column: number
      cell: TableModel['rows'][number][number]
    }> = []
    const occupied = new Set<number>()
    for (const [column, span] of active) {
      entries.push({
        column,
        cell: {
          ...span.cell,
          paras: [''],
          colSpan: span.span > 1 ? span.span : undefined,
          vMerge: 'continue',
        },
      })
      for (let i = 0; i < span.span; i++) occupied.add(column + i)
    }

    const added = new Map<number, ActiveSpan>()
    let cursor = 0
    for (const cellNode of rowNode.content ?? []) {
      while (occupied.has(cursor)) cursor++
      const colspan = Math.max(1, Number(cellNode.attrs?.colspan) || 1)
      const rowspan = Math.max(1, Number(cellNode.attrs?.rowspan) || 1)
      const style = {
        fill: (cellNode.attrs?.fill as string | null) ?? undefined,
        color: (cellNode.attrs?.color as string | null) ?? undefined,
        bold: cellNode.attrs?.bold ? true : undefined,
        align: (cellNode.attrs?.align as TableModel['rows'][number][number]['align']) ?? undefined,
        vAlign: (cellNode.attrs?.vAlign as TableCell['vAlign'] | null) ?? undefined,
        borders: (cellNode.attrs?.borders as TableCell['borders'] | null) ?? undefined,
        rawTcPr: (cellNode.attrs?.rawTcPr as string | null) ?? undefined,
        gridGap: cellNode.attrs?.gridGap ? true : undefined,
        // edited tcPr groups are written from the attrs; a null direction / margin
        // set means "explicitly horizontal" / "same as the table" (element removed)
        ...(cellNode.attrs?.tcPrEdited || table.attrs?.docxIndex == null
          ? {
              tcPrEdited: true,
              textDirection:
                (cellNode.attrs?.textDirection as TableCell['textDirection']) ?? 'lrTb',
              cellMarTwips: (cellNode.attrs?.cellMar as TableCell['cellMarTwips']) ?? {},
              noWrap: !!cellNode.attrs?.noWrap,
            }
          : {}),
      }
      const cellParas = (cellNode.content ?? []).filter(
        (n) => n.type === 'docParagraph' || n.type === 'docListItem',
      )
      // nested tables round-trip with the model: text edits use the surgical patch, structural regeneration emits the whole table (nested tables no longer dropped)
      const nestedModels: TableModel[] = []
      const nestedAnchors: number[] = []
      let paraCount = 0
      const cellBoxes: TextboxDisplay[] = []
      const cellBoxAnchors: number[] = []
      for (const n of cellNode.content ?? []) {
        if (n.type === 'docParagraph' || n.type === 'docListItem') paraCount++
        else if (n.type === 'docNestedTable' && n.attrs?.model) {
          nestedModels.push(n.attrs.model as TableModel)
          nestedAnchors.push(paraCount)
        } else if (n.type === 'docCellBoxes' && Array.isArray(n.attrs?.boxes)) {
          for (const box of n.attrs.boxes as TextboxDisplay[]) {
            cellBoxes.push(box)
            cellBoxAnchors.push(paraCount)
          }
        }
      }
      entries.push({
        column: cursor,
        cell: {
          ...style,
          paras: cellParas.map(paragraphText),
          richParas: cellParas.map((paragraph) => ({
            ...nodeFormat(paragraph),
            ...(paragraph.type === 'docListItem' && paragraph.attrs?.numId
              ? {
                  list: {
                    kind: (paragraph.attrs.kind as 'bullet' | 'ordered') ?? 'bullet',
                    numId: String(paragraph.attrs.numId),
                    ilvl: Number(paragraph.attrs.ilvl) || 0,
                  },
                }
              : {}),
            runs: inlineToRuns(paragraph.content ?? []),
          })),
          ...(nestedModels.length > 0
            ? { nestedTables: nestedModels, nestedTableAnchors: nestedAnchors }
            : {}),
          ...(cellBoxes.length > 0
            ? { anchoredBoxes: cellBoxes, anchoredBoxAnchors: cellBoxAnchors }
            : {}),
          colSpan: colspan > 1 ? colspan : undefined,
          vMerge: rowspan > 1 ? 'restart' : undefined,
        },
      })
      if (rowspan > 1)
        added.set(cursor, {
          remaining: rowspan - 1,
          span: colspan,
          cell: style,
        })
      for (let i = 0; i < colspan; i++) occupied.add(cursor + i)
      cursor += colspan
    }
    maximumColumns = Math.max(maximumColumns, occupied.size)
    rows.push(entries.sort((a, b) => a.column - b.column).map((entry) => entry.cell))

    const next = new Map<number, ActiveSpan>()
    for (const [column, span] of active) {
      if (span.remaining > 1) next.set(column, { ...span, remaining: span.remaining - 1 })
    }
    for (const [column, span] of added) next.set(column, span)
    active = next
  }

  let colWidthsPct = (table.attrs?.colWidthsPct as number[] | null) ?? undefined
  let colWidthsTwips: number[] | undefined
  const firstRow = table.content?.[0]?.content ?? []
  const explicit = firstRow.flatMap((cell) => (cell.attrs?.colwidth as number[] | null) ?? [])
  if (explicit.length === maximumColumns && explicit.every((width) => width > 0)) {
    const total = explicit.reduce((sum, width) => sum + width, 0)
    colWidthsPct = explicit.map((width) => (width / total) * 100)
    colWidthsTwips = explicit.map((width) => Math.round(width * 15))
  } else if (colWidthsPct?.length !== maximumColumns) {
    colWidthsPct = Array.from({ length: maximumColumns }, () => 100 / maximumColumns)
  }
  const tblStyleAttr = table.attrs?.tblStyleId as string | null | undefined
  const isNew = table.attrs?.docxIndex == null
  const tablePropsEdited = (name: string): boolean => isNew || table.attrs?.[name] === true
  const visibleFloat =
    table.attrs?.tblFloat === 'left' || table.attrs?.tblFloat === 'right'
      ? (table.attrs.tblFloat as 'left' | 'right')
      : null
  const suppressedFloat =
    table.attrs?.tblFloatSuppressed &&
    (table.attrs?.tblFloatSource === 'left' || table.attrs?.tblFloatSource === 'right')
      ? (table.attrs.tblFloatSource as 'left' | 'right')
      : null
  const floatSide = visibleFloat ?? suppressedFloat
  const floatPosition =
    floatSide && (table.attrs?.tblFloatXTwips != null || table.attrs?.tblFloatYTwips != null)
      ? {
          xTwips: Number(table.attrs?.tblFloatXTwips) || 0,
          yTwips: Number(table.attrs?.tblFloatYTwips) || 0,
          ...(table.attrs?.tblFloatHorzAnchor
            ? {
                horzAnchor: table.attrs.tblFloatHorzAnchor as NonNullable<
                  TableModel['floatPos']
                >['horzAnchor'],
              }
            : {}),
          ...(table.attrs?.tblFloatVertAnchor
            ? {
                vertAnchor: table.attrs.tblFloatVertAnchor as NonNullable<
                  TableModel['floatPos']
                >['vertAnchor'],
              }
            : {}),
          ...(table.attrs?.tblFloatDistance
            ? {
                distanceTwips: table.attrs.tblFloatDistance as NonNullable<
                  TableModel['floatPos']
                >['distanceTwips'],
              }
            : {}),
        }
      : undefined
  return {
    rows,
    ...(colWidthsPct ? { colWidthsPct } : {}),
    ...(colWidthsTwips ? { colWidthsTwips } : {}),
    ...(table.attrs?.cellSpacingTwips
      ? { cellSpacingTwips: Number(table.attrs.cellSpacingTwips) }
      : {}),
    ...(table.attrs?.tblFill ? { fill: String(table.attrs.tblFill) } : {}),
    ...(rowHeightsTwips.some((h) => h !== null) ? { rowHeightsTwips, rowHeightRules } : {}),
    ...(repeatHeaderRows.some((value) => value !== null) ? { repeatHeaderRows } : {}),
    ...(rowCantSplit.some((value) => value !== null) ? { rowCantSplit } : {}),
    ...(rawTrPrs.some((r) => r !== null) ? { rawTrPrs } : {}),
    ...(rowRevisions.some((revision) => revision !== null) ? { rowRevisions } : {}),
    // null (cleared) → '' removes explicitly; undefined leaves it alone
    ...(tblStyleAttr !== undefined ? { tblStyleId: tblStyleAttr ?? '' } : {}),
    // explicit only when set ('left' = remove w:jc); null leaves the original
    // tblPr untouched so unmapped w:jc values (e.g. 'start') survive rebuilds
    ...(table.attrs?.tblAlign ? { align: table.attrs.tblAlign as TableModel['align'] } : {}),
    ...(tablePropsEdited('tblAutoFitEdited')
      ? {
          autoFit: table.attrs?.tblAutoFit as NonNullable<TableModel['autoFit']>,
        }
      : {}),
    ...(tablePropsEdited('cellMarEdited') && table.attrs?.cellMar
      ? {
          cellMarTwips: table.attrs.cellMar as NonNullable<TableModel['cellMarTwips']>,
        }
      : {}),
    ...(tablePropsEdited('tblFloatEdited')
      ? { floatSide, ...(floatPosition ? { floatPos: floatPosition } : {}) }
      : {}),
    ...(tablePropsEdited('tblLookEdited') && table.attrs?.tblLook
      ? {
          tableLook: table.attrs.tblLook as NonNullable<TableModel['tableLook']>,
        }
      : {}),
    // new tables only carry alt text when set; edited ones write '' to drop the element
    ...(table.attrs?.tblAltEdited ||
    (isNew && (table.attrs?.tblCaption || table.attrs?.tblDescription))
      ? {
          caption: String(table.attrs?.tblCaption ?? ''),
          description: String(table.attrs?.tblDescription ?? ''),
        }
      : {}),
  }
}

export const PAGINATION_FLAG_KEYS = [
  'keepNext',
  'keepLines',
  'widowControl',
  'suppressLineNumbers',
] as const

export function nodeFormat(node: PmNode): ParaFormat | undefined {
  const format: ParaFormat = {}
  if (node.attrs?.align) format.align = node.attrs.align as ParaFormat['align']
  if (node.attrs?.lineSpacing) format.lineSpacing = Number(node.attrs.lineSpacing)
  if (node.attrs?.lineRule) format.lineRule = node.attrs.lineRule as ParaFormat['lineRule']
  if (node.attrs?.lineRawTwips) format.lineRawTwips = Number(node.attrs.lineRawTwips)
  // 0 kept: an explicit w:left="0" overrides a numbering-level indent
  if (node.attrs?.indentLeft != null) format.indentLeft = Number(node.attrs.indentLeft)
  if (node.attrs?.indentRight != null) format.indentRight = Number(node.attrs.indentRight)
  if (node.attrs?.indentFirstLine != null)
    format.indentFirstLine = Number(node.attrs.indentFirstLine)
  // the character-unit special indent rides along its twips twin and is written
  // as w:firstLineChars next to it (Word prefers the character unit on reload).
  //
  // Two fields, because the parser's two mean different things: `charIndents`
  // there is the EFFECTIVE value (style chain merged in) and is what generate
  // and the cancel-attr merge read, while `directCharIndents` is only what the
  // paragraph's own w:ind declares. nodeFormat has no style chain to consult —
  // it reads the node's attributes — so what it sets is the direct value, and
  // setting both keeps generate correct and gives the signature a direct value
  // on both sides. Before this, the signature compared the effective value with
  // the direct one, so every style-inherited paragraph looked edited and an
  // untouched document came back carrying a frozen direct indent.
  const firstLineChars = Number(node.attrs?.indentFirstLineChars)
  if (Number.isFinite(firstLineChars) && firstLineChars > 0) {
    format.charIndents = { ...format.charIndents, firstLine: firstLineChars }
    format.directCharIndents = {
      ...format.directCharIndents,
      firstLine: firstLineChars,
    }
  }
  if (node.attrs?.spaceBefore != null) format.spaceBefore = Number(node.attrs.spaceBefore)
  if (node.attrs?.spaceAfter != null) format.spaceAfter = Number(node.attrs.spaceAfter)
  if (node.attrs?.spaceBeforeAuto != null)
    format.spaceBeforeAuto = node.attrs.spaceBeforeAuto as boolean
  if (node.attrs?.spaceAfterAuto != null)
    format.spaceAfterAuto = node.attrs.spaceAfterAuto as boolean
  if (node.attrs?.contextualSpacing != null)
    format.contextualSpacing = node.attrs.contextualSpacing as boolean
  for (const key of PAGINATION_FLAG_KEYS)
    if (node.attrs?.[key] != null) format[key] = node.attrs[key] as boolean
  if (node.attrs?.pageBreakBefore) format.pageBreakBefore = true
  if (node.attrs?.bidi) format.bidi = true
  if (node.attrs?.autoSpace != null) format.autoSpace = node.attrs.autoSpace as boolean
  if (node.attrs?.wordWrap != null) format.wordWrap = node.attrs.wordWrap as boolean
  if (node.attrs?.overflowPunct != null) {
    format.overflowPunct = node.attrs.overflowPunct as boolean
  }
  if (node.attrs?.eaLang) format.eastAsiaLang = String(node.attrs.eaLang)
  if (node.attrs?.shadingFill) format.shadingFill = String(node.attrs.shadingFill)
  if (node.attrs?.borders) format.borders = String(node.attrs.borders)
  if (node.attrs?.borderLines) {
    try {
      const parsed = JSON.parse(String(node.attrs.borderLines))
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        format.borderLines = parsed
      }
    } catch {
      /* ignore malformed */
    }
  }
  if (node.attrs?.tabStops) {
    try {
      const parsed = JSON.parse(String(node.attrs.tabStops))
      if (Array.isArray(parsed) && parsed.length > 0) format.tabStops = parsed
    } catch {
      /* ignore malformed */
    }
  }
  if (node.attrs?.dropCap) {
    try {
      const parsed = JSON.parse(String(node.attrs.dropCap))
      if (parsed && typeof parsed === 'object') format.dropCap = parsed
    } catch {
      /* ignore malformed */
    }
  }
  if (node.attrs?.frame) {
    try {
      const parsed = JSON.parse(String(node.attrs.frame))
      if (parsed && typeof parsed === 'object' && parsed.wTwips > 0) format.frame = parsed
    } catch {
      /* ignore malformed */
    }
  }
  if (node.attrs?.textDirection) {
    const dir = String(node.attrs.textDirection)
    if (dir === 'tbRl' || dir === 'tbRlV' || dir === 'btLr') format.textDirection = dir
  }
  if (node.attrs?.emptyRunSize) format.emptyRunSizeHalfPoints = Number(node.attrs.emptyRunSize)
  if (node.attrs?.emptyRunFont) format.emptyRunFontFamily = String(node.attrs.emptyRunFont)
  if (node.attrs?.markSize) format.markSizeHalfPoints = Number(node.attrs.markSize)
  return Object.keys(format).length > 0 ? format : undefined
}

export function inlineToRuns(content: PmNode[]): Run[] {
  const runs: Run[] = []
  for (const node of content) {
    if (node.type === 'hardBreak') {
      const ch = node.attrs?.pageBreak
        ? '\f'
        : node.attrs?.colBreak
          ? '\v'
          : node.attrs?.wrapBreak
            ? '\u001e'
            : '\n'
      const prev = runs[runs.length - 1]
      const prevAtomic =
        prev &&
        (prev.noteRef ||
          prev.xeTerm !== undefined ||
          prev.math ||
          prev.sym ||
          prev.ruby ||
          prev.image)
      if (node.marks?.length) runs.push(runFromMarks(ch, node.marks))
      else if (prev && !prevAtomic) prev.text += ch
      else runs.push({ text: ch })
      continue
    }
    if (node.type === 'docNoteRef') {
      runs.push({
        text: String(node.attrs?.num ?? 1),
        noteRef: {
          kind: (node.attrs?.kind as 'footnote' | 'endnote') ?? 'footnote',
          id: String(node.attrs?.id ?? ''),
        },
      })
      continue
    }
    if (node.type === 'docXeMark') {
      runs.push({ text: '', xeTerm: String(node.attrs?.term ?? '') })
      continue
    }
    if (node.type === 'docInlineMath') {
      const omml = String(node.attrs?.omml ?? '')
      if (omml) runs.push({ text: String(node.attrs?.text ?? ''), math: { omml } })
      continue
    }
    if (node.type === 'docRuby') {
      const base = String(node.attrs?.base ?? '')
      const xml = String(node.attrs?.xml ?? '')
      if (base) {
        runs.push(
          xml ? { text: base, ruby: { rt: String(node.attrs?.rt ?? ''), xml } } : { text: base },
        )
      }
      continue
    }
    if (node.type === 'docInlineImage') {
      const dataUrl = String(node.attrs?.dataUrl ?? '')
      const xml = String(node.attrs?.xml ?? '')
      const rule = node.attrs?.rule as NonNullable<Run['image']>['rule'] | null | undefined
      if ((dataUrl || rule) && xml) {
        runs.push({
          text: '',
          ...(node.attrs?.rawRPr ? { rawRPr: String(node.attrs.rawRPr) } : {}),
          image: {
            dataUrl,
            xml,
            ...(rule ? { rule } : {}),
            ...(node.attrs?.widthPx ? { widthPx: Number(node.attrs.widthPx) } : {}),
            ...(node.attrs?.heightPx ? { heightPx: Number(node.attrs.heightPx) } : {}),
            ...(node.attrs?.rotDeg ? { rotDeg: Number(node.attrs.rotDeg) } : {}),
            ...(node.attrs?.flipH ? { flipH: true } : {}),
            ...(node.attrs?.flipV ? { flipV: true } : {}),
          },
        })
      }
      continue
    }
    if (node.type !== 'text' || !node.text) continue
    runs.push(...symRuns(runFromMarks(node.text, node.marks ?? [])))
  }
  return mergeRuns(runs)
}

/** an installed symbol font draws the w:sym glyph itself (the exact Word shape), so the
 *  editor text is the private-use code the font's cmap indexes; the Unicode stand-in is
 *  for machines without the font. Display only: runFromMarks turns it back. */

/** an installed symbol font draws the w:sym glyph itself (the exact Word shape), so the
 *  editor text is the private-use code the font's cmap indexes; the Unicode stand-in is
 *  for machines without the font. Display only: runFromMarks turns it back. */
export function symDisplayText(run: Run): string {
  if (!run.sym) return run.text
  const pua = symbolPuaChar(run.sym.char)
  return pua && run.text !== pua && symbolFontCovers(run.sym.font, pua) ? pua : run.text
}

/** a w:sym run is one glyph; text edited or merged under its mark goes back as plain runs */
export function symRuns(run: Run): Run[] {
  if (!run.sym) return [run]
  const glyph = symbolGlyph(run.sym.font, run.sym.char)
  if (run.text === glyph) return [run]
  const { sym, ...plain } = run
  return [...run.text].map((ch) => ({
    ...plain,
    text: ch,
    ...(ch === glyph ? { sym } : {}),
  }))
}

export function runFromMarks(text: string, marks: PmMark[]): Run {
  const run: Run = { text }
  for (const mark of marks) {
    if (mark.type === 'bold') run.bold = true
    else if (mark.type === 'italic') run.italic = true
    else if (mark.type === 'underline') run.underline = true
    else if (mark.type === 'strike') run.strike = true
    else if (mark.type === 'link') {
      run.link = {
        href: String(mark.attrs?.href ?? ''),
        rId: (mark.attrs?.rId as string) ?? undefined,
        tooltip: (mark.attrs?.tooltip as string) ?? undefined,
        ...(mark.attrs?.plain ? { plain: true } : {}),
      }
    } else if (mark.type === 'refField') {
      run.refField = String(mark.attrs?.name ?? '')
      if (mark.attrs?.instr) run.refInstr = String(mark.attrs.instr)
      if (mark.attrs?.dirty === true) run.fldDirty = true
    } else if (mark.type === 'docSym') {
      run.sym = {
        font: String(mark.attrs?.font ?? ''),
        char: String(mark.attrs?.char ?? ''),
      }
      if (run.text === symbolPuaChar(run.sym.char))
        run.text = symbolGlyph(run.sym.font, run.sym.char) ?? run.text
    } else if (mark.type === 'instrField') {
      run.instrField = String(mark.attrs?.instr ?? '')
      if (mark.attrs?.beginXml) run.fldBeginXml = String(mark.attrs.beginXml)
      if (mark.attrs?.dirty === true) run.fldDirty = true
    } else if (mark.type === 'ctrlCheckbox') {
      run.sdtCheckboxXml = String(mark.attrs?.sdtPr ?? '')
    } else if (mark.type === 'comment') {
      const ids = String(mark.attrs?.ids ?? '')
        .split(' ')
        .filter(Boolean)
      if (ids.length > 0) run.commentIds = ids
    } else if (mark.type === 'ins' || mark.type === 'del') {
      const info: NonNullable<Run['ins']> = {
        author: String(mark.attrs?.author ?? ''),
      }
      if (mark.attrs?.date) info.date = String(mark.attrs.date)
      if (mark.attrs?.id) info.id = String(mark.attrs.id)
      if (mark.type === 'ins') run.ins = info
      else run.del = info
    } else if (mark.type === 'docTextStyle') {
      if (mark.attrs?.color) run.color = String(mark.attrs.color)
      if (mark.attrs?.sizeHalfPoints) run.sizeHalfPoints = Number(mark.attrs.sizeHalfPoints)
      if (mark.attrs?.font) run.font = String(mark.attrs.font)
      if (mark.attrs?.fontAscii) run.fontAscii = String(mark.attrs.fontAscii)
      if (mark.attrs?.eastAsiaFont) run.eastAsiaFont = String(mark.attrs.eastAsiaFont)
      if (mark.attrs?.csFont) run.csFont = String(mark.attrs.csFont)
      if (mark.attrs?.charSpacingTwips != null)
        run.charSpacingTwips = Number(mark.attrs.charSpacingTwips)
      if (mark.attrs?.charScalePct) run.charScalePct = Number(mark.attrs.charScalePct)
      if (mark.attrs?.kernHalfPoints != null) run.kernHalfPoints = Number(mark.attrs.kernHalfPoints)
      if (mark.attrs?.highlight) run.highlight = String(mark.attrs.highlight)
      if (mark.attrs?.shading) run.shading = String(mark.attrs.shading)
      if (mark.attrs?.textOutline) {
        const outline = parseTextOutlineAttr(String(mark.attrs.textOutline))
        if (outline) run.textOutline = outline
      }
      const effect = parseTextEffectAttr(mark.attrs?.textEffect)
      if (effect) run.textEffect = effect
      if (mark.attrs?.dstrike != null) run.dstrike = Boolean(mark.attrs.dstrike)
      if (mark.attrs?.glow) {
        const glow = parseGlowAttr(String(mark.attrs.glow))
        if (glow) run.glow = glow
      }
      if (mark.attrs?.positionHalfPoints)
        run.positionHalfPoints = Number(mark.attrs.positionHalfPoints)
      if (mark.attrs?.bdr) {
        const bdr = parseRunBorderAttr(String(mark.attrs.bdr))
        if (bdr) run.bdr = bdr
      }
      if (mark.attrs?.vertAlign === 'superscript' || mark.attrs?.vertAlign === 'subscript') {
        run.vertAlign = mark.attrs.vertAlign
      }
      if (mark.attrs?.em) run.em = mark.attrs.em as NonNullable<Run['em']>
      if (mark.attrs?.cs) run.cs = true
      if (mark.attrs?.vanish) run.vanish = true
      if (mark.attrs?.vanishOwn != null) run.vanishOwn = Boolean(mark.attrs.vanishOwn)
      if (mark.attrs?.caps) run.caps = mark.attrs.caps as Run['caps']
      if (mark.attrs?.eaLang) run.eastAsiaLang = String(mark.attrs.eaLang)
      if (mark.attrs?.rtl != null) run.rtl = Boolean(mark.attrs.rtl)
      if (mark.attrs?.styleId) run.styleId = String(mark.attrs.styleId)
      if (mark.attrs?.rawRPr) run.rawRPr = String(mark.attrs.rawRPr)
      if (mark.attrs?.themeRFonts) {
        run.themeRFonts = JSON.parse(String(mark.attrs.themeRFonts)) as Run['themeRFonts']
      }
      if (mark.attrs?.themeColor) run.themeColor = String(mark.attrs.themeColor)
    } else if (mark.type === 'rprChange') {
      run.rPrChange = {
        author: String(mark.attrs?.author ?? ''),
        ...(mark.attrs?.date ? { date: String(mark.attrs.date) } : {}),
        ...(mark.attrs?.id ? { id: String(mark.attrs.id) } : {}),
        ...(mark.attrs?.old ? { old: mark.attrs.old as NonNullable<Run['rPrChange']>['old'] } : {}),
      }
    }
  }
  return run
}

export function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    // reference markers / index entries / inline math / fields are atomic and
    // never merge — two identical FORMCHECKBOX runs must stay two fields
    const atomic =
      run.noteRef ||
      run.xeTerm !== undefined ||
      run.instrField !== undefined ||
      run.sdtCheckboxXml !== undefined ||
      run.math ||
      run.sym ||
      run.ruby ||
      run.image ||
      prev?.noteRef ||
      prev?.xeTerm !== undefined ||
      prev?.instrField !== undefined ||
      prev?.sdtCheckboxXml !== undefined ||
      prev?.math ||
      prev?.sym ||
      prev?.ruby ||
      prev?.image
    if (prev && !atomic && runStyleKey(prev) === runStyleKey(run)) prev.text += run.text
    else merged.push({ ...run })
  }
  return merged
}

/** Font-dialog fields that save from the model (mergeRPrModel rebuilds them when edited) */
export function charFormatKey(run: Run): unknown[] {
  return [
    run.charSpacingTwips ?? null,
    run.charScalePct ?? null,
    run.kernHalfPoints ?? null,
    run.positionHalfPoints ?? null,
    run.caps ?? null,
    run.dstrike ?? null,
    run.vanishOwn ?? null,
  ]
}

export function runStyleKey(run: Run): string {
  return JSON.stringify([
    run.rawRPr ?? null,
    run.styleId ?? null,
    !!run.bold,
    !!run.italic,
    !!run.underline,
    !!run.strike,
    run.color ?? null,
    run.sizeHalfPoints ?? null,
    run.font ?? null,
    run.fontAscii ?? null,
    run.eastAsiaFont ?? null,
    run.highlight ?? null,
    run.shading ?? null,
    ...charFormatKey(run),
    run.textOutline ? JSON.stringify(run.textOutline) : null,
    run.vertAlign ?? null,
    run.link?.href ?? null,
    run.link?.rId ?? null,
    run.commentIds?.join(' ') ?? null,
    revisionKey(run),
    run.noteRef ? [run.noteRef.kind, run.noteRef.id] : null,
    run.xeTerm ?? null,
    run.refField ?? null,
    run.instrField ?? null,
    run.fldBeginXml ?? null,
    run.fldDirty ?? null,
    run.sdtCheckboxXml ?? null,
    run.math?.omml ?? null,
    run.sym ? [run.sym.font, run.sym.char] : null,
    run.ruby?.xml ?? null,
  ])
}

export function revisionKey(run: Run): string | null {
  if (!run.ins && !run.del) return null
  return JSON.stringify([
    run.ins?.author ?? null,
    run.ins?.date ?? null,
    run.ins?.id ?? null,
    run.del?.author ?? null,
    run.del?.date ?? null,
    run.del?.id ?? null,
  ])
}

// ---- signatures: "did the user actually change this block?" ----

export function normalizedFormat(format: ParaFormat | undefined): unknown {
  if (!format) return null
  return [
    format.align ?? null,
    format.lineSpacing ?? null,
    format.lineRule ?? null,
    format.lineRawTwips ?? null,
    format.bidi ?? false,
    format.indentLeft ?? null,
    format.indentRight ?? null,
    format.indentFirstLine ?? null,
    // the DIRECT character-unit indent, like the line above and like
    // nodeFormat, which reads it from the node's own attribute. Taking
    // format.charIndents here would fold the style-inherited value in, and the
    // two signatures would then disagree for every paragraph that inherits
    // its indent — so an untouched document would come back with a frozen
    // direct indent the original never had.
    format.directCharIndents?.firstLine ?? null,
    format.spaceBefore ?? null,
    format.spaceAfter ?? null,
    format.pageBreakBefore ?? false,
    format.keepNext ?? null,
    format.keepLines ?? null,
    format.widowControl ?? null,
    format.suppressLineNumbers ?? null,
    format.contextualSpacing ?? null,
    format.shadingFill ?? null,
    format.borders ?? null,
    format.borderLines ? JSON.stringify(format.borderLines) : null,
    format.tabStops ? JSON.stringify(format.tabStops) : null,
    format.dropCap ? JSON.stringify(format.dropCap) : null,
    format.autoSpace ?? null,
    format.wordWrap ?? null,
    format.overflowPunct ?? null,
    format.emptyRunSizeHalfPoints ?? null,
  ]
}
