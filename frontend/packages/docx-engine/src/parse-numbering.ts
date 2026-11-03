// numbering domain: a paragraph's list reference and the bullet/ordered
// classification of one list level (moved out of parse.ts).
import { attrsOf, findChild, type XNode } from './xml-utils'
import type { BuildContext } from './parse-shared'

/** numbering reference of a paragraph: direct w:numPr, falling back to the pStyle's
 * numPr (ListBullet/ListNumber style-driven lists carry no numPr on the paragraph).
 * numId="0" is Word's explicit "no numbering" and yields undefined. */
export function listRefOf(
  ctx: BuildContext,
  pPr: XNode | undefined,
  styleId: string | undefined,
): { numId: string; ilvl: number } | undefined {
  const numPr = pPr ? findChild(pPr, 'w:numPr') : undefined
  const directNumId = numPr ? attrsOf(findChild(numPr, 'w:numId') ?? {})['w:val'] : undefined
  const directIlvl = numPr ? attrsOf(findChild(numPr, 'w:ilvl') ?? {})['w:val'] : undefined
  if (directNumId === '0') return undefined
  const styleNum = styleId ? ctx.styles.get(styleId)?.numPr : undefined
  const styleNumPr = styleNum === 'none' ? undefined : styleNum
  const numId = directNumId ?? styleNumPr?.numId
  if (!numId) return undefined
  const ilvl = directIlvl !== undefined ? parseInt(directIlvl, 10) || 0 : (styleNumPr?.ilvl ?? 0)
  return { numId, ilvl }
}

/** bullet/ordered classification of one list level (mixed lists differ per ilvl) */
export function listKindOf(ctx: BuildContext, numId: string, ilvl: number): 'bullet' | 'ordered' {
  const fmt = ctx.numbering.get(numId)?.levels[ilvl]?.numFmt
  if (fmt !== undefined) return fmt === 'bullet' ? 'bullet' : 'ordered'
  return ctx.numFormats.get(numId) ?? 'bullet'
}
