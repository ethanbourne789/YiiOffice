import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dropImageHostSetting } from '../src/main/markdown-settings'

/**
 * The bring-your-own image host is gone, but its credentials were stored in
 * userData/markdown-settings.json in plaintext. Nothing would rewrite that
 * file again, so the leftover entry has to be dropped on startup.
 */
describe('dropping the stale image host setting', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yiioffice-md-settings-'))
    file = join(dir, 'markdown-settings.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('removes the imageHost entry and keeps the other settings', async () => {
    await writeFile(
      file,
      JSON.stringify({ imageHost: { kind: 's3', secretAccessKey: 'shhh' }, theme: 'dark' }),
      'utf8',
    )
    dropImageHostSetting(file)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved).toEqual({ theme: 'dark' })
  })

  it('leaves the file untouched when there is no image host entry', async () => {
    const original = JSON.stringify({ theme: 'dark' })
    await writeFile(file, original, 'utf8')
    dropImageHostSetting(file)
    expect(await readFile(file, 'utf8')).toBe(original)
  })

  it('does not fail when the settings file is missing or corrupt', async () => {
    // no file at all
    expect(() => dropImageHostSetting(file)).not.toThrow()
    // corrupt JSON
    await writeFile(file, '{not json', 'utf8')
    expect(() => dropImageHostSetting(file)).not.toThrow()
  })
})
