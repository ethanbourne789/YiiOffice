// @vitest-environment jsdom
// localImage reaches the shared locale module, whose bridge import touches
// `window` at module load.
import { describe, expect, it } from 'vitest'
import { LOCAL_ASSET_PATH, resolveImageSrc, unresolveImageSrc } from './localImage'

/**
 * The display URL for a local picture is the app's own /md-asset route: the
 * editor stores the authored path and renders this, and parsing maps it back so
 * the route URL never reaches the .md file.
 */
describe('resolveImageSrc', () => {
  it('maps a path relative to the note onto the asset route', () => {
    const url = resolveImageSrc('assets/photo.png', '/notes/today')
    expect(url).toBe(`${LOCAL_ASSET_PATH}?p=${encodeURIComponent('/notes/today/assets/photo.png')}`)
  })

  it('keeps an absolute path absolute', () => {
    expect(resolveImageSrc('/home/u/a.png')).toBe(
      `${LOCAL_ASSET_PATH}?p=${encodeURIComponent('/home/u/a.png')}`,
    )
  })

  it('normalises a Windows drive path to forward slashes', () => {
    expect(resolveImageSrc('C:\\notes\\a b.png')).toBe(
      `${LOCAL_ASSET_PATH}?p=${encodeURIComponent('C:/notes/a b.png')}`,
    )
  })

  it('leaves data, http and empty sources alone', () => {
    expect(resolveImageSrc('data:image/png;base64,AA')).toBe('data:image/png;base64,AA')
    expect(resolveImageSrc('https://x/y.png')).toBe('https://x/y.png')
    expect(resolveImageSrc('')).toBe('')
  })

  it('does not invent a route without a base directory', () => {
    expect(resolveImageSrc('assets/photo.png', null)).toBe('assets/photo.png')
  })
})

describe('unresolveImageSrc', () => {
  it('round-trips a relative source back to the authored value', () => {
    const url = resolveImageSrc('assets/photo.png', '/notes/today')
    expect(unresolveImageSrc(url, '/notes/today')).toBe('assets/photo.png')
  })

  it('round-trips a Windows drive path', () => {
    const url = resolveImageSrc('C:\\notes\\a b.png')
    expect(unresolveImageSrc(url, 'C:\\notes')).toBe('a b.png')
  })

  it('ignores sources that are not asset URLs', () => {
    expect(unresolveImageSrc('assets/photo.png', '/notes')).toBe('assets/photo.png')
    expect(unresolveImageSrc('data:image/png;base64,AA', '/notes')).toBe('data:image/png;base64,AA')
  })

  // Documents written before the route existed carry the old scheme in their
  // HTML; parsing one must not bake it into the source.
  it('recovers the path from the legacy md-asset:// form', () => {
    expect(unresolveImageSrc('md-asset:///C:/notes/a.png', 'C:\\notes')).toBe('a.png')
    expect(unresolveImageSrc('md-asset:///home/u/a.png', '/home/u')).toBe('a.png')
  })

  it('tolerates a malformed escape instead of throwing', () => {
    const broken = `${LOCAL_ASSET_PATH}?p=%E0%A4%A`
    expect(unresolveImageSrc(broken, '/notes')).toBe(broken)
  })
})
