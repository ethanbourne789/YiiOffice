import { buildDecorations, partMediaRels, type OpenedPptx } from '../package'
import { patchSlideXml } from './patch'
import { imageRelFor } from './shared'
import {
  patchSlideBackgroundXml,
  patchSlideShowMasterSpXml,
  removeSlideBackgroundXml,
  type GradientFillPatch,
} from '../generate'
import { parseBackground } from '../parse'
import { parseClrMap, parseTheme, type Theme } from '../theme'
import {
  parsePlaceholderMap,
  parseMasterTextStyles,
  parseDefaultTextStyle,
} from '../placeholder'
import { addImageMediaAndRel } from '../insert'
import { cleanupSupersededSlideResources } from '../resource-cleanup'
import { PackageArchive } from '../zip'
import type { Slide } from '../types'

/**
 * Set a solid or gradient slide background: patch the bodyPrefix and sync the model
 * (written back with the whole-slide rebuild on save).
 */
export function setSlideBackground(
  opened: OpenedPptx,
  slide: Slide,
  fill: string | GradientFillPatch,
): void {
  const previousXml = patchSlideXml(slide)
  slide.bodyPrefix = patchSlideBackgroundXml(slide.bodyPrefix, fill)
  slide.background =
    typeof fill === 'string'
      ? { type: 'solid', color: fill }
      : {
          type: 'gradient',
          stops: fill.stops.map((s) => ({ pos: s.pos, color: s.color })),
          ...(fill.radial ? { path: 'circle' as const } : { angle: Math.round(fill.angle ?? 0) }),
        }
  slide.bgOwn = true
  slide.structureDirty = true
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
}

/**
 * Set a picture slide background. Source is either fresh bytes (lands a new media
 * part) or an existing media path (e.g. applying one picked image to all slides —
 * only a rel is added). Returns the media path used, or null for unsupported formats.
 */
export function setSlideBackgroundImage(
  opened: OpenedPptx,
  slide: Slide,
  source: { bytes: Uint8Array; ext: string } | { mediaPath: string },
  tile?: boolean,
): string | null {
  let rid: string | undefined
  let mediaPath: string
  if ('bytes' in source) {
    const added = addImageMediaAndRel(opened, slide, source.bytes, source.ext)
    if (!added) return null
    rid = added.rid
    mediaPath = added.mediaPath
  } else {
    mediaPath = source.mediaPath
    if (!opened.archive.entries.has(mediaPath)) return null
    rid = imageRelFor(opened.archive, slide, mediaPath)
    if (!rid) return null
  }
  const previousXml = patchSlideXml(slide)
  slide.bodyPrefix = patchSlideBackgroundXml(slide.bodyPrefix, {
    imageRid: rid,
    ...(tile ? { tile: true } : {}),
  })
  slide.background = { type: 'image', mediaRef: mediaPath, mode: tile ? 'tile' : 'stretch' }
  slide.bgOwn = true
  slide.structureDirty = true
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
  return mediaPath
}

/**
 * Remove the slide's own <p:bg> override; the background falls back to the
 * layout/master definition (recomputed here so rendering updates without a reopen).
 */
export function resetSlideBackground(opened: OpenedPptx, slide: Slide): void {
  const previousXml = patchSlideXml(slide)
  slide.bodyPrefix = removeSlideBackgroundXml(slide.bodyPrefix)
  delete slide.bgOwn
  slide.structureDirty = true
  const inherit = slideInheritanceCtx(opened.archive, slide.path)
  const inherited =
    (inherit.layoutXml
      ? parseBackground(inherit.layoutXml, {
          theme: inherit.theme,
          mediaRels: inherit.layoutMediaRels,
          themeMediaRels: inherit.themeMediaRels,
        })
      : undefined) ??
    (inherit.masterXml
      ? parseBackground(inherit.masterXml, {
          theme: inherit.theme,
          mediaRels: inherit.masterMediaRels,
          themeMediaRels: inherit.themeMediaRels,
        })
      : undefined)
  if (inherited) slide.background = inherited
  else delete slide.background
  cleanupSupersededSlideResources(opened, slide, previousXml, patchSlideXml(slide))
}

/**
 * Toggle "hide background graphics" (<p:sld showMasterSp="0">) and rebuild the
 * slide's decoration layer so rendering reflects the change immediately.
 */
export function setSlideBgGraphicsHidden(opened: OpenedPptx, slide: Slide, hidden: boolean): void {
  slide.bodyPrefix = patchSlideShowMasterSpXml(slide.bodyPrefix, hidden)
  if (hidden) slide.masterSpHidden = true
  else delete slide.masterSpHidden
  slide.structureDirty = true
  const inherit = slideInheritanceCtx(opened.archive, slide.path)
  const decorations = buildDecorations(
    opened.archive,
    slide.path,
    slide.bodyPrefix, // carries the fresh showMasterSp attribute
    slide,
    inherit.layoutXml,
    inherit.masterXml,
    {
      layoutPath: inherit.layoutPath,
      masterPath: inherit.masterPath,
      theme: inherit.theme,
      masterPlaceholders: inherit.masterPlaceholders,
      masterTextStyles: inherit.masterTextStyles,
      defaultTextStyle: inherit.defaultTextStyle,
    },
  )
  if (decorations.length) slide.decorations = decorations
  else delete slide.decorations
}

/** Layout/master inheritance bundle for one slide (theme + placeholder maps + part media rels). */
function slideInheritanceCtx(archive: PackageArchive, slidePath: string) {
  const chain = archive.resolveSlideChain(slidePath)
  const layoutXml = (chain.layoutPath ? archive.readText(chain.layoutPath) : undefined) ?? undefined
  const masterXml = (chain.masterPath ? archive.readText(chain.masterPath) : undefined) ?? undefined
  let theme: Theme | undefined
  if (chain.themePath) {
    const themeXml = archive.readText(chain.themePath)
    if (themeXml) {
      theme = parseTheme(themeXml)
      theme.clrMap = parseClrMap(masterXml, layoutXml, archive.readText(slidePath) ?? undefined)
    }
  }
  const presXml = archive.readText('ppt/presentation.xml')
  const masterMediaRels = chain.masterPath ? partMediaRels(archive, chain.masterPath) : undefined
  return {
    layoutPath: chain.layoutPath,
    masterPath: chain.masterPath,
    layoutXml,
    masterXml,
    theme,
    masterPlaceholders: masterXml
      ? parsePlaceholderMap(masterXml, theme, masterMediaRels)
      : undefined,
    masterTextStyles: masterXml
      ? parseMasterTextStyles(masterXml, theme, masterMediaRels)
      : undefined,
    defaultTextStyle: presXml ? parseDefaultTextStyle(presXml, theme) : undefined,
    layoutMediaRels: chain.layoutPath ? partMediaRels(archive, chain.layoutPath) : undefined,
    masterMediaRels,
    themeMediaRels: chain.themePath ? partMediaRels(archive, chain.themePath) : undefined,
  }
}
