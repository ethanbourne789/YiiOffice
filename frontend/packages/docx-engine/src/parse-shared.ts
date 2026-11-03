// Shared parse-module types: the block-building context threaded through the
// parse pipeline (moved out of parse.ts for the parse-rels/numbering/styles split).
import JSZip from 'jszip'

import { EMU_PER_PX, type RelInfo } from './parse-xml-text'
import type {
  DocDefaults,
  NumberingDef,
  SectionSettings,
  StyleInfo,
  ThemeColors,
  ThemeFonts,
} from './types'

export interface BuildContext {
  zip: JSZip
  sourcePath?: string
  styles: Map<string, StyleInfo>
  rels: Map<string, RelInfo>
  numFormats: Map<string, 'bullet' | 'ordered'>
  /** full per-level definitions, for level-aware kind classification */
  numbering: Map<string, NumberingDef>
  /** collector: chart part XML seen while building blocks (partPath -> xml) */
  chartParts: Record<string, string>
  /** "footnote:<id>" / "endnote:<id>" -> display number */
  noteNumbers: Map<string, number>
  /** live palette for w:themeColor resolution (built-in Office palette when the doc has no theme part) */
  themeColors?: ThemeColors | null
  /** theme font scheme for w:asciiTheme/... resolution */
  themeFonts?: ThemeFonts | null
  /** pre-resolved a:blip rId -> data/external URL for pictures inside w:tbl (extractCell is sync, media reads are async) */
  mediaByRid?: Map<string, string>
  /** pre-fetched external textbox parts (wps:txbx r:txbx -> word/txbx*.xml content; extractTextboxes is sync) */
  externalTxbxByRid?: Map<string, string>
  /** comment ids anchored only by a bare w:commentReference (no range markers anywhere in document.xml, LibreOffice style) */
  referenceOnlyComments?: Set<string>
  /** page geometry of the section governing a document.xml byte offset (page/margin-anchored drawings) */
  sectionAt?: (docOffset: number) => SectionSettings
  /** styles.xml w:docDefaults (the Normal font size behind character-unit indents) */
  docDefaults?: DocDefaults
  /** the w:default paragraph style (Normal): its size is the unit of leftChars/rightChars */
  defaultParaStyle?: StyleInfo
  /** byte offset of the first explicit page/section break; content before it
   *  is on the first page (page-pinned cover art placement) */
  firstPageBreakAt?: number
  /** column span (twips) of a w:tblpPr table built just before the current block:
   *  it anchors to that block and shares its horizontal space */
  floatTableAhead?: { leftTwips: number; rightTwips: number }
  /** settings.xml compatibilityMode (0 = legacy layout) */
  compatibilityMode?: number
  /** part root declares xml:space="preserve" (inherited XML scope; PDF converters
   *  rely on it instead of per-w:t attributes) */
  xmlSpacePreserve?: boolean
  /** document-wide v:shapetype templates (a shape may point at one declared in an earlier paragraph) */
  vmlShapeTypes?: ReadonlyMap<string, Record<string, string>>
}

// picture extents keep the authored size to 1/100 px: whole-px rounding lost up to 0.5 px per picture
export const emuToPx = (emu: number): number => Math.round((emu / EMU_PER_PX) * 100) / 100
