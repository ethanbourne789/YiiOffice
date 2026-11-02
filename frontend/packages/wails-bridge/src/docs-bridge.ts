// Thin wrapper over the official Wails V3 generated DocsService bindings.
import {
  OpenPath,
  Save,
  SaveAs,
  PickImage,
  SaveImageAs,
  OpenDocx,
  OpenDocxPath,
  OpenDocxDecrypt,
  SaveDocx,
  SaveDocxAs,
  SaveDocxNew,
  SaveDocxTo,
  WriteRecoveryCopy,
  GetSystemLocale,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/docsservice'
import { currentTabPath } from './tabs-bridge'

/** Opens a docs file and returns its base64-encoded content. */
export function docsOpenPath(path: string): Promise<string> {
  return OpenPath(path)
}

/** Atomically saves base64 content to the given path. */
export function docsSave(path: string, content: string): Promise<void> {
  return Save(path, content)
}

/** Atomically saves base64 content to a new path and returns the path. */
export function docsSaveAs(path: string, content: string): Promise<string> {
  return SaveAs(path, content)
}

/** Opens the native image picker; null when the user cancels. */
export async function docsPickImage(): Promise<{ base64: string; mime: string; name: string } | null> {
  const picked = await PickImage()
  return picked ? (picked as { base64: string; mime: string; name: string }) : null
}

/** Writes an editor image (path or data URL) to a user-chosen file. */
export function docsSaveImageAs(
  src: string,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  return SaveImageAs(src)
}

// ─── Docs editor docx-specific file I/O ─────────────────────────────

/**
 * Go hands a docx back as `{path, base64}`; the docs renderer still expects the
 * shape its Electron preload produced — `{path, name, dataUrl, hash}` — and
 * calls `fetch(result.dataUrl)` on it. Passing the raw Go struct through made
 * every opened file fetch `undefined` (blank document, or "zip: end of central
 * directory not found").
 */
interface GoDocxOpenResult {
  path?: string
  base64?: string
  error?: string
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** sha256 of the original file, the key the doc cache archives originals under. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle) return ''
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function toOpenFileResult(raw: unknown): Promise<unknown> {
  const result = (raw ?? {}) as GoDocxOpenResult
  const path = typeof result.path === 'string' ? result.path : ''
  const base64 = typeof result.base64 === 'string' ? result.base64 : ''
  if (!path || !base64) return null
  const bytes = base64ToBytes(base64)
  // A blob URL keeps the handoff out of the URL length limit a data: URL would
  // hit on image-heavy documents; the renderer fetches it once, right after the
  // open, so it can be released shortly after.
  const dataUrl = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }))
  setTimeout(() => URL.revokeObjectURL(dataUrl), 10_000)
  return {
    path,
    name: path.split(/[\\/]/).pop() || path,
    dataUrl,
    hash: await sha256Hex(bytes),
  }
}

export async function docsOpenDocx(): Promise<any> {
  return toOpenFileResult(await OpenDocx())
}

export async function docsOpenDocxPath(path: string): Promise<any> {
  return toOpenFileResult(await OpenDocxPath(path))
}

export async function docsConsumePendingOpenDocx(): Promise<any> {
  // The shell opens a file by creating a tab: HomeService.OpenPath stores the
  // path on the tab, so this renderer resolves it through the tab host the same
  // way slides and markdown do.
  const path = await currentTabPath()
  if (path) return toOpenFileResult(await OpenDocxPath(path))
  return null
}

export function docsOpenDocxDecrypt(path: string, password: string): Promise<any> {
  return OpenDocxDecrypt(path, password)
}

export function docsSaveDocx(path: string, content: string, auto: boolean): Promise<any> {
  return SaveDocx(path, content, auto)
}

export function docsSaveDocxAs(suggestedName: string, content: string, srcPath: string): Promise<any> {
  return SaveDocxAs(suggestedName, content, srcPath)
}

export function docsSaveDocxNew(suggestedName: string, content: string): Promise<any> {
  return SaveDocxNew(suggestedName, content)
}

export function docsSaveDocxTo(path: string, content: string, overwrite: boolean): Promise<any> {
  return SaveDocxTo(path, content, overwrite)
}

export function docsWriteRecoveryCopy(path: string, content: string): Promise<void> {
  return WriteRecoveryCopy(path, content)
}

export function docsGetSystemLocale(): Promise<string> {
  return GetSystemLocale()
}