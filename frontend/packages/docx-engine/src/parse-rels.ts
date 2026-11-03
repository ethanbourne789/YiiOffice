// rels / [Content_Types].xml / media parts: image mime resolution and the
// cached media-part data URLs (moved out of parse.ts).
import JSZip from 'jszip'
import type { JSZipObject } from 'jszip'

import { isMetafileMime, metafileToDataUrl } from './metafile'
import { isTiffMime, tiffToDataUrlAsync } from './tiff'
import { attrsOf, findChildren, nameOf, xmlParser, type XNode } from './xml-utils'
import { resolveRelationshipTargetPath } from './parse-package'
import type { RelInfo } from './parse-xml-text'
import type { BuildContext } from './parse-shared'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf',
  emz: 'image/x-emz',
  wmz: 'image/x-wmz',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

const contentTypesCache = new WeakMap<
  JSZip,
  Promise<{ defaults: Map<string, string>; overrides: Map<string, string> }>
>()

export function contentTypesOf(zip: JSZip) {
  let cached = contentTypesCache.get(zip)
  if (!cached) {
    cached = (async () => {
      const defaults = new Map<string, string>()
      const overrides = new Map<string, string>()
      const file = zip.file('[Content_Types].xml')
      if (!file) return { defaults, overrides }
      const parsed = xmlParser.parse(await file.async('string')) as XNode[]
      const root = parsed.find((n) => nameOf(n) === 'Types')
      for (const node of root ? findChildren(root, 'Default') : []) {
        const attrs = attrsOf(node)
        const ext = attrs['Extension']?.toLowerCase()
        if (ext && attrs['ContentType']) defaults.set(ext, attrs['ContentType'])
      }
      for (const node of root ? findChildren(root, 'Override') : []) {
        const attrs = attrsOf(node)
        if (attrs['PartName'] && attrs['ContentType'])
          overrides.set(attrs['PartName'], attrs['ContentType'])
      }
      return { defaults, overrides }
    })()
    contentTypesCache.set(zip, cached)
  }
  return cached
}

/**
 * Mime for an image part: extension table first, then [Content_Types].xml
 * Override/Default — covers parts with opaque extensions (media/*.bin).
 */
export async function imagePartMime(zip: JSZip, path: string): Promise<string | undefined> {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const fromExt = IMAGE_MIME[ext]
  if (fromExt) return fromExt
  const { defaults, overrides } = await contentTypesOf(zip)
  const fromPart = overrides.get(`/${path}`) ?? defaults.get(ext)
  return fromPart?.startsWith('image/') ? fromPart : undefined
}

/** resolve an image relationship id to a data URL (embedded parts only) */
export async function mediaDataUrl(
  zip: JSZip,
  rels: Map<string, RelInfo>,
  rId: string,
  sourcePath = 'word/document.xml',
): Promise<string | null> {
  const rel = rels.get(rId)
  if (!rel || rel.targetMode === 'External') return null
  const partPath = resolveRelationshipTargetPath(sourcePath, rel.target)
  return partPath ? mediaPartDataUrl(zip, partPath) : null
}

/** one string per media part: a picture anchored on thousands of paragraphs
 * (pdf2docx output) otherwise holds thousands of base64 copies and OOMs the renderer */
const mediaDataUrlCache = new WeakMap<JSZip, Map<string, Promise<string | null>>>()

export function mediaPartDataUrl(zip: JSZip, partPath: string): Promise<string | null> {
  let cache = mediaDataUrlCache.get(zip)
  if (!cache) mediaDataUrlCache.set(zip, (cache = new Map()))
  let pending = cache.get(partPath)
  if (!pending) {
    pending = readMediaPartDataUrl(zip, partPath)
    cache.set(partPath, pending)
  }
  return pending
}

async function readMediaPartDataUrl(zip: JSZip, partPath: string): Promise<string | null> {
  const file = zip.file(partPath)
  if (!file) return null
  const mime = await imagePartMime(zip, partPath)
  if (!mime) return null
  if (isMetafileMime(mime)) return metafileToDataUrl(await file.async('arraybuffer'), mime)
  if (isTiffMime(mime)) return tiffToDataUrlAsync(await file.async('arraybuffer'))
  return inlineMediaDataUrl(file, mime)
}

/** picture URL for a media part: the bytes are inlined, so the renderer needs no
 *  server and no custom scheme to display the picture */
export async function inlineMediaDataUrl(file: JSZipObject, mime: string): Promise<string> {
  return `data:${mime};base64,${await file.async('base64')}`
}

/** resolve a document rel to its zip path ("word/…"), or null for external targets */
export function relPartPath(ctx: BuildContext, rId: string | undefined): string | null {
  const rel = rId ? ctx.rels.get(rId) : undefined
  if (!rel || rel.targetMode === 'External') return null
  return resolveRelationshipTargetPath(ctx.sourcePath ?? 'word/document.xml', rel.target)
}
