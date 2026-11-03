import { type OpenedPptx } from '../package'
import { patchSlideXml, patchAnchorXml, patchedElementXml } from './patch'
import { findGroupChild, patchGroupChildXml } from './group'
import { imageRelFor } from './shared'
import { patchElementFill, topLevelChildren, type GradientFillPatch } from '../generate'
import { addImageMediaAndRel } from '../insert'
import { cleanupSupersededSlideResources } from '../resource-cleanup'
import { stripRedactExt, syncRedactExt } from '../redaction-xml'
import type {
  Slide,
  SlideElement,
  TextElement,
  GroupElement,
  ShadowEffect,
  GlowEffect,
  ReflectionEffect,
} from '../types'

/**
 * Text-box vertical alignment (bodyPr anchor: t/ctr/b). Byte surgery baked directly into originalXml.
 */
export function setElementTextAnchor(
  slide: Slide,
  elementId: string,
  anchor: 'top' | 'middle' | 'bottom',
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  const t = el as TextElement
  if (!t.text) return false
  let xml = patchedElementXml(el)
  const val = anchor === 'middle' ? 'ctr' : anchor === 'bottom' ? 'b' : 't'
  const m = /<a:bodyPr\b[^>]*?\/?>/.exec(xml)
  if (!m) return false
  let tag = m[0].replace(/\s+anchor="[^"]*"/, '')
  tag = tag.replace(/^<a:bodyPr/, `<a:bodyPr anchor="${val}"`)
  xml = xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length)
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  t.text.anchor = anchor
  slide.structureDirty = true
  return true
}

/**
 * Landing-time normalization for generated pages: the cloud html→pptx converter writes text
 * boxes without any autofit child, which PowerPoint reads as "do not autofit" — typing past
 * the frame overflows a box that never grows. Bare txBox bodies get spAutoFit, the default of
 * a PowerPoint-inserted text box; explicit noAutofit/normAutofit and autoshapes are kept.
 * Top-level elements only (mirrors the editor's autofit resize).
 */
export function autofitGeneratedTextBoxes(slide: Slide): number {
  let count = 0
  for (const el of slide.elements) {
    if ((el.type !== 'text' && el.type !== 'shape') || !el.txBox || !el.text) continue
    const body = /<a:bodyPr\b[^>]*?\/>|<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/.exec(
      patchedElementXml(el),
    )
    if (!body || /<a:(?:noAutofit|normAutofit|spAutoFit)\b/.test(body[0])) continue
    if (setElementTextBodyProps(slide, el.id, { autofit: 'resize' })) count++
  }
  return count
}

/** Patch for setElementTextBodyProps; only the provided fields are written. */
export interface TextBodyPropsPatch {
  /** Text direction ('horz' clears the vert attribute) */
  vert?: 'horz' | 'eaVert' | 'vert' | 'vert270' | 'wordArtVert'
  /** Autofit mode (noAutofit / normAutofit / spAutoFit) */
  autofit?: 'none' | 'shrink' | 'resize'
  /** Internal margins (EMU); only the provided sides are written */
  insets?: Partial<{ l: number; t: number; r: number; b: number }>
  wrap?: boolean
}

/**
 * Text-box body properties (direction/autofit/insets/wrap): <a:bodyPr> byte
 * surgery baked into originalXml, mirroring setElementTextAnchor.
 */
export function setElementTextBodyProps(
  slide: Slide,
  elementId: string,
  patch: TextBodyPropsPatch,
): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  const t = el as TextElement
  if (!t.text) return false
  let xml = patchedElementXml(el)
  const whole = /<a:bodyPr\b[^>]*?\/>|<a:bodyPr\b[^>]*>[\s\S]*?<\/a:bodyPr>/.exec(xml)
  if (!whole) return false
  const bodyXml = whole[0]
  const selfClosing = !bodyXml.includes('</a:bodyPr>')
  let openTag = selfClosing
    ? bodyXml.slice(0, -2).trimEnd() + '>'
    : bodyXml.slice(0, bodyXml.indexOf('>') + 1)
  let inner = selfClosing
    ? ''
    : bodyXml.slice(bodyXml.indexOf('>') + 1, bodyXml.lastIndexOf('</a:bodyPr>'))

  const setAttr = (name: string, value: string | null) => {
    openTag = openTag.replace(new RegExp(`\\s+${name}="[^"]*"`), '')
    if (value != null) openTag = openTag.replace(/^<a:bodyPr/, `<a:bodyPr ${name}="${value}"`)
  }

  if (patch.vert !== undefined) setAttr('vert', patch.vert === 'horz' ? null : patch.vert)
  if (patch.wrap !== undefined) setAttr('wrap', patch.wrap ? 'square' : 'none')
  if (patch.insets) {
    for (const side of ['l', 't', 'r', 'b'] as const) {
      const v = patch.insets[side]
      if (v != null) setAttr(`${side}Ins`, String(Math.max(0, Math.round(v))))
    }
  }
  if (patch.autofit) {
    inner = inner.replace(
      /<a:(?:noAutofit|normAutofit|spAutoFit)\b[^>]*?\/>|<a:(?:noAutofit|normAutofit|spAutoFit)\b[^>]*>[\s\S]*?<\/a:(?:noAutofit|normAutofit|spAutoFit)>/,
      '',
    )
    const child =
      patch.autofit === 'none'
        ? '<a:noAutofit/>'
        : patch.autofit === 'shrink'
          ? '<a:normAutofit/>'
          : '<a:spAutoFit/>'
    // schema order: the autofit choice sits after <a:prstTxWarp> when present, else first
    const warp = /<a:prstTxWarp\b(?:[^>]*?\/>|[\s\S]*?<\/a:prstTxWarp>)/.exec(inner)
    const at = warp ? warp.index + warp[0].length : 0
    inner = inner.slice(0, at) + child + inner.slice(at)
  }

  const rebuilt = inner ? `${openTag}${inner}</a:bodyPr>` : `${openTag.slice(0, -1).trimEnd()}/>`
  xml = xml.slice(0, whole.index) + rebuilt + xml.slice(whole.index + bodyXml.length)
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  // Mirror into the parsed model so re-renders see the new values without a reparse
  if (patch.vert !== undefined) {
    if (patch.vert === 'horz') delete t.text.vert
    else t.text.vert = patch.vert
  }
  if (patch.wrap !== undefined) t.text.wrap = patch.wrap
  if (patch.insets) {
    const base = { l: 91440, t: 45720, r: 91440, b: 45720, ...(t.text.insets ?? {}) }
    if (patch.insets.l != null) base.l = Math.max(0, Math.round(patch.insets.l))
    if (patch.insets.t != null) base.t = Math.max(0, Math.round(patch.insets.t))
    if (patch.insets.r != null) base.r = Math.max(0, Math.round(patch.insets.r))
    if (patch.insets.b != null) base.b = Math.max(0, Math.round(patch.insets.b))
    t.text.insets = base
  }
  if (patch.autofit) {
    t.text.autofit = patch.autofit
    if (patch.autofit !== 'shrink') {
      delete t.text.fontScale
      delete t.text.lnSpcReduction
    }
  }
  slide.structureDirty = true
  return true
}

/** Patch for setElementEffects; null clears an effect, undefined leaves it untouched. */
export interface EffectsPatch {
  /** Shadow (<a:outerShdw>, or <a:innerShdw> when inner); color may carry alpha as #RRGGBBAA.
   * sx/sy/kxDeg/kyDeg/algn are the outer perspective attributes (scale fraction / skew degrees). */
  shadow?: {
    color: string
    blurRad: number
    dist: number
    dirDeg: number
    inner?: boolean
    sx?: number
    sy?: number
    kxDeg?: number
    kyDeg?: number
    algn?: string
  } | null
  /** Glow (<a:glow>); radius in EMU */
  glow?: { color: string; radius: number } | null
  /** Reflection (<a:reflection>): startA/endPos as 0..1 fractions, blurRad/dist in EMU */
  reflection?: { blurRad: number; startA: number; endPos: number; dist: number } | null
  /** Soft-edge feather radius (<a:softEdge rad>, EMU); the renderer honors it on pictures */
  softEdge?: number | null
}

/** #RRGGBB / #RRGGBBAA → <a:srgbClr> (alpha channel becomes an <a:alpha> child in 1000ths of a percent). */
function effectColorXml(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex)
  const val = (m?.[1] ?? '000000').toUpperCase()
  const alpha = m?.[2] != null ? Math.round((parseInt(m[2], 16) / 255) * 100000) : 100000
  return alpha < 100000
    ? `<a:srgbClr val="${val}"><a:alpha val="${alpha}"/></a:srgbClr>`
    : `<a:srgbClr val="${val}"/>`
}

/** ECMA-376 effectLst child order (children must be re-emitted in schema order). */
const EFFECT_ORDER = [
  'blur',
  'fillOverlay',
  'glow',
  'innerShdw',
  'outerShdw',
  'prstShdw',
  'reflection',
  'softEdge',
]

/**
 * Shape/picture effects (shadow / glow / soft edge): <a:effectLst> byte surgery inside
 * the element's <p:spPr>, mirroring setElementTextBodyProps. Untouched effectLst children
 * (fillOverlay, reflection, ...) are preserved and the list is re-emitted in schema order;
 * an emptied effectLst is removed entirely.
 */
export function setElementEffects(slide: Slide, elementId: string, patch: EffectsPatch): boolean {
  const el = slide.elements.find((e) => e.id === elementId)
  if (!el || (el.type !== 'text' && el.type !== 'shape' && el.type !== 'picture')) return false
  let xml = patchedElementXml(el)
  const spPrM = /<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/.exec(xml)
  if (!spPrM) return false
  let spPr = spPrM[0]

  // Existing children (whole-element matches), keyed by local name
  const children = new Map<string, string>()
  // spPr's OWN children: a:ln / a:blip may carry an effectLst/extLst of their own
  const spPrInnerStart = spPr.indexOf('>') + 1
  const spPrInnerEnd = spPr.lastIndexOf('</p:spPr>')
  const direct = topLevelChildren(spPr, spPrInnerStart, spPrInnerEnd)
  const lst = direct.find((c) => c.name === 'a:effectLst')
  const lstInner = lst
    ? /^<a:effectLst\b[^>]*>([\s\S]*)<\/a:effectLst>$/.exec(spPr.slice(lst.start, lst.end))?.[1]
    : undefined
  if (lstInner) {
    const childRe = /<a:(\w+)\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/a:\1>)/g
    for (let m = childRe.exec(lstInner); m; m = childRe.exec(lstInner)) children.set(m[1]!, m[0])
  }

  if (patch.shadow !== undefined) {
    children.delete('outerShdw')
    children.delete('innerShdw')
    if (patch.shadow !== null) {
      const s = patch.shadow
      const base = [
        s.blurRad ? ` blurRad="${Math.max(0, Math.round(s.blurRad))}"` : '',
        s.dist ? ` dist="${Math.max(0, Math.round(s.dist))}"` : '',
        ` dir="${Math.round((((s.dirDeg % 360) + 360) % 360) * 60000)}"`,
      ].join('')
      if (s.inner) {
        children.set('innerShdw', `<a:innerShdw${base}>${effectColorXml(s.color)}</a:innerShdw>`)
      } else {
        // CT_OuterShadowEffect attribute order: blurRad dist dir sx sy kx ky algn rotWithShape
        const persp = [
          s.sx != null && s.sx !== 1 ? ` sx="${Math.round(s.sx * 100000)}"` : '',
          s.sy != null && s.sy !== 1 ? ` sy="${Math.round(s.sy * 100000)}"` : '',
          s.kxDeg ? ` kx="${Math.round(s.kxDeg * 60000)}"` : '',
          s.kyDeg ? ` ky="${Math.round(s.kyDeg * 60000)}"` : '',
          s.algn ? ` algn="${s.algn}"` : '',
        ].join('')
        children.set(
          'outerShdw',
          `<a:outerShdw${base}${persp} rotWithShape="0">${effectColorXml(s.color)}</a:outerShdw>`,
        )
      }
    }
  }
  if (patch.glow !== undefined) {
    if (patch.glow === null) children.delete('glow')
    else {
      const rad = Math.max(0, Math.round(patch.glow.radius))
      children.set('glow', `<a:glow rad="${rad}">${effectColorXml(patch.glow.color)}</a:glow>`)
    }
  }
  if (patch.reflection !== undefined) {
    if (patch.reflection === null) children.delete('reflection')
    else {
      const r = patch.reflection
      // CT_ReflectionEffect attr order: blurRad stA … endA endPos dist dir … sy … algn rotWithShape.
      // sy=-100% is the vertical flip; endA=0.3% matches PowerPoint's presets.
      const attrs = [
        r.blurRad ? ` blurRad="${Math.max(0, Math.round(r.blurRad))}"` : '',
        ` stA="${Math.max(0, Math.min(100000, Math.round(r.startA * 100000)))}"`,
        ' endA="300"',
        ` endPos="${Math.max(0, Math.min(100000, Math.round(r.endPos * 100000)))}"`,
        r.dist ? ` dist="${Math.max(0, Math.round(r.dist))}"` : '',
        ' dir="5400000" sy="-100000" algn="bl" rotWithShape="0"',
      ].join('')
      children.set('reflection', `<a:reflection${attrs}/>`)
    }
  }
  if (patch.softEdge !== undefined) {
    if (patch.softEdge === null) children.delete('softEdge')
    else children.set('softEdge', `<a:softEdge rad="${Math.max(0, Math.round(patch.softEdge))}"/>`)
  }

  const inner = [...children.entries()]
    .sort(
      (a, b) =>
        (EFFECT_ORDER.indexOf(a[0]) + 1 || EFFECT_ORDER.length + 1) -
        (EFFECT_ORDER.indexOf(b[0]) + 1 || EFFECT_ORDER.length + 1),
    )
    .map(([, frag]) => frag)
    .join('')
  const rebuilt = inner ? `<a:effectLst>${inner}</a:effectLst>` : ''
  if (lst) {
    spPr = spPr.slice(0, lst.start) + rebuilt + spPr.slice(lst.end)
  } else if (rebuilt) {
    // schema order: effectLst sits after ln, before scene3d/sp3d/extLst
    const anchor = direct.find(
      (c) => c.name === 'a:scene3d' || c.name === 'a:sp3d' || c.name === 'a:extLst',
    )
    const at = anchor ? anchor.start : spPrInnerEnd
    spPr = spPr.slice(0, at) + rebuilt + spPr.slice(at)
  }
  xml = xml.slice(0, spPrM.index) + spPr + xml.slice(spPrM.index + spPrM[0].length)
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml

  // Mirror into the parsed model so re-renders see the new values without a reparse
  const eff = el as {
    shadow?: ShadowEffect
    glow?: GlowEffect
    reflection?: ReflectionEffect
    softEdge?: number
  }
  if (patch.shadow !== undefined) {
    if (patch.shadow === null) delete eff.shadow
    else {
      const s = patch.shadow
      eff.shadow = {
        color: s.color,
        blurRad: Math.max(0, Math.round(s.blurRad)),
        dist: Math.max(0, Math.round(s.dist)),
        dirDeg: ((s.dirDeg % 360) + 360) % 360,
        ...(s.inner ? { inner: true } : {}),
        ...(s.sx != null && s.sx !== 1 && !s.inner ? { sx: s.sx } : {}),
        ...(s.sy != null && s.sy !== 1 && !s.inner ? { sy: s.sy } : {}),
        ...(s.kxDeg && !s.inner ? { kxDeg: s.kxDeg } : {}),
        ...(s.kyDeg && !s.inner ? { kyDeg: s.kyDeg } : {}),
        ...(s.algn && !s.inner ? { algn: s.algn } : {}),
      }
    }
  }
  if (patch.glow !== undefined) {
    if (patch.glow === null) delete eff.glow
    else eff.glow = { color: patch.glow.color, radius: Math.max(0, Math.round(patch.glow.radius)) }
  }
  if (patch.reflection !== undefined) {
    if (patch.reflection === null) delete eff.reflection
    else {
      eff.reflection = {
        blurRad: Math.max(0, Math.round(patch.reflection.blurRad)),
        startA: Math.max(0, Math.min(1, patch.reflection.startA)),
        endPos: Math.max(0, Math.min(1, patch.reflection.endPos)),
        dist: Math.max(0, Math.round(patch.reflection.dist)),
      }
    }
  }
  if (patch.softEdge !== undefined) {
    if (patch.softEdge === null) delete eff.softEdge
    else eff.softEdge = Math.max(0, Math.round(patch.softEdge))
  }
  slide.structureDirty = true
  return true
}

/**
 * Shape fill (top-level or one-level group child). The XML patch is baked into
 * the owning fragment so a dropped picture fill can immediately release its
 * obsolete relationship and unshared media.
 */
export function setElementFill(
  opened: OpenedPptx,
  slide: Slide,
  elementId: string,
  fill: string | GradientFillPatch,
  opts: { groupId?: string } = {},
): boolean {
  let grp: GroupElement | undefined
  let child: SlideElement | undefined
  let el: SlideElement | undefined
  if (opts.groupId) {
    const found = findGroupChild(slide, opts.groupId, elementId)
    if (
      !found ||
      (found.child.type !== 'text' && found.child.type !== 'shape') ||
      !found.child.nvId
    )
      return false
    ;({ grp, child } = found)
  } else {
    el = slide.elements.find((candidate) => candidate.id === elementId)
    if (!el || (el.type !== 'text' && el.type !== 'shape')) return false
  }

  const model =
    typeof fill === 'string'
      ? fill === 'none'
        ? { type: 'none' as const }
        : { type: 'solid' as const, color: fill }
      : (() => {
          const path = fill.path ?? (fill.radial ? ('circle' as const) : undefined)
          return {
            type: 'gradient' as const,
            stops: fill.stops,
            ...(fill.angle != null ? { angle: fill.angle } : {}),
            ...(path ? { path } : {}),
            ...(path && fill.fillTo ? { fillTo: fill.fillTo } : {}),
          }
        })()
  const previousXml = patchSlideXml(slide)
  if (grp && child) {
    if (!patchGroupChildXml(grp, child, (xml) => patchElementFill(xml, fill))) return false
    ;(child as TextElement).fill = model
  } else if (el) {
    el.anchor.originalXml = patchAnchorXml(
      el,
      patchedElementXml(el),
      (x) => patchElementFill(x, fill),
      true,
    )
    ;(el as TextElement).fill = model
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
    el.dirtyPPr = undefined
  }
  slide.structureDirty = true
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
  return true
}

/**
 * Shape picture/texture fill (top-level or one-level group child): lands the
 * image in the package (media + rels), or reuses an already-landed media path
 * (applying one pick to many shapes only adds rels), then replaces the spPr
 * fill node with a blipFill, byte surgery baked directly into originalXml.
 * tile repeats the image at natural size (texture), stretch maps it onto the
 * bounds. Returns the mediaPath (render-layer decoding / reuse), null on failure.
 */
export function setElementImageFill(
  opened: OpenedPptx,
  slide: Slide,
  elementId: string,
  source: { bytes: Uint8Array; ext: string } | { mediaPath: string },
  opts: { tile?: boolean; groupId?: string } = {},
): string | null {
  // Resolve the target before touching the package: a failed lookup must not
  // leave an orphaned media part behind (multi-target fills would grow the
  // archive on every failed attempt).
  let grp: GroupElement | undefined
  let child: SlideElement | undefined
  let el: SlideElement | undefined
  if (opts.groupId) {
    const found = findGroupChild(slide, opts.groupId, elementId)
    if (
      !found ||
      (found.child.type !== 'text' && found.child.type !== 'shape') ||
      !found.child.nvId
    )
      return null
    ;({ grp, child } = found)
  } else {
    el = slide.elements.find((e) => e.id === elementId)
    if (!el || (el.type !== 'text' && el.type !== 'shape')) return null
  }
  const previousXml = patchSlideXml(slide)
  let rid: string
  let mediaPath: string
  if ('bytes' in source) {
    const added = addImageMediaAndRel(opened, slide, source.bytes, source.ext)
    if (!added) return null
    ;({ rid, mediaPath } = added)
  } else {
    mediaPath = source.mediaPath
    if (!opened.archive.entries.has(mediaPath)) return null
    const existing = imageRelFor(opened.archive, slide, mediaPath)
    if (!existing) return null
    rid = existing
  }
  const rawFillXml =
    `<a:blipFill rotWithShape="1"><a:blip r:embed="${rid}"/>` +
    (opts.tile
      ? '<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>'
      : '<a:stretch><a:fillRect/></a:stretch>') +
    '</a:blipFill>'
  const model = {
    type: 'image' as const,
    mediaRef: mediaPath,
    mode: opts.tile ? ('tile' as const) : ('stretch' as const),
    // mirror what parse restores from the <a:tile> node, so the pre-save
    // render already tiles at the natural (zoom-scaled) size
    ...(opts.tile ? { tile: { tx: 0, ty: 0, sx: 1, sy: 1, algn: 'tl' } } : {}),
  }
  if (grp && child) {
    if (!patchGroupChildXml(grp, child, (xml) => patchElementFill(xml, { rawFillXml }))) return null
    ;(child as TextElement).fill = model
  } else if (el) {
    const xml = patchAnchorXml(
      el,
      patchedElementXml(el),
      (x) => patchElementFill(x, { rawFillXml }),
      true,
    )
    el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
    el.dirtyPPr = undefined
    el.anchor.originalXml = xml
    ;(el as TextElement).fill = model
  }
  slide.structureDirty = true
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
  return mediaPath
}

/**
 * Withhold a picture, video or audio shape from the model, or stop withholding it
 * (`label` null/empty clears). A `label` puts `go:redact` in the element's
 * `<a:spPr><a:extLst>` — the one extension slot a picture has, since `p:nvPicPr`
 * admits only `cNvPr` + `cNvPicPr` and `cNvPr` takes attributes alone, which the
 * reader's own alt text already uses.
 *
 * The words of a *text* element are withheld through `TextRun.redact` on the edit
 * path instead, because a run is a finer unit than an element and the text-edit
 * pipeline already carries run attributes.
 *
 * Byte surgery on `originalXml` with no separate dirty flag, exactly as
 * `setPictureOpacity` does for `a:alphaModFix`: a picture's shape properties are
 * never regenerated from the model, so this is the only place the mark can live.
 */
export function setElementRedaction(slide: Slide, sourceId: string, label: string | null): boolean {
  const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture')
  if (!el) return false
  const pic = el as import('../types').PictureElement
  const clean = (label ?? '').trim()
  const next = clean
    ? syncRedactExt(patchedElementXml(el), 'p:spPr', clean)
    : stripRedactExt(patchedElementXml(el))
  if (next === patchedElementXml(el)) return false
  if (clean) pic.redact = clean
  else delete pic.redact
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtySrcRect = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = next
  slide.structureDirty = true
  return true
}

/**
 * Whole-picture opacity (0..1; ≥1 clears alphaModFix). Byte surgery on the
 * <a:blip> child, baked directly into originalXml (no separate dirty flag).
 */
export function setPictureOpacity(slide: Slide, sourceId: string, opacity: number): boolean {
  const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture')
  if (!el) return false
  const pic = el as import('../types').PictureElement
  let xml = patchedElementXml(el)
  xml = xml.replace(/<a:alphaModFix\b[^>]*\/>|<a:alphaModFix\b[^>]*>[\s\S]*?<\/a:alphaModFix>/, '')
  const v = Math.max(0, Math.min(1, opacity))
  if (v < 0.999) {
    const amt = `<a:alphaModFix amt="${Math.round(v * 100000)}"/>`
    if (/<a:blip\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/<a:blip\b([^>]*)\/>/, `<a:blip$1>${amt}</a:blip>`)
    } else if (/<a:blip\b[^>]*>/.test(xml)) {
      xml = xml.replace(/(<a:blip\b[^>]*>)/, `$1${amt}`)
    } else {
      return false
    }
    pic.opacity = v
  } else {
    delete pic.opacity
  }
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtySrcRect = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  slide.structureDirty = true
  return true
}

/**
 * Swap a picture's backing image for new bytes, keeping frame, z-order, border
 * and effects. New media part + rel; the <a:blip> reference is re-pointed via
 * byte surgery baked into originalXml (same pattern as setPictureOpacity).
 * srcRect is kept only when the caller knows the new image shares the old one's
 * pixel geometry (e.g. background-removal output) — otherwise the stale crop
 * would show an arbitrary window of the new image.
 */
export function replacePictureBytes(
  opened: OpenedPptx,
  slide: Slide,
  sourceId: string,
  bytes: Uint8Array,
  ext: string,
  opts?: { keepSrcRect?: boolean },
): boolean {
  const el = slide.elements.find((e) => e.id === sourceId && e.type === 'picture')
  if (!el) return false
  const pic = el as import('../types').PictureElement
  let xml = patchedElementXml(el)
  const blip = /<a:blip\b[^>]*\/?>/.exec(xml)
  if (!blip) return false
  const previousXml = patchSlideXml(slide)
  const added = addImageMediaAndRel(opened, slide, bytes, ext)
  if (!added) return false
  let tag = blip[0]
  // A coexisting r:link ("insert and link" pictures) would keep refreshing from
  // the old external file, so it is dropped once the embed points at new bytes
  if (/r:embed="/.test(tag))
    tag = tag.replace(/r:embed="[^"]*"/, `r:embed="${added.rid}"`).replace(/\s+r:link="[^"]*"/, '')
  else if (/r:link="/.test(tag)) tag = tag.replace(/r:link="[^"]*"/, `r:embed="${added.rid}"`)
  else tag = tag.replace(/<a:blip\b/, `<a:blip r:embed="${added.rid}"`)
  xml = xml.slice(0, blip.index) + tag + xml.slice(blip.index + blip[0].length)
  // The replacement is always raster (IMAGE_MIME gate), and PowerPoint prefers a
  // leftover Office-2016 <asvg:svgBlip> extension over the retargeted r:embed —
  // drop that extension entry (and its wrapper when nothing else remains)
  xml = xml
    .replace(/<a:ext\b[^>]*>\s*<\w+:svgBlip\b[\s\S]*?<\/a:ext>/, '')
    .replace(/<a:extLst>\s*<\/a:extLst>/, '')
  if (!opts?.keepSrcRect) {
    xml = xml.replace(/<a:srcRect\b[^>]*\/>|<a:srcRect\b[^>]*>[\s\S]*?<\/a:srcRect>/, '')
    delete pic.srcRect
  }
  pic.mediaRef = added.mediaPath
  delete pic.dataUrl // the media resolver re-derives it from the new mediaRef
  el.dirty = el.dirtyTransform = el.dirtyFill = el.dirtyStroke = false
  el.dirtySrcRect = false
  el.dirtyPPr = undefined
  el.anchor.originalXml = xml
  slide.structureDirty = true
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
  return true
}
