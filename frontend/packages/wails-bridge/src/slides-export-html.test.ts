import { describe, expect, it } from 'vitest'
import { buildSlidesExportHtml, slidePageSizeInches } from './slides-export-html'

const SVG1 = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/></svg>'

describe('slidePageSizeInches', () => {
  it('converts CSS px to inches at 96 dpi', () => {
    expect(slidePageSizeInches(1280, 720)).toEqual({ widthIn: 1280 / 96, heightIn: 720 / 96 })
  })
})

describe('buildSlidesExportHtml', () => {
  const op = {
    pages: [{ svg: SVG1 }, { png: 'aGVsbG8=' }],
    widthPx: 1280,
    heightPx: 720,
    links: [
      [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, href: 'https://example.com/?a=1&b=2' }],
      [{ x: 0, y: 0, w: 1, h: 1, href: '#pg1' }],
    ],
    fontCss: '@font-face{font-family:X;src:url(data:font/woff2;base64,AAA)}',
  }
  const html = buildSlidesExportHtml(op)

  it('emits a literal <head> so withPageCSS can inject the @page rule', () => {
    expect(html).toContain('<head>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('lays one fixed-size page box per page with 1-based pgN ids', () => {
    expect(html).toContain('<div class="slide-page" id="pg1">')
    expect(html).toContain('<div class="slide-page" id="pg2">')
    expect(html).toContain('.slide-page{position:relative;overflow:hidden;width:1280px;height:720px')
    expect(html).toContain('page-break-after:always')
    expect(html).toContain('.slide-page:last-child{page-break-after:auto')
  })

  it('inlines SVG pages verbatim and wraps PNG pages in a data URL img', () => {
    expect(html).toContain(SVG1)
    expect(html).toContain('<img src="data:image/png;base64,aGVsbG8=" alt="">')
  })

  it('places link overlays as percent-positioned transparent anchors', () => {
    expect(html).toContain('left:10%;top:20%;width:30%;height:40%')
    expect(html).toContain('href="#pg1"')
  })

  it('attribute-escapes hrefs', () => {
    expect(html).toContain('https://example.com/?a=1&amp;b=2')
    expect(html).not.toContain('href="https://example.com/?a=1&b=2"')
  })

  it('carries the font CSS into the page style block', () => {
    expect(html).toContain('@font-face{font-family:X;src:url(data:font/woff2;base64,AAA)}')
  })

  it('omits link markup when a page has no links', () => {
    const bare = buildSlidesExportHtml({ pages: [{ svg: SVG1 }], widthPx: 960, heightPx: 540 })
    expect(bare).not.toContain('slide-link"')
    expect(bare).toContain('width:960px;height:540px')
  })

  it('falls back to an empty PNG page without throwing', () => {
    const html2 = buildSlidesExportHtml({ pages: [{ png: '' }], widthPx: 100, heightPx: 50 })
    expect(html2).toContain('<img src="data:image/png;base64," alt="">')
  })
})
