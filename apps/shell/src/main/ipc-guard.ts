/// One gate for every IPC entry point the shell exposes.
///
/// A renderer is untrusted by default: the editors host user documents and AI
/// output, and any of them can `invoke` an arbitrary channel by name. Before
/// this module existed none of the shell's handlers looked at who was calling
/// — a renderer that got a foothold could rename, move, trash or reveal any
/// path the shell could (audit 2026-10-26, item 6). Registration now goes
/// through `handleFromShell` / `onFromShell`, which reject a frame whose
/// `url` is not one of the renderers this app itself loads:
///
///   - `yiioffice-app://<module>/…` — the built editor renderers (packaged)
///   - `http(s)://localhost[:port]/…` — the dev server equivalents
///   - `file://…` inside the app root — the shell's own renderer and the
///     pdf-password page, both loaded straight from disk
///
/// Scheme + host is the whole check (plus the app-root containment for
/// `file:`), so a second app, a remote page, or a renderer that navigated
/// itself somewhere else can no longer reach these handlers.

import { app, ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** the dev server is the only http origin a renderer may come from */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** path containment that works for both separators and never crosses the root */
function isInside(root: string, filePath: string): boolean {
  const rel = relative(root, filePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Pure trust decision for a frame URL, exported so tests can pin the table
 * without building an Electron app. `appRoot` is the directory the app's own
 * renderer files live under (`app.getAppPath()`).
 */
export function isTrustedRendererUrl(url: string, appRoot: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'yiioffice-app:') return true
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return LOCAL_HOSTS.has(parsed.hostname)
  }
  if (parsed.protocol === 'file:') {
    // a file:// frame is only ours while it stays inside the app's own files
    try {
      return isInside(resolve(appRoot), fileURLToPath(parsed))
    } catch {
      return false
    }
  }
  return false
}

function frameIsTrusted(frame: WebFrameMain | null): boolean {
  return !!frame && isTrustedRendererUrl(frame.url, app.getAppPath())
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any
type SendListener = (event: IpcMainEvent, ...args: any[]) => void

/** `ipcMain.handle`, but only for frames this app loaded */
export function handleFromShell(channel: string, handler: InvokeHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!frameIsTrusted(event.senderFrame)) {
      console.warn('[shell] rejected IPC from untrusted frame:', channel, event.senderFrame?.url)
      throw new Error(`untrusted sender frame for ${channel}`)
    }
    return handler(event, ...args)
  })
}

/** `ipcMain.on`, same gate: the chrome-press / drag relays are not a back door */
export function onFromShell(channel: string, listener: SendListener): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!frameIsTrusted(event.senderFrame)) {
      console.warn('[shell] rejected IPC from untrusted frame:', channel, event.senderFrame?.url)
      return
    }
    listener(event, ...args)
  })
}
