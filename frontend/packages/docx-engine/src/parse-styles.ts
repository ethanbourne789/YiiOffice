// styles.xml: paragraph / character / table style resolution into the
// ParsedDoc style tables.
import JSZip from 'jszip'

import {
  attrsOf,
  boolProp,
  findChild,
  findChildren,
  nameOf,
  xmlParser,
  type XNode,
} from './xml-utils'
import { autoColorOf, colorFrom, lineTwipsOf, onOffOf, stripHash } from './parse-xml-text'
import { tagAttr } from './parse-fields'
import type { BuildContext } from './parse-shared'
import {
  EA_LANG_DEFAULT_FONT,
  autoSpaceOf,
  cellMarginsOf,
  charIndentsOf,
  emptyParaSizeHalfPoints,
  indentTwipsOf,
  mergeCharIndents,
  mergedBorderLinesOf,
  paraBorderSidesOf,
  rowBandSizeOf,
  shdDisplayFill,
  tabStopsOf,
  themeLangEaSlotFont,
  themedRFonts,
} from './parse-props'
import { w14TextOutlineOf } from './parse-drawing-geometry'
import type {
  DocDefaults,
  FormulaDisplay,
  ParaFormat,
  Run,
  StyleDisplay,
  StyleInfo,
  TableCondFormat,
  TableStyleDisplay,
  ThemeColors,
  ThemeFonts,
} from './types'

/** Word probe 2026-09-04: a styles part with no w:pPrDefault element at all lays
 *  paragraphs out with Word's built-in Normal spacing (after 8pt, and 1.15 for
 *  paragraphs without their own w:line), for every font and compat mode; an
 *  empty <w:pPrDefault/> or any explicit spacing switches the built-in off. */
const BUILT_IN_PARA_DEFAULTS: Pick<
  DocDefaults,
  'spaceAfterTwips' | 'lineRawTwips' | 'lineRule' | 'lineSpacing'
> = { spaceAfterTwips: 160, lineRawTwips: 276, lineRule: 'auto', lineSpacing: 1.15 }

/** Word probe 2026-09-12 (Word 365): a package with no styles part at all lays its
 *  text out in Word's built-in Normal — Aptos 12pt on top of the spacing above. */
const BUILT_IN_DOC_DEFAULTS: DocDefaults = {
  asciiFont: 'Aptos',
  sizeHalfPoints: 24,
  ...BUILT_IN_PARA_DEFAULTS,
}

/** w:numPr as declared on one style (either child may be absent) */
type OwnNumPr = { numId?: string; ilvl?: number }

/** Word inherits numId and ilvl through basedOn as separate properties: a heading
 *  style may declare only w:ilvl and take the numId from its parent. */
function mergeNumPr(own: OwnNumPr, parent: StyleInfo['numPr']): StyleInfo['numPr'] {
  if (own.numId === undefined && parent === 'none') return 'none'
  const inherited = parent === 'none' ? undefined : parent
  const numId = own.numId ?? inherited?.numId
  if (numId === '0') return 'none'
  if (!numId) return undefined
  return { numId, ilvl: own.ilvl ?? inherited?.ilvl ?? 0 }
}

export async function parseStyles(
  zip: JSZip,
  theme?: ThemeColors | null,
  themeFonts?: ThemeFonts | null,
): Promise<{ styles: Map<string, StyleInfo>; docDefaults?: DocDefaults }> {
  const styles = new Map<string, StyleInfo>()
  const file = zip.file('word/styles.xml')
  if (!file) return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } }
  let parsed: XNode[]
  try {
    parsed = xmlParser.parse(await file.async('string')) as XNode[]
  } catch (err) {
    console.warn('styles.xml unparseable, styles degraded to empty:', err)
    return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } }
  }
  const root = parsed.find((n) => nameOf(n) === 'w:styles')
  if (!root) return { styles, docDefaults: { ...BUILT_IN_DOC_DEFAULTS } }

  let docDefaults: DocDefaults | undefined
  const defaultsNode = findChild(root, 'w:docDefaults')
  if (!defaultsNode) docDefaults = { ...BUILT_IN_PARA_DEFAULTS }
  else {
    const dd: DocDefaults = {}
    const rPr = findChild(findChild(defaultsNode, 'w:rPrDefault') ?? {}, 'w:rPr')
    const sz = rPr ? attrsOf(findChild(rPr, 'w:sz') ?? {})['w:val'] : undefined
    if (sz) dd.sizeHalfPoints = parseInt(sz, 10) || undefined
    const rfAttrs = rPr ? attrsOf(findChild(rPr, 'w:rFonts') ?? {}) : {}
    const ddRf = themedRFonts(rfAttrs, themeFonts)
    if (ddRf.ascii ?? ddRf.hAnsi) dd.asciiFont = ddRf.ascii ?? ddRf.hAnsi
    // no Latin slot at all and no theme to take it from (docx-npm output):
    // Word falls back to its legacy Times New Roman, not the Office theme body face
    else if (!themeFonts?.minor && !rfAttrs['w:asciiTheme'] && !rfAttrs['w:hAnsiTheme']) {
      dd.asciiFont = 'Times New Roman'
      if (!sz) dd.sizeHalfPoints = 20
    }
    // docDefaults keeps the lang-based backfill below for the empty-slot case
    if (ddRf.eastAsia && !ddRf.eaSlotEmpty) dd.eastAsiaFont = ddRf.eastAsia
    if (ddRf.cs) dd.csFont = ddRf.cs
    // Empty EA slot + w:lang w:eastAsia backfill: when the backfill would fire,
    // a face settings.xml themeFontLang resolves (script table / probed locale
    // defaults) outranks the often-stale docDefaults w:lang. Without a firing
    // backfill the slot stays empty — themeFontLang alone must not invent a
    // doc-level EA face (it would reroute PUA/CJK fallback in Latin documents).
    const eaLang = rPr ? attrsOf(findChild(rPr, 'w:lang') ?? {})['w:eastAsia'] : undefined
    if (eaLang) dd.eastAsiaLang = eaLang
    if (!dd.eastAsiaFont && eaLang) {
      const eaDefault = EA_LANG_DEFAULT_FONT[eaLang.toLowerCase()]
      if (eaDefault) {
        const ddEaTheme =
          ddRf.eaSlotEmpty && themeFonts
            ? themeLangEaSlotFont(
                themeFonts,
                rPr ? attrsOf(findChild(rPr, 'w:rFonts') ?? {})['w:eastAsiaTheme'] : undefined,
              )
            : undefined
        dd.eastAsiaFont = ddEaTheme ?? eaDefault
        dd.eaFromLang = true
        if (ddRf.eaSlotEmpty) dd.eaSlotEmpty = true
      }
    }
    if (rPr) {
      if (onOffOf(rPr, 'w:b')) dd.bold = true
      if (onOffOf(rPr, 'w:i')) dd.italic = true
      const color = colorFrom(rPr, theme)
      if (color) dd.color = color
      const kern = attrsOf(findChild(rPr, 'w:kern') ?? {})['w:val']
      if (kern !== undefined) dd.kernHalfPoints = parseInt(kern, 10) || 0
      const lang = attrsOf(findChild(rPr, 'w:lang') ?? {})['w:val']
      if (lang) dd.lang = lang
    }
    const pPrDefault = findChild(defaultsNode, 'w:pPrDefault')
    if (!pPrDefault) Object.assign(dd, BUILT_IN_PARA_DEFAULTS)
    const pPr = findChild(pPrDefault ?? {}, 'w:pPr')
    const spacingAttrs = pPr ? attrsOf(findChild(pPr, 'w:spacing') ?? {}) : {}
    if (spacingAttrs['w:line']) {
      const line = lineTwipsOf(spacingAttrs['w:line'])
      const rule = (spacingAttrs['w:lineRule'] ?? 'auto') as 'auto' | 'atLeast' | 'exact'
      if (line > 0) {
        dd.lineRawTwips = line
        dd.lineRule = rule
        if (rule === 'auto') dd.lineSpacing = line / 240
      }
    }
    if (spacingAttrs['w:before'] !== undefined) {
      dd.spaceBeforeTwips = parseInt(spacingAttrs['w:before'], 10) || 0
    }
    if (spacingAttrs['w:after'] !== undefined) {
      dd.spaceAfterTwips = parseInt(spacingAttrs['w:after'], 10) || 0
    }
    if (spacingAttrs['w:beforeAutospacing'] !== undefined)
      dd.spaceBeforeAuto =
        spacingAttrs['w:beforeAutospacing'] === '1' ||
        spacingAttrs['w:beforeAutospacing'] === 'true'
    if (spacingAttrs['w:afterAutospacing'] !== undefined)
      dd.spaceAfterAuto =
        spacingAttrs['w:afterAutospacing'] === '1' || spacingAttrs['w:afterAutospacing'] === 'true'
    if (pPr && onOffOf(pPr, 'w:suppressAutoHyphens')) dd.suppressAutoHyphens = true
    if (pPr && onOffOf(pPr, 'w:widowControl') === false) dd.widowControl = false
    const ddBorders = pPr ? paraBorderSidesOf(pPr, theme) : undefined
    if (ddBorders) dd.borderSides = ddBorders
    if (Object.keys(dd).length > 0) docDefaults = dd
  }

  const basedOnIds = new Map<string, string>()
  const ownNumPrs = new Map<string, OwnNumPr>()
  const linkedIds = new Map<string, string>()
  // styles with an explicit w:outlineLvl 9 (body text, e.g. TOCHeading basedOn Heading1)
  const outlineOffIds = new Set<string>()
  for (const styleNode of findChildren(root, 'w:style')) {
    const attrs = attrsOf(styleNode)
    const type = attrs['w:type']
    if (type !== 'paragraph' && type !== 'character' && type !== 'table') continue
    const styleId = attrs['w:styleId']
    if (!styleId) continue
    const name = attrsOf(findChild(styleNode, 'w:name') ?? {})['w:val'] ?? styleId
    let headingLevel: number | undefined
    if (type === 'paragraph') {
      const nameMatch = /^heading\s*([1-9])$/i.exec(name) ?? /^Heading([1-9])$/.exec(styleId)
      if (nameMatch) headingLevel = parseInt(nameMatch[1], 10)
      else {
        const pPr = findChild(styleNode, 'w:pPr')
        const outline = pPr ? attrsOf(findChild(pPr, 'w:outlineLvl') ?? {})['w:val'] : undefined
        if (outline !== undefined) {
          const lvl = parseInt(outline, 10)
          if (lvl >= 0 && lvl <= 8) headingLevel = lvl + 1
          else outlineOffIds.add(styleId)
        }
      }
    }
    const basedOn = attrsOf(findChild(styleNode, 'w:basedOn') ?? {})['w:val']
    if (basedOn) basedOnIds.set(styleId, basedOn)
    const link = attrsOf(findChild(styleNode, 'w:link') ?? {})['w:val']
    if (link) linkedIds.set(styleId, link)
    const uiPriorityRaw = attrsOf(findChild(styleNode, 'w:uiPriority') ?? {})['w:val']
    const uiPriority =
      uiPriorityRaw !== undefined && /^\d+$/.test(uiPriorityRaw)
        ? parseInt(uiPriorityRaw, 10)
        : undefined
    let numPr: StyleInfo['numPr']
    if (type === 'paragraph') {
      const styleNumPr = findChild(findChild(styleNode, 'w:pPr') ?? {}, 'w:numPr')
      if (styleNumPr) {
        const numId = attrsOf(findChild(styleNumPr, 'w:numId') ?? {})['w:val']
        const ilvlRaw = attrsOf(findChild(styleNumPr, 'w:ilvl') ?? {})['w:val']
        const own: OwnNumPr = {}
        if (numId !== undefined) own.numId = numId
        if (ilvlRaw !== undefined) own.ilvl = parseInt(ilvlRaw, 10) || 0
        ownNumPrs.set(styleId, own)
        numPr = mergeNumPr(own, undefined)
      }
    }
    styles.set(styleId, {
      styleId,
      name,
      type,
      headingLevel,
      headingOutlineOff: outlineOffIds.has(styleId) ? true : undefined,
      basedOn,
      semiHidden: onOffOf(styleNode, 'w:semiHidden'),
      qFormat: onOffOf(styleNode, 'w:qFormat'),
      uiPriority,
      unhideWhenUsed: onOffOf(styleNode, 'w:unhideWhenUsed'),
      custom:
        attrs['w:customStyle'] === '1' || attrs['w:customStyle'] === 'true' ? true : undefined,
      display: type === 'table' ? undefined : styleDisplayOf(styleNode, theme, themeFonts),
      tableDisplay:
        type === 'table' ? tableStyleDisplayOf(styleNode, theme, themeFonts) : undefined,
      numPr,
      isDefault: attrs['w:default'] === '1' || attrs['w:default'] === 'true' ? true : undefined,
    })
  }

  // Word's effective default per style type: the last w:default="1" wins. When a
  // type declares none, Word does NOT use ECMA-376's first-of-type rule — it falls
  // back to a style id/named "Normal", else to built-in defaults (docDefaults only).
  {
    const declared = new Map<string, StyleInfo>()
    const normalOfType = new Map<string, StyleInfo>()
    for (const info of styles.values()) {
      if (info.isDefault) declared.set(info.type, info)
      if (
        !normalOfType.has(info.type) &&
        (info.styleId.toLowerCase() === 'normal' || info.name.toLowerCase() === 'normal')
      ) {
        normalOfType.set(info.type, info)
      }
      info.isDefault = undefined
    }
    for (const type of new Set([...declared.keys(), ...normalOfType.keys()])) {
      const pick = declared.get(type) ?? normalOfType.get(type)
      if (pick) pick.isDefault = true
    }
  }

  // resolve basedOn chains: a style inherits every display prop it doesn't set itself
  const resolved = new Set<string>()
  const resolve = (styleId: string, seen: Set<string>): StyleInfo | undefined => {
    const info = styles.get(styleId)
    if (!info) return undefined
    const parentId = basedOnIds.get(styleId)
    if (resolved.has(styleId) || !parentId || seen.has(styleId)) return info
    seen.add(styleId)
    const parent = resolve(parentId, seen)
    resolved.add(styleId)
    if (parent?.display) {
      const own = info.display
      info.display = { ...parent.display, ...(own ?? {}) }
      // w:ind character attributes layer per component: a child's twips-only
      // w:ind keeps the parent's *Chars, a child's explicit zero cancels it
      if (parent.display.indentChars && own?.indentChars) {
        info.display.indentChars = mergeCharIndents(parent.display.indentChars, own.indentChars)
      }
      // pBdr merges per side too: a child's explicit none cancels one parent side only
      if (parent.display.borderSides && own?.borderSides) {
        info.display.borderSides = { ...parent.display.borderSides, ...own.borderSides }
      }
      // w:tabs merge per position: a child stop (or w:val="clear") replaces the
      // parent's stop at that position, the rest of the parent's stops stay
      if (parent.display.tabStops && own?.tabStops) {
        const merged = [
          ...parent.display.tabStops.filter((p) => !own.tabStops!.some((o) => o.pos === p.pos)),
          ...own.tabStops.filter((o) => o.val !== 'clear'),
        ].sort((a, b) => a.pos - b.pos)
        if (merged.length > 0) info.display.tabStops = merged
        else delete info.display.tabStops
      }
      if (Object.keys(info.display).length === 0) info.display = undefined
    }
    if (parent?.tableDisplay) {
      info.tableDisplay = mergeTableDisplay(parent.tableDisplay, info.tableDisplay)
    }
    if (
      info.type === 'paragraph' &&
      info.headingLevel === undefined &&
      !info.headingOutlineOff &&
      parent?.headingLevel
    ) {
      info.headingLevel = parent.headingLevel
      info.headingLevelInherited = true
    }
    if (info.type === 'paragraph' && (ownNumPrs.has(styleId) || parent?.numPr)) {
      info.numPr = mergeNumPr(ownNumPrs.get(styleId) ?? {}, parent?.numPr)
    }
    return info
  }
  for (const styleId of styles.keys()) resolve(styleId, new Set())
  if (docDefaults?.borderSides) {
    for (const info of styles.values()) {
      if (info.type !== 'paragraph') continue
      info.display = {
        ...info.display,
        borderSides: { ...docDefaults.borderSides, ...info.display?.borderSides },
      }
    }
  }

  // linkedStyle (w:link): a paragraph style and a character style form one unit (Word
  // "linked styles"). Fill in run-level display properties in both directions (never
  // overriding a style's own) — the common gap is a character-style shell with no rPr,
  // where all run properties live on the linked paragraph style.
  const RUN_KEYS = [
    'sizeHalfPoints',
    'color',
    'bold',
    'italic',
    'boldCs',
    'italicCs',
    'sizeCsHalfPoints',
    'rtl',
    'underline',
    'strike',
    'font',
    'fontAscii',
    'eastAsiaFont',
    'csFont',
    'caps',
    'bdr',
    'shading',
    'textOutline',
  ] as const
  for (const [fromId, toId] of linkedIds) {
    const a = styles.get(fromId)
    const b = styles.get(toId)
    if (!a || !b) continue
    // Word pairs linked styles both ways; a stray one-way w:link (a caption style
    // pointing at another paragraph style's character twin) contributes nothing
    const back = linkedIds.get(toId)
    if (back !== undefined && back !== fromId) continue
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (self.type !== 'character' && self.type !== 'paragraph') continue
      const fill: Partial<StyleDisplay> = {}
      for (const key of RUN_KEYS) {
        if (self.display?.[key] === undefined && other.display?.[key] !== undefined) {
          ;(fill as Record<string, unknown>)[key] = other.display[key]
        }
      }
      if (Object.keys(fill).length > 0) self.display = { ...fill, ...(self.display ?? {}) }
    }
    if (a.type === 'character' && b.type === 'paragraph') a.linkedCharShell = true
    if (b.type === 'character' && a.type === 'paragraph') b.linkedCharShell = true
  }

  return { styles, docDefaults }
}

function mergeTableDisplay(
  parent: TableStyleDisplay,
  child: TableStyleDisplay | undefined,
): TableStyleDisplay | undefined {
  const merged: TableStyleDisplay = { ...parent, ...(child ?? {}) }
  const DEEP = ['wholeTable', 'firstRow', 'firstCol', 'lastCol', 'lastRow', 'paraSpacing'] as const
  for (const key of DEEP) {
    if (parent[key] || child?.[key]) {
      merged[key] = { ...(parent[key] ?? {}), ...(child?.[key] ?? {}) } as never
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** fills / first-row formatting a table style contributes on screen */
function tableStyleDisplayOf(
  styleNode: XNode,
  theme?: ThemeColors | null,
  themeFonts?: ThemeFonts | null,
): TableStyleDisplay | undefined {
  const display: TableStyleDisplay = {}
  const shdFill = (node: XNode | undefined): string | undefined => {
    const fill = node ? attrsOf(findChild(node, 'w:shd') ?? {})['w:fill'] : undefined
    return fill && fill !== 'auto' ? stripHash(fill) : undefined
  }
  const baseFill = shdFill(findChild(styleNode, 'w:tcPr'))
  if (baseFill) display.fill = baseFill
  const szHalfOf = (rPr: XNode | undefined): number | undefined => {
    const val = parseInt(attrsOf(findChild(rPr ?? {}, 'w:sz') ?? {})['w:val'] ?? '', 10)
    return val > 0 ? val : undefined
  }
  const styleRPr = findChild(styleNode, 'w:rPr')
  if (styleRPr) {
    const wholeTable: NonNullable<TableStyleDisplay['wholeTable']> = {}
    const color = colorFrom(styleRPr, theme)
    if (color) wholeTable.color = color
    if (boolProp(styleRPr, 'w:b')) wholeTable.bold = true
    if (boolProp(styleRPr, 'w:i')) wholeTable.italic = true
    const sz = szHalfOf(styleRPr)
    if (sz) wholeTable.sizeHalfPoints = sz
    const kern = attrsOf(findChild(styleRPr, 'w:kern') ?? {})['w:val']
    if (kern !== undefined) wholeTable.kernHalfPoints = parseInt(kern, 10) || 0
    if (Object.keys(wholeTable).length > 0) display.wholeTable = wholeTable
  }
  for (const cond of findChildren(styleNode, 'w:tblStylePr')) {
    const type = attrsOf(cond)['w:type']
    const tcPr = findChild(cond, 'w:tcPr')
    const fill = shdFill(tcPr)
    if (type === 'firstRow' || type === 'firstCol' || type === 'lastCol' || type === 'lastRow') {
      const rPr = findChild(cond, 'w:rPr')
      const fmt: TableCondFormat = {}
      if (fill) fmt.fill = fill
      if (rPr && boolProp(rPr, 'w:b')) fmt.bold = true
      if (rPr && boolProp(rPr, 'w:i')) fmt.italic = true
      const color = colorFrom(rPr, theme)
      if (color) fmt.color = color
      const sz = szHalfOf(rPr)
      if (sz) fmt.sizeHalfPoints = sz
      if (rPr) {
        const capsOn = onOffOf(rPr, 'w:caps')
        const smallCapsOn = onOffOf(rPr, 'w:smallCaps')
        if (capsOn) fmt.caps = 'all'
        else if (smallCapsOn) fmt.caps = 'small'
        else if (capsOn === false || smallCapsOn === false) fmt.caps = 'none'
        const rf = themedRFonts(attrsOf(findChild(rPr, 'w:rFonts') ?? {}), themeFonts)
        const fontAscii = rf.ascii ?? rf.hAnsi
        if (fontAscii) fmt.fontAscii = fontAscii
        const spc = parseInt(attrsOf(findChild(rPr, 'w:spacing') ?? {})['w:val'] ?? '', 10)
        if (!Number.isNaN(spc)) fmt.charSpacingTwips = spc
      }
      if (Object.keys(fmt).length > 0) display[type] = fmt
    } else if (type === 'band1Horz' && fill) {
      display.band1Fill = fill
    } else if (type === 'band2Horz' && fill) {
      display.band2Fill = fill
    }
  }
  const styleTblPr = findChild(styleNode, 'w:tblPr')
  const bandSize = rowBandSizeOf(styleTblPr)
  if (bandSize) display.rowBandSize = bandSize
  const borders = mergedBorderLinesOf(styleTblPr, 'w:tblBorders', true)
  if (borders) display.borders = borders
  const cellMar = cellMarginsOf(findChild(styleTblPr ?? {}, 'w:tblCellMar'))
  if (cellMar) display.cellMarTwips = cellMar
  const stylePPr = findChild(styleNode, 'w:pPr')
  const jc = attrsOf(findChild(stylePPr ?? {}, 'w:jc') ?? {})['w:val']
  if (jc) display.paraJc = jc
  const stylePPrSpacing = findChild(stylePPr ?? {}, 'w:spacing')
  if (stylePPrSpacing) {
    const a = attrsOf(stylePPrSpacing)
    const ps: NonNullable<TableStyleDisplay['paraSpacing']> = {}
    const before = parseInt(a['w:before'] ?? '', 10)
    if (before >= 0 && a['w:before'] !== undefined) ps.beforeTwips = before
    const after = parseInt(a['w:after'] ?? '', 10)
    if (after >= 0 && a['w:after'] !== undefined) ps.afterTwips = after
    const line = lineTwipsOf(a['w:line'])
    if (line > 0) {
      ps.lineRawTwips = line
      const rule = (a['w:lineRule'] ?? 'auto') as 'auto' | 'atLeast' | 'exact'
      ps.lineRule = rule
      if (rule === 'auto') ps.lineSpacing = Math.round((line / 240) * 100) / 100
    }
    if (Object.keys(ps).length > 0) display.paraSpacing = ps
  }
  return Object.keys(display).length > 0 ? display : undefined
}

/**
 * Style-chain run props under Word's rtl selection (probed, Word for Mac 2026-08):
 * rtl runs read only the Cs twins (w:bCs/w:iCs/w:szCs), non-rtl runs read only the
 * base props — no cross-fallback. Pass the run's cs flag; callers without run
 * context (style gallery previews, caret defaults) pass false (= non-rtl).
 */
export function styleRunFormat(
  display: StyleDisplay | undefined,
  cs: boolean,
): Pick<StyleDisplay, 'bold' | 'italic' | 'sizeHalfPoints'> {
  if (!display) return {}
  return cs
    ? { bold: display.boldCs, italic: display.italicCs, sizeHalfPoints: display.sizeCsHalfPoints }
    : { bold: display.bold, italic: display.italic, sizeHalfPoints: display.sizeHalfPoints }
}

/** w:bdr -> Run.bdr; undefined for none/nil */
export function runBorderOf(bdrNode: XNode): Run['bdr'] {
  const bdr = attrsOf(bdrNode)
  if (!bdr['w:val'] || bdr['w:val'] === 'none' || bdr['w:val'] === 'nil') return undefined
  return {
    val: bdr['w:val'],
    sz: parseInt(bdr['w:sz'] ?? '', 10) || 4,
    ...(bdr['w:color'] && bdr['w:color'] !== 'auto' ? { color: stripHash(bdr['w:color']) } : {}),
    ...(parseInt(bdr['w:space'] ?? '', 10) > 0 ? { space: parseInt(bdr['w:space'], 10) } : {}),
  }
}

/** display-only formatting the style contributes on screen (Word renders these from styles.xml) */
function styleDisplayOf(
  styleNode: XNode,
  theme?: ThemeColors | null,
  themeFonts?: ThemeFonts | null,
): StyleDisplay | undefined {
  const display: StyleDisplay = {}
  const rPr = findChild(styleNode, 'w:rPr')
  if (rPr) {
    const sz = attrsOf(findChild(rPr, 'w:sz') ?? {})['w:val']
    if (sz) display.sizeHalfPoints = parseInt(sz, 10) || undefined
    const color = colorFrom(rPr, theme) ?? autoColorOf(rPr)
    if (color) display.color = color
    const bold = onOffOf(rPr, 'w:b')
    if (bold !== undefined) display.bold = bold
    const italic = onOffOf(rPr, 'w:i')
    if (italic !== undefined) display.italic = italic
    // Cs twins carried separately: the consuming run picks the set by its rtl flag
    // (styleRunFormat); consumers without run context read the base props (= non-rtl)
    const boldCs = onOffOf(rPr, 'w:bCs')
    if (boldCs !== undefined) display.boldCs = boldCs
    const italicCs = onOffOf(rPr, 'w:iCs')
    if (italicCs !== undefined) display.italicCs = italicCs
    const szCs = attrsOf(findChild(rPr, 'w:szCs') ?? {})['w:val']
    if (szCs) display.sizeCsHalfPoints = parseInt(szCs, 10) || undefined
    const rtl = onOffOf(rPr, 'w:rtl')
    if (rtl !== undefined) display.rtl = rtl
    const u = attrsOf(findChild(rPr, 'w:u') ?? {})['w:val']
    if (u) display.underline = u !== 'none'
    const strike = onOffOf(rPr, 'w:strike')
    if (strike !== undefined) display.strike = strike
    const bdrNode = findChild(rPr, 'w:bdr')
    const bdr = bdrNode ? runBorderOf(bdrNode) : undefined
    if (bdr) display.bdr = bdr
    const rf = themedRFonts(attrsOf(findChild(rPr, 'w:rFonts') ?? {}), themeFonts)
    const font = rf.eastAsia ?? rf.ascii ?? rf.hAnsi
    const fontAscii = rf.ascii ?? rf.hAnsi
    if (fontAscii) display.fontAscii = fontAscii
    if (rf.eastAsia && !rf.eaSlotEmpty) display.eastAsiaFont = rf.eastAsia
    if (rf.cs) display.csFont = rf.cs
    if (font) display.font = font
    if (rf.eaSlotEmpty && font && font === rf.eastAsia) display.eaSlotEmpty = true
    const spc = parseInt(attrsOf(findChild(rPr, 'w:spacing') ?? {})['w:val'] ?? '', 10)
    if (!Number.isNaN(spc)) display.charSpacingTwips = spc
    const kern = attrsOf(findChild(rPr, 'w:kern') ?? {})['w:val']
    if (kern !== undefined) display.kernHalfPoints = parseInt(kern, 10) || 0
    const eaLang = attrsOf(findChild(rPr, 'w:lang') ?? {})['w:eastAsia']
    if (eaLang) display.eastAsiaLang = eaLang
    const capsOn = onOffOf(rPr, 'w:caps')
    const smallCapsOn = onOffOf(rPr, 'w:smallCaps')
    if (capsOn) display.caps = 'all'
    else if (smallCapsOn) display.caps = 'small'
    else if (capsOn === false || smallCapsOn === false) display.caps = 'none'
    const shading = shdDisplayFill(findChild(rPr, 'w:shd'), theme)
    if (shading) display.shading = shading
    const outline = w14TextOutlineOf(rPr, theme)
    if (outline) display.textOutline = outline
    // w:specVanish marks a style separator, not hidden text
    const vanish = onOffOf(rPr, 'w:vanish')
    if (vanish !== undefined && onOffOf(rPr, 'w:specVanish') !== true) display.vanish = vanish
  }
  const pPr = findChild(styleNode, 'w:pPr')
  if (pPr) {
    const spacing = attrsOf(findChild(pPr, 'w:spacing') ?? {})
    const line = lineTwipsOf(spacing['w:line'])
    if (line > 0) {
      const rule = (spacing['w:lineRule'] ?? 'auto') as 'auto' | 'atLeast' | 'exact'
      display.lineRule = rule
      display.lineRawTwips = line
      if (rule === 'auto') {
        display.lineSpacing = line / 240
      }
    }
    if (spacing['w:before'] !== undefined) {
      display.spaceBeforeTwips = parseInt(spacing['w:before'], 10) || 0
    }
    if (spacing['w:after'] !== undefined) {
      display.spaceAfterTwips = parseInt(spacing['w:after'], 10) || 0
    }
    // tri-state so a child style's explicit "0" overrides the basedOn chain's auto
    if (spacing['w:beforeAutospacing'] !== undefined)
      display.spaceBeforeAuto =
        spacing['w:beforeAutospacing'] === '1' || spacing['w:beforeAutospacing'] === 'true'
    if (spacing['w:afterAutospacing'] !== undefined)
      display.spaceAfterAuto =
        spacing['w:afterAutospacing'] === '1' || spacing['w:afterAutospacing'] === 'true'
    if (boolProp(pPr, 'w:keepNext')) display.keepNext = true
    if (boolProp(pPr, 'w:keepLines')) display.keepLines = true
    {
      const sln = onOffOf(pPr, 'w:suppressLineNumbers')
      if (sln !== undefined) display.suppressLineNumbers = sln
    }
    {
      const pbb = onOffOf(pPr, 'w:pageBreakBefore')
      if (pbb !== undefined) display.pageBreakBefore = pbb
    }
    {
      const wc = onOffOf(pPr, 'w:widowControl')
      if (wc !== undefined) display.widowControl = wc
    }
    {
      const sah = onOffOf(pPr, 'w:suppressAutoHyphens')
      if (sah !== undefined) display.suppressAutoHyphens = sah
    }
    {
      // tri-state so a child style's explicit off survives the basedOn merge
      const ctx = onOffOf(pPr, 'w:contextualSpacing')
      if (ctx !== undefined) display.contextualSpacing = ctx
    }
    const autoSpace = autoSpaceOf(pPr)
    if (autoSpace !== undefined) display.autoSpace = autoSpace
    const wordWrap = onOffOf(pPr, 'w:wordWrap')
    if (wordWrap !== undefined) display.wordWrap = wordWrap
    const overflowPunct = onOffOf(pPr, 'w:overflowPunct')
    if (overflowPunct !== undefined) display.overflowPunct = overflowPunct
    const jc = attrsOf(findChild(pPr, 'w:jc') ?? {})['w:val']
    if (jc === 'center' || jc === 'right' || jc === 'left' || jc === 'justify') display.align = jc
    else if (jc === 'both' || /kashida$|^thaiDistribute$/i.test(jc ?? '')) display.align = 'justify'
    else if (jc === 'distribute') display.align = 'distribute'
    const bidi = onOffOf(pPr, 'w:bidi')
    if (bidi !== undefined) display.bidi = bidi
    const shd = findChild(pPr, 'w:shd')
    const shdDisp = shdDisplayFill(shd, theme)
    if (shdDisp) display.shadingFill = shdDisp
    else if (shd) display.shadingFill = 'auto'
    const borderSides = paraBorderSidesOf(pPr, theme)
    if (borderSides) display.borderSides = borderSides
    const stops = tabStopsOf(pPr)
    if (stops) display.tabStops = stops
    const ind = findChild(pPr, 'w:ind')
    if (ind) {
      const { left, right, firstLine } = indentTwipsOf(ind)
      if (left !== undefined) display.indentLeftTwips = left
      if (right !== undefined) display.indentRightTwips = right
      if (firstLine !== undefined) display.indentFirstLineTwips = firstLine
      // character-unit indents depend on each paragraph's text; kept raw (explicit
      // zeros included, they cancel an inherited value) for the parser
      const chars = charIndentsOf(ind)
      if (chars) display.indentChars = chars
    }
  }
  return Object.keys(display).length > 0 ? display : undefined
}

/**
 * Effective heading level 1-9 (Word TOC/outline semantics): direct pPr
 * w:outlineLvl wins (9 = body text), then the style's level, then a built-in
 * HeadingN styleId the document never defined.
 */
export function headingLevelOf(
  pPr: XNode | undefined,
  styleId: string | undefined,
  ctx: BuildContext,
): number | undefined {
  const direct = pPr ? attrsOf(findChild(pPr, 'w:outlineLvl') ?? {})['w:val'] : undefined
  if (direct !== undefined) {
    const lvl = parseInt(direct, 10)
    return lvl >= 0 && lvl <= 8 ? lvl + 1 : undefined
  }
  if (!styleId) return undefined
  const info = ctx.styles.get(styleId)
  if (info) return info.headingLevel
  const m = /^Heading([1-9])$/i.exec(styleId)
  return m ? parseInt(m[1], 10) : undefined
}

/** heading level owed to a direct w:outlineLvl alone (the style contributes none) */
export function outlineOnlyHeading(
  pPr: XNode | undefined,
  styleId: string | undefined,
  ctx: BuildContext,
): boolean {
  if (!pPr || !findChild(pPr, 'w:outlineLvl')) return false
  return headingLevelOf(undefined, styleId, ctx) === undefined
}

const defaultParaVanishCache = new WeakMap<Map<string, StyleInfo>, boolean>()

/** Default paragraph style's w:vanish (cached per styles map): inherited by style-less paragraphs */
/** w:cs face of a run without its own: character style, paragraph style (or the
 * default one), then docDefaults — an empty theme cs slot there already resolved
 * to the script-table face (Word: Arabic under minorBidi "" + bidi ar-SA = Arial) */
export function inheritedCsFont(
  rStyleId: string | undefined,
  pStyleId: string | undefined,
  ctx: BuildContext,
): string | undefined {
  const styles = ctx.styles
  const para = pStyleId ? styles?.get(pStyleId) : defaultParaStyle(styles)
  return (
    (rStyleId ? styles?.get(rStyleId)?.display?.csFont : undefined) ??
    para?.display?.csFont ??
    ctx.docDefaults?.csFont
  )
}

const defaultParaStyleCache = new WeakMap<Map<string, StyleInfo>, StyleInfo | null>()
function defaultParaStyle(styles?: Map<string, StyleInfo>): StyleInfo | undefined {
  if (!styles) return undefined
  let s = defaultParaStyleCache.get(styles)
  if (s === undefined) {
    s = [...styles.values()].find((i) => i.isDefault && i.type === 'paragraph') ?? null
    defaultParaStyleCache.set(styles, s)
  }
  return s ?? undefined
}

export function defaultParaVanish(styles?: Map<string, StyleInfo>): boolean | undefined {
  if (!styles) return undefined
  let v = defaultParaVanishCache.get(styles)
  if (v === undefined) {
    v = false
    for (const info of styles.values()) {
      if (info.isDefault && info.type === 'paragraph') {
        v = info.display?.vanish === true
        break
      }
    }
    defaultParaVanishCache.set(styles, v)
  }
  return v || undefined
}

/** parse a w:p as editable text content (paragraph / heading / listItem) */
/** Word's built-in text size when neither docDefaults nor the default style sets one */
const WORD_DEFAULT_SIZE_HALF_POINTS = 20

/**
 * Twips per "character" for a paragraph's character-unit indents (Word for Mac
 * probe, 2026-09-02). The special indents follow the first text run — its w:sz
 * plus its w:spacing letter spacing; an empty run does not count and the
 * paragraph mark never does (a run-less paragraph falls back to its mark, then
 * its style). Left/right follow the default paragraph style's size, whatever
 * the paragraph's own style or runs say. Under a linesAndChars document grid
 * every character advances by charSpace/4096 pt more, and so do both units
 * (snapToGrid off included).
 */
export function normalSizeHalfPoints(ctx: BuildContext): number {
  return (
    ctx.defaultParaStyle?.display?.sizeHalfPoints ??
    ctx.docDefaults?.sizeHalfPoints ??
    WORD_DEFAULT_SIZE_HALF_POINTS
  )
}

/** an oMathPara follows its m:jc (Word default centerGroup, emitted explicitly so the
 *  paragraph style's alignment cannot win); a bare math-only paragraph is inline maths
 *  in Word and follows the paragraph's own w:jc (default left) */
export function mathParaAlign(paragraphXml: string, pPr: string): FormulaDisplay['align'] {
  if (paragraphXml.includes('<m:oMathPara')) {
    const jc = tagAttr(paragraphXml, 'm:jc', 'm:val')
    return jc === 'left' || jc === 'right' || jc === 'center' ? jc : 'centerGroup'
  }
  const jc = tagAttr(pPr, 'w:jc', 'w:val')
  return jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left'
}

/** display maths size: first w:sz inside the OMML (m:r or m:ctrlPr), else the paragraph
 *  mark, else the paragraph style, else Normal */
export function mathSizeHalfPoints(
  omml: string,
  pPr: string,
  styleId: string | undefined,
  ctx: BuildContext,
): number {
  const explicit = parseInt(
    tagAttr(omml, 'w:sz', 'w:val') ?? tagAttr(pPr, 'w:sz', 'w:val') ?? '',
    10,
  )
  if (Number.isFinite(explicit)) return Math.max(1, explicit)
  return (
    (styleId ? ctx.styles.get(styleId)?.display?.sizeHalfPoints : undefined) ??
    normalSizeHalfPoints(ctx)
  )
}

/** size of the paragraph's first text run: explicit w:sz, else its character style, else
 *  the paragraph mark of an empty paragraph, else the paragraph style, else Normal */
export function paraTextSizeHalfPoints(
  ctx: BuildContext,
  runs: Run[],
  pNode: XNode,
  pPr: XNode | undefined,
  styleId: string | undefined,
): number {
  const styleSize = styleId
    ? ctx.styles.get(styleId)?.display?.sizeHalfPoints
    : ctx.defaultParaStyle?.display?.sizeHalfPoints
  const first = runs.find((r) => r.text !== '')
  return (
    first?.sizeHalfPoints ??
    (first?.styleId ? ctx.styles.get(first.styleId)?.display?.sizeHalfPoints : undefined) ??
    (first ? undefined : emptyParaSizeHalfPoints(pNode, pPr)) ??
    styleSize ??
    normalSizeHalfPoints(ctx)
  )
}

/** style-chain autoSpace/wordWrap off reach the paragraph (the default style
 *  covers pStyle-less ones): the renderer reads both per paragraph */
export function inheritStyleBreakFlags(
  format: ParaFormat | undefined,
  style: StyleInfo | undefined,
): ParaFormat | undefined {
  const d = style?.display
  let out = format
  if (out?.autoSpace === undefined && d?.autoSpace === false) out = { ...out, autoSpace: false }
  if (out?.wordWrap === undefined && d?.wordWrap === false) out = { ...out, wordWrap: false }
  if (out?.overflowPunct === undefined && d?.overflowPunct === false) {
    out = { ...out, overflowPunct: false }
  }
  if (out?.eastAsiaLang === undefined && d?.eastAsiaLang) {
    out = { ...out, eastAsiaLang: d.eastAsiaLang }
  }
  return out
}

/** style-chain w:tabs reach the paragraph as display-only stops; a direct stop
 *  (or w:val="clear") at the same position replaces the inherited one */
export function inheritStyleTabStops(
  format: ParaFormat | undefined,
  style: StyleInfo | undefined,
): ParaFormat | undefined {
  const styleStops = style?.display?.tabStops
  if (!styleStops?.length) return format
  const direct = format?.tabStops ?? []
  const inherited = styleStops
    .filter((s) => s.val !== 'clear' && !direct.some((d) => d.pos === s.pos))
    .map((s) => ({ ...s, inherited: true as const }))
  if (inherited.length === 0) return format
  return { ...(format ?? {}), tabStops: [...direct, ...inherited].sort((a, b) => a.pos - b.pos) }
}
