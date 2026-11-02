import { test, expect } from '../../fixtures/app'
import { writeText } from '../../fixtures/documents'

/**
 * Markdown editor: the file has to be parsed into a document (headings, lists,
 * tables), not shown as raw text. A parser regression that renders a flat
 * paragraph still "passes" a toContainText check, so the assertions target the
 * block structure.
 */

test.describe('markdown: rendering', () => {
  test('a heading, a list and a table render as their blocks', async ({ app }) => {
    const path = await writeText(
      app.workDir,
      'structure.md',
      '# Heading One\n\n- item a\n- item b\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    )
    const editor = await app.openFile(path, { kind: 'markdown', title: 'structure.md' })

    const page = editor.ui.locator('.doc-page').first()
    await expect(page.locator('h1')).toHaveText('Heading One')
    await expect(page.locator('ul li')).toHaveCount(2)
    await expect(page.locator('table th')).toHaveCount(2)
    await expect(page.locator('table td')).toHaveCount(2)
  })

  test('inline markup becomes emphasis inside the paragraph', async ({ app }) => {
    const path = await writeText(app.workDir, 'inline.md', 'plain **bold** and `code`\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    const page = editor.ui.locator('.doc-page').first()
    await expect(page.locator('strong')).toHaveText('bold')
    await expect(page.locator('code')).toHaveText('code')
    // The markers themselves must not survive into the rendered text.
    await expect(page).not.toContainText('**bold**')
  })
})

test.describe('markdown: code and quotes', () => {
  test('a fenced block renders as preformatted code', async ({ app }) => {
    const path = await writeText(app.workDir, 'code.md', '```js\nconst x = 1\n```\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    const code = editor.ui.locator('.doc-page pre code')
    await expect(code).toContainText('const x = 1')
  })

  test('a quoted line renders as a blockquote', async ({ app }) => {
    const path = await writeText(app.workDir, 'quote.md', '> quoted line\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    await expect(editor.ui.locator('.doc-page blockquote')).toContainText('quoted line')
  })
})

test.describe('markdown: block structure', () => {
  test('a second-level heading keeps its level', async ({ app }) => {
    const path = await writeText(app.workDir, 'h2.md', '## Section Two\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    await expect(editor.ui.locator('.doc-page h2')).toHaveText('Section Two')
  })

  test('an ordered list renders as <ol>', async ({ app }) => {
    const path = await writeText(app.workDir, 'ordered.md', '1. first\n2. second\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    await expect(editor.ui.locator('.doc-page ol li')).toHaveCount(2)
  })

  test('a link renders as an anchor with its href', async ({ app }) => {
    const path = await writeText(app.workDir, 'link.md', '[docs](https://example.com/doc)\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    const link = editor.ui.locator('.doc-page a', { hasText: 'docs' })
    await expect(link).toHaveAttribute('href', 'https://example.com/doc')
  })

  test('a horizontal rule renders as <hr>', async ({ app }) => {
    const path = await writeText(app.workDir, 'rule.md', 'above\n\n---\n\nbelow\n')
    const editor = await app.openFile(path, { kind: 'markdown' })

    await expect(editor.ui.locator('.doc-page hr')).toHaveCount(1)
  })
})
