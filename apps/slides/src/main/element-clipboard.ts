import { clipboard, nativeImage, ClipboardItem } from 'electron'

export const ELEMENT_CLIPBOARD_FORMAT = 'io.yiioffice.slides.elements'

export type ElementClipboardIdentity = { token: string; senderId: number }

const MAX_TOKEN_LENGTH = 256
const MAX_PNG_BASE64_LENGTH = 40 * 1024 * 1024

/**
 * Electron 45 dropped the synchronous clipboard accessors (readBuffer/readHTML/
 * writeBuffer/readImage/availableFormats): reads are W3C-shaped promises over
 * ClipboardItem entries, one MIME type at a time. Raw OS formats are addressed
 * through the `electron application/osclipboard;format="…"` custom format.
 */
type ClipboardEntry = { readonly types: readonly string[]; getType(type: string): Promise<Blob> }

function rawFormatMime(format: string): string {
  return `electron application/osclipboard;format="${format}"`
}

async function readEntries(): Promise<ClipboardEntry[]> {
  try {
    return (await clipboard.read()) as unknown as ClipboardEntry[]
  } catch {
    // No clipboard owner, or the platform refused the read: treat as empty.
    return []
  }
}

async function readEntryText(type: string): Promise<string | null> {
  for (const entry of await readEntries()) {
    if (!entry.types.includes(type)) continue
    try {
      // Custom-format entries resolve to a string on some platforms despite the
      // Blob-typed signature; handle both shapes.
      const value = (await entry.getType(type)) as unknown
      if (typeof value === 'string') return value
      return await (value as Blob).text()
    } catch {
      return null
    }
  }
  return null
}

export function isElementClipboardToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
}

/** Writes a raw-format marker the OS clipboard keeps until another app copies something. */
export async function writeClipboardRawMarker(format: string, value: string): Promise<void> {
  try {
    await clipboard.write([new ClipboardItem({ [rawFormatMime(format)]: value })])
  } catch {
    /* clipboard busy or unsupported format: the marker is an optimization only */
  }
}

/** Whether the raw-format marker written by {@link writeClipboardRawMarker} is still present. */
export async function clipboardRawMarkerPresent(format: string): Promise<boolean> {
  return (await readEntryText(rawFormatMime(format))) !== null
}

async function markerTokenMatches(token: string): Promise<boolean> {
  return (await readEntryText(rawFormatMime(ELEMENT_CLIPBOARD_FORMAT))) === token
}

async function markerHtmlMatches(token: string): Promise<boolean> {
  try {
    const html = await readEntryText('text/html')
    if (html === null) return false
    const encodedToken = encodeURIComponent(token)
    const images = html.matchAll(/<img\b[^>]*\bdata-yiioffice-slides-elements\s*=\s*"([^"]*)"[^>]*>/gi)
    return [...images].some((match) => match[1] === encodedToken)
  } catch {
    return false
  }
}

/** Whether the OS clipboard still belongs to the supplied element-copy token. */
export async function elementClipboardMarkerMatches(token: string): Promise<boolean> {
  if (!isElementClipboardToken(token)) return false
  return (await markerTokenMatches(token)) || (await markerHtmlMatches(token))
}

/** Prevent a delayed renderer PNG from replacing a later copy or an external clipboard change. */
export async function canWriteElementClipboardImage(
  current: ElementClipboardIdentity | null,
  senderId: number,
  token: unknown,
): Promise<boolean> {
  if (
    !isElementClipboardToken(token) ||
    current?.senderId !== senderId ||
    current.token !== token
  ) {
    return false
  }
  return elementClipboardMarkerMatches(token)
}

/** Clipboard plain text, or '' when the clipboard holds none / cannot be read. */
export async function readClipboardText(): Promise<string> {
  try {
    return await clipboard.readText()
  } catch {
    return ''
  }
}

/** Whether the clipboard carries bitmap data (probe for menu enablement; no decode). */
export async function clipboardHasImage(): Promise<boolean> {
  const entries = await readEntries()
  return entries.some((entry) => entry.types.some((type) => type.startsWith('image/')))
}

/** Clipboard bitmap as a NativeImage, or null when absent / undecodable. */
export async function readClipboardImage(): Promise<Electron.NativeImage | null> {
  for (const entry of await readEntries()) {
    const type = entry.types.find((candidate) => candidate.startsWith('image/'))
    if (!type) continue
    try {
      const blob = await entry.getType(type)
      const bytes = Buffer.from(await blob.arrayBuffer())
      const image = nativeImage.createFromBuffer(bytes)
      if (!image.isEmpty()) return image
    } catch {
      return null
    }
  }
  return null
}

function decodePngBase64(pngBase64: unknown): Buffer | null {
  if (
    typeof pngBase64 !== 'string' ||
    pngBase64.length === 0 ||
    pngBase64.length > MAX_PNG_BASE64_LENGTH ||
    pngBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(pngBase64)
  ) {
    return null
  }
  const bytes = Buffer.from(pngBase64, 'base64')
  return bytes.length ? bytes : null
}

/** Writes a standard image and an HTML marker together so external apps can paste the image. */
export async function writeElementClipboardImage(token: string, pngBase64: unknown): Promise<boolean> {
  if (!isElementClipboardToken(token)) return false
  const bytes = decodePngBase64(pngBase64)
  if (!bytes) return false
  try {
    const decoded = nativeImage.createFromBuffer(bytes)
    if (decoded.isEmpty()) return false
    const normalizedPng = decoded.toPNG()
    if (!normalizedPng.length) return false
    const html = `<img src="data:image/png;base64,${normalizedPng.toString('base64')}" data-yiioffice-slides-elements="${encodeURIComponent(token)}">`
    if (!(await elementClipboardMarkerMatches(token))) return false
    // @ts-expect-error Electron ClipboardItem accepts NativeImage for image/png
    await clipboard.write([new ClipboardItem({ 'image/png': decoded }), new ClipboardItem({ 'text/html': html })])
    return true
  } catch {
    return false
  }
}
