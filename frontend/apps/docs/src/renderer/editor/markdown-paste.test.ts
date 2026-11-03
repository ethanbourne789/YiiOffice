/**
 * Regression suite for the text/plain Markdown paste path.
 *
 * These assertions pin the structure the paste handler relies on: the output
 * must survive `cleanPastedHtml` + `DOMParser` and reproduce GFM structure
 * (tables, strikethrough, task items, nesting, code blocks) without carrying
 * executable markup into the document model.
 */
import { describe, expect, it } from 'vitest'
import { looksLikeMarkdown, markdownPasteHtml } from './markdown-paste'

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body
}

/** Convert, asserting the paste gate let it through. */
function convert(text: string): HTMLElement {
  const html = markdownPasteHtml(text)
  expect(html, 'paste gate must accept this fixture').not.toBeNull()
  return parse(html as string)
}

describe('looksLikeMarkdown', () => {
  it('leaves prose with a lone hash or number alone', () => {
    expect(looksLikeMarkdown('issue #12 is still open')).toBe(false)
    expect(looksLikeMarkdown('1. not a list, just a numbered sentence')).toBe(false)
  })

  it('accepts the strong signals', () => {
    expect(looksLikeMarkdown('## Heading')).toBe(true)
    expect(looksLikeMarkdown('```\ncode\n```')).toBe(true)
    expect(looksLikeMarkdown('[text](https://example.com)')).toBe(true)
    expect(looksLikeMarkdown('**bold**')).toBe(true)
    expect(looksLikeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
  })

  it('needs repetition for list and quote lines', () => {
    expect(looksLikeMarkdown('- one')).toBe(false)
    expect(looksLikeMarkdown('- one\n- two')).toBe(true)
    expect(looksLikeMarkdown('> quoted')).toBe(false)
    expect(looksLikeMarkdown('> quoted\n> again')).toBe(true)
  })
})

describe('markdownPasteHtml', () => {
  it('returns null for plain prose', () => {
    expect(markdownPasteHtml('just a sentence about #topics')).toBeNull()
  })

  it('converts ATX headings to the matching level', () => {
    const body = convert('# One\n\n## Two\n\n### Three')
    expect(body.querySelectorAll('h1,h2,h3')).toHaveLength(3)
    expect(body.querySelector('h1')?.textContent).toBe('One')
    expect(body.querySelector('h3')?.textContent).toBe('Three')
  })

  it('keeps GFM table header, separator and body cells', () => {
    const body = convert('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(body.querySelectorAll('table')).toHaveLength(1)
    expect(body.querySelectorAll('thead th')).toHaveLength(2)
    expect(body.querySelectorAll('tbody td')).toHaveLength(2)
    expect(body.querySelector('tbody td')?.textContent).toBe('1')
  })

  it('renders ~~strikethrough~~ as del', () => {
    const body = convert('~~gone~~ and **bold**')
    expect(body.querySelector('del')?.textContent).toBe('gone')
    expect(body.querySelector('strong')?.textContent).toBe('bold')
  })

  it('keeps task item state as a checkbox', () => {
    const body = convert('- [x] done\n- [ ] todo')
    expect(body.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    const boxes = Array.from(body.querySelectorAll('input[type="checkbox"]'))
    expect((boxes[0] as HTMLInputElement).hasAttribute('checked')).toBe(true)
    expect((boxes[1] as HTMLInputElement).hasAttribute('checked')).toBe(false)
  })

  it('keeps nested list depth', () => {
    const body = convert('- a\n  - b\n    - c')
    const depths = Array.from(body.querySelectorAll('li')).map((li) => {
      let depth = 0
      let node: HTMLElement | null = li
      while (node) {
        if (node.tagName === 'UL' || node.tagName === 'OL') depth++
        node = node.parentElement
      }
      return depth
    })
    expect(Math.max(...depths)).toBe(3)
  })

  it('keeps fenced code block language and literal text', () => {
    const body = convert('```ts\nconst x = 1 < 2\n```')
    const code = body.querySelector('pre > code')
    expect(code).not.toBeNull()
    expect(code?.className).toContain('language-ts')
    // the trailing newline inside <code> is part of the fence body
    expect(code?.textContent?.trimEnd()).toBe('const x = 1 < 2')
  })

  it('keeps ordered lists', () => {
    const body = convert('1. first\n2. second')
    expect(body.querySelectorAll('ol > li')).toHaveLength(2)
  })
})

describe('markdownPasteHtml sanitisation', () => {
  it('drops script elements', () => {
    const body = convert('<script>alert(1)</script>\n\n## After')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('h2')?.textContent).toBe('After')
  })

  it('drops a javascript: link target but keeps the text', () => {
    const body = convert('[click](javascript:alert(1))\n\n## After')
    const anchor = body.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBeNull()
    expect(anchor?.textContent).toBe('click')
  })

  it('keeps http link targets', () => {
    const body = convert('[ok](https://example.com)\n\n## After')
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})

/**
 * GFM edge cases pinned against the marked@18 baseline that shipped before the
 * @tiptap/markdown switch. All of these are DOM-equivalent to the baseline; the raw
 * HTML differs only in serialisation (`&` vs `&amp;` inside href, numeric vs
 * literal emoji, whitespace around block HTML). If these ever fail, the parser
 * changed semantics - do not relax them.
 */
describe('markdownPasteHtml GFM edge cases', () => {
  // bare URLs and entity-only text carry no strong signal, so each fixture
  // includes one (heading / `**bold**`) to reach the converter; that is also
  // what production paste sees when such lines accompany real Markdown.
  it('autolinks a bare URL and an email address', () => {
    const body = convert('## Links\n\nsee https://example.com/a?b=1&c=2 and mail@example.com now')
    const anchors = Array.from(body.querySelectorAll('a'))
    expect(anchors).toHaveLength(2)
    expect(anchors[0].getAttribute('href')).toBe('https://example.com/a?b=1&c=2')
    expect(anchors[0].textContent).toBe('https://example.com/a?b=1&c=2')
    expect(anchors[1].getAttribute('href')).toBe('mailto:mail@example.com')
    expect(anchors[1].textContent).toBe('mail@example.com')
  })

  it('leaves a bare URL without any other Markdown signal alone', () => {
    expect(markdownPasteHtml('see https://example.com/a?b=1&c=2 now')).toBeNull()
  })

  it('autolinks a bare www host', () => {
    const body = convert('## Links\n\nvisit www.example.com and http://example.com/x_y_.')
    expect(Array.from(body.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      'http://www.example.com',
      // GFM autolink stops before trailing "_.", which stays literal text
      'http://example.com/x_y',
    ])
    expect(body.textContent).toContain('http://example.com/x_y_.')
  })

  it('passes raw details/summary markup through with its block content', () => {
    const body = convert('<details><summary>Title</summary>\n\nBody **bold**\n\n</details>')
    const details = body.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.querySelector('summary')?.textContent).toBe('Title')
    expect(details?.querySelector('strong')?.textContent).toBe('bold')
  })

  it('decodes entities while keeping a literal less-than as text', () => {
    const body = convert(
      '## Entities\n\nA &amp; B &lt; C &copy; D &#128512; E and 5 &gt; 3, 2 < 3',
    )
    expect(body.textContent).toContain('A & B < C © D ')
    expect(body.textContent).toContain(String.fromCodePoint(0x1f600))
    expect(body.textContent).toContain('5 > 3, 2 < 3')
    // "2 < 3" must stay text: only the heading and the paragraph may exist
    expect(body.querySelectorAll('*')).toHaveLength(2)
  })

  it('keeps a table nested inside a list item', () => {
    const body = convert('- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |')
    const table = body.querySelector('li table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('thead th')).toHaveLength(2)
    expect(table?.querySelector('tbody td')?.textContent).toBe('1')
  })
})
