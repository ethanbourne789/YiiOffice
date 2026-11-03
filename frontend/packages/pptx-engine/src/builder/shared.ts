/**
 * Cross-domain helpers shared by builder modules (single definition site).
 */
import { textToBytes } from '../browser-compat'
import { PackageArchive, relsPathFor, resolveTarget } from '../zip'
import { maxRelationshipIdNumber } from '../xml-utils'
import type { StrokePatch } from '../generate'
import type { Paragraph, PPrDirty, Slide, Stroke } from '../types'

/** Find the slide's image rel for a media path, adding one when missing. */
export function imageRelFor(archive: PackageArchive, slide: Slide, mediaPath: string): string | undefined {
  for (const rel of archive.readRels(slide.path).values()) {
    if (rel.type.endsWith('/image') && resolveTarget(slide.path, rel.target) === mediaPath)
      return rel.id
  }
  const relsPath = relsPathFor(slide.path)
  const rels =
    archive.readText(relsPath) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const maxRid = maxRelationshipIdNumber(rels)
  const rid = `rId${maxRid + 1}`
  // slide parts live in ppt/slides/, media in ppt/media/
  const target = mediaPath.replace(/^ppt\//, '../')
  const relXml = `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`
  archive.entries.set(
    relsPath,
    textToBytes(rels.replace('</Relationships>', () => `${relXml}</Relationships>`)),
  )
  return rid
}

/** In-memory Stroke → StrokePatch for the save-time XML rewrite (inverse of strokePatchToModel).
 * null for fills a StrokePatch cannot express (image/pattern), which writes <a:noFill/>. */
export function modelStrokeToPatch(stroke: Stroke): StrokePatch | null {
  const capMap = { flat: 'flat', round: 'rnd', square: 'sq' } as const
  const base = {
    widthEmu: stroke.width,
    // 'solid' actively clears a stale prstDash left in the original bytes
    dash: stroke.dash ?? 'solid',
    ...(stroke.cap ? { cap: capMap[stroke.cap] } : {}),
    ...(stroke.join ? { join: stroke.join } : {}),
    ...(stroke.compound ? { compound: stroke.compound } : {}),
  }
  if (stroke.fill.type === 'solid') return { color: stroke.fill.color, ...base }
  if (stroke.fill.type === 'gradient')
    return {
      color: stroke.fill.stops[0]?.color ?? '#000000',
      ...base,
      gradient: { stops: stroke.fill.stops, angle: stroke.fill.angle ?? 0 },
    }
  return null
}

/** StrokePatch → in-memory Stroke model (mirrors what patchLnXml writes into the XML). */
export function strokePatchToModel(stroke: StrokePatch): Stroke {
  const capMap = { flat: 'flat', rnd: 'round', sq: 'square' } as const
  return {
    fill: stroke.gradient
      ? {
          type: 'gradient',
          stops: stroke.gradient.stops,
          angle: Math.round(stroke.gradient.angle),
        }
      : { type: 'solid', color: stroke.color },
    width: stroke.widthEmu,
    ...(stroke.dash && stroke.dash !== 'solid' ? { dash: stroke.dash } : {}),
    ...(stroke.cap ? { cap: capMap[stroke.cap] } : {}),
    ...(stroke.join ? { join: stroke.join } : {}),
    ...(stroke.compound && stroke.compound !== 'sng' ? { compound: stroke.compound } : {}),
  }
}

/**
 * Elements without text (pictures/charts etc.) return false.
 */
export interface ElementFontPatch {
  fontFamily?: string
  fontSizePt?: number
  strike?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** #RRGGBB (explicit color: clears theme-link/inheritance flags) */
  color?: string
}

/** Per-run size rewrite (relative grow/shrink); undefined = the run inherits its size. */
export type FontSizeMap = (pt: number | undefined) => number

export function applyFontPatch(
  paragraphs: Paragraph[],
  patch: ElementFontPatch,
  sizeMap?: FontSizeMap,
): void {
  for (const p of paragraphs) {
    // Empty paragraph (e.g. a blank table cell): leave an empty marker run so the
    // format persists and text typed later inherits it
    if (!p.runs.length) p.runs.push({ text: '' })
    for (const r of p.runs) {
      if (patch.fontFamily !== undefined) {
        r.fontFamily = patch.fontFamily
        // User explicitly changed the font: the original latin/ea/cs keep-flags no longer
        // apply, write the new font back. csFont has to go with them or a rebuilt run
        // re-emits the old complex-script typeface and Arabic text never changes.
        delete r.latinFont
        delete r.eaFont
        delete r.csFont
        delete r.fontImplicit
        delete r.latinFamily
      }
      if (patch.fontSizePt !== undefined || sizeMap) {
        r.fontSize = sizeMap ? sizeMap(r.fontSize) : patch.fontSizePt
        delete r.fontSizeImplicit
      }
      if (patch.strike !== undefined) {
        r.strike = patch.strike
        // Explicit off must survive a rebuild as strike="noStrike" (see buildRPrAttrs)
        if (!patch.strike) {
          delete r.strikeStyle
          r.strikeExplicitNone = true
        } else {
          delete r.strikeExplicitNone
        }
      }
      if (patch.bold !== undefined) {
        r.bold = patch.bold
        delete r.boldImplicit
      }
      if (patch.italic !== undefined) {
        r.italic = patch.italic
        delete r.italicImplicit
      }
      if (patch.underline !== undefined) {
        r.underline = patch.underline
        if (!patch.underline) {
          delete r.underlineStyle
          r.underlineExplicitNone = true
        } else {
          delete r.underlineExplicitNone
        }
      }
      if (patch.color !== undefined) {
        r.color = patch.color
        delete r.colorFollowsTheme
        delete r.colorInherited
        delete r.colorNodeXml
      }
    }
  }
}

// ── Paragraph formatting (bullet/line spacing/paragraph spacing/alignment) ──

export interface ParagraphFormatPatch {
  /** 'char' round bullet / 'number' numbering / 'blip' picture / 'none' explicitly none */
  bullet?: 'char' | 'number' | 'blip' | 'none'
  /** buAutoNum scheme (ST_TextAutonumberScheme) with bullet: 'number'; alone it re-schemes numbered paragraphs */
  numType?: string
  /** First number of the sequence; alone it only touches numbered paragraphs */
  startAt?: number
  /** Picture bullet already landed in the package (media path + slide rId), with bullet: 'blip' */
  bulletBlip?: { mediaRef: string; blipEmbedId: string }
  /** Custom bullet character (with bullet: 'char'; defaults to '•') */
  bulletChar?: string
  /** <a:buFont> for the character (PowerPoint's gallery pairs Wingdings/Courier codes with their font) */
  bulletFont?: string
  /** Bullet hanging indent (EMU); alone it adjusts existing bullets' indent */
  bulletHangEmu?: number
  /** Bullet size (% of text size, 100 = same); alone it only touches bulleted paragraphs */
  bulletSizePct?: number
  /** Bullet color (#RRGGBB); alone it only touches bulleted paragraphs */
  bulletColor?: string
  /** Line spacing (%, 100 = single) */
  lineSpacingPct?: number
  /** Space before / after (pt) */
  spaceBeforePt?: number
  spaceAfterPt?: number
  align?: Paragraph['align']
  /** Paragraph base direction (a:pPr rtl); false writes an explicit rtl="0" */
  rtl?: boolean
  /** Indent level delta (multi-level list Tab/⇧Tab; clamp 0..8) */
  indentDelta?: 1 | -1
}

/** Hanging indent PowerPoint writes when bulleting a plain text box (0.3125in) */
const BULLET_HANG_EMU = 285750

/**
 * Apply a paragraph-format patch to model paragraphs in place. Exported for
 * callers that rebuild a text body themselves (table cell edits) and need the
 * same bullet/spacing/direction semantics as setElementParagraphFormat without
 * its element-wide scope.
 */
export function applyParagraphFormat(
  paragraphs: Paragraph[],
  patch: ParagraphFormatPatch,
): PPrDirty {
  const dirty: PPrDirty = {}
  for (const p of paragraphs) {
    // Missing pPrExplicit = newly created element (all-explicit semantics); change values only, don't build the flag table
    const mark = (k: keyof NonNullable<Paragraph['pPrExplicit']>) => {
      if (p.pPrExplicit) p.pPrExplicit[k] = true
    }
    if (patch.bullet) {
      if (patch.bullet === 'none') {
        p.bullet = { type: 'none' }
        // Removing the bullet also retracts the hanging indent
        p.marL = 0
        p.indent = 0
        mark('marL')
        mark('indent')
        dirty.indents = true
      } else {
        // Keep the existing bullet's color/size when only the kind or glyph changes; the
        // font follows the glyph (a Wingdings code picked from the gallery brings its font,
        // a plain character drops a stale symbol font)
        const prev = p.bullet && p.bullet.type !== 'none' ? p.bullet : undefined
        const kept = {
          ...(prev?.color ? { color: prev.color } : {}),
          ...(prev?.colorNodeXml ? { colorNodeXml: prev.colorNodeXml } : {}),
          ...(prev?.sizePct != null ? { sizePct: prev.sizePct } : {}),
          ...(prev?.sizePt != null ? { sizePt: prev.sizePt } : {}),
        }
        const font = patch.bulletChar ? patch.bulletFont : (patch.bulletFont ?? prev?.font)
        if (patch.bullet === 'number') {
          const prevNum = prev?.type === 'number' ? prev : undefined
          const startAt = patch.startAt ?? prevNum?.startAt
          p.bullet = {
            type: 'number',
            numType: patch.numType ?? prevNum?.numType ?? 'arabicPeriod',
            ...(startAt != null ? { startAt } : {}),
            ...kept,
          }
        } else if (patch.bullet === 'blip' && patch.bulletBlip) {
          p.bullet = { type: 'blip', ...patch.bulletBlip, ...kept }
        } else {
          p.bullet = {
            type: 'char',
            char: patch.bulletChar ?? '•',
            ...kept,
            ...(font ? { font } : {}),
          }
        }
        // Add the default hanging indent when absent (stepped by level);
        // an explicit bulletHangEmu always re-applies
        const hang = patch.bulletHangEmu ?? BULLET_HANG_EMU
        if (patch.bulletHangEmu != null || !(p.indent != null && p.indent < 0)) {
          p.marL = hang * ((p.level ?? 0) + 1)
          p.indent = -hang
          mark('marL')
          mark('indent')
          dirty.indents = true
        }
      }
      mark('bullet')
      dirty.bullet = true
    } else if (patch.bulletHangEmu != null) {
      // Standalone hang adjustment: only touches paragraphs that render a bullet
      const hasBullet = p.bullet && p.bullet.type !== 'none'
      if (hasBullet || (p.indent != null && p.indent < 0)) {
        p.marL = patch.bulletHangEmu * ((p.level ?? 0) + 1)
        p.indent = -patch.bulletHangEmu
        mark('marL')
        mark('indent')
        dirty.indents = true
      }
    }
    if (!patch.bullet && (patch.numType != null || patch.startAt != null)) {
      // Standalone scheme / start number: only touches numbered paragraphs
      if (p.bullet?.type === 'number') {
        if (patch.numType != null) p.bullet.numType = patch.numType
        if (patch.startAt != null) p.bullet.startAt = patch.startAt
        mark('bullet')
        dirty.bullet = true
      }
    }
    if (patch.bulletSizePct != null || patch.bulletColor) {
      // Standalone size/color adjustment: only touches paragraphs that render a bullet
      if (p.bullet && p.bullet.type !== 'none') {
        if (patch.bulletSizePct != null) {
          p.bullet.sizePct = patch.bulletSizePct
          delete p.bullet.sizePt
        }
        if (patch.bulletColor) {
          p.bullet.color = patch.bulletColor
          // a user color replaces the captured theme node, else generate re-emits the old schemeClr
          delete p.bullet.colorNodeXml
        }
        mark('bullet')
        dirty.bullet = true
      }
    }
    if (patch.lineSpacingPct != null) {
      p.lineHeight = patch.lineSpacingPct
      delete p.lineExact
      mark('lnSpc')
      dirty.lnSpc = true
    }
    if (patch.spaceBeforePt != null) {
      p.spaceBefore = patch.spaceBeforePt
      delete p.spaceBeforePct
      mark('spcBef')
      dirty.spcBef = true
    }
    if (patch.spaceAfterPt != null) {
      p.spaceAfter = patch.spaceAfterPt
      delete p.spaceAfterPct
      mark('spcAft')
      dirty.spcAft = true
    }
    if (patch.align) {
      p.align = patch.align
      mark('align')
      dirty.align = true
    }
    if (patch.rtl != null) {
      p.rtl = patch.rtl
      dirty.rtl = true
    }
    if (patch.indentDelta) {
      const lvl = Math.max(0, Math.min(8, (p.level ?? 0) + patch.indentDelta))
      if (lvl !== (p.level ?? 0)) {
        p.level = lvl || undefined
        dirty.level = true
        // Own-bullet hanging indent steps with the level; inherited indents are left to the materialize reparse
        if (p.pPrExplicit?.marL && p.indent != null && p.indent < 0) {
          p.marL = -p.indent * (lvl + 1)
          dirty.indents = true
        }
      }
    }
  }
  return dirty
}
