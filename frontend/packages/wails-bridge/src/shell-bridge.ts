// Thin wrapper over the official Wails V3 generated bindings for the shared
// ShellService. Keeps generated files out of editor-api.ts while exposing the
// exact same surface via focused functions.
import { OpenExternal, ReadLocalImage } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/shellservice'
import { CheckNow } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/update/service'
import type { LatestRelease } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/update/models'

/** Opens an external URL through the Go shell service (validated + system browser). */
export function shellOpenExternal(url: string): Promise<void> {
  return OpenExternal(url)
}

/** Reads a local image file and returns it as a base64 data string. */
export function shellReadLocalImage(path: string): Promise<string> {
  return ReadLocalImage(path)
}

/**
 * Runs one read-only update check against the release feed. Nothing is
 * downloaded or installed; the response status is "latest",
 * "update-available", "incomparable" or "error".
 */
export function shellCheckLatestRelease(): Promise<LatestRelease | null> {
  return CheckNow()
}