import { readFileSync } from 'node:fs'
import { writeJsonAtomic } from './atomic-write'

/**
 * Drop the bring-your-own image host entry (yiioffice#388) from the Markdown
 * settings file. That feature is gone, and its credentials were stored in this
 * file in plaintext — nothing would ever rewrite them now, so they would sit on
 * disk forever. A missing file, an unreadable one or a missing key is not an
 * error.
 */
export function dropImageHostSetting(path: string): void {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const settings = raw as Record<string, unknown>
  if (!('imageHost' in settings)) return
  delete settings.imageHost
  writeJsonAtomic(path, settings)
}
