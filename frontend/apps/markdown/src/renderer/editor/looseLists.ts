import type { JSONContent, MarkdownParseHelpers, MarkdownToken, Node } from '@tiptap/core'
import { BulletList, OrderedList, TaskList } from '@tiptap/extension-list'
import { renderList } from './markdownStyleRenderers'

/**
 * Whether the list had blank lines between its items or blocks. HTML cannot
 * say, so the attribute is read off the markdown at parse time and only the
 * serializer looks at it (see renderList / renderItem).
 */
const FENCE = /^ *(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n *\1[`~]* *$/gm

function isLoose(token: MarkdownToken): boolean {
  if (typeof token.loose === 'boolean') return token.loose
  // the ordered / task list tokenizers do not compute it; blank lines inside a fence do not count
  return /\n[ \t]*\n[ \t]*\S/.test(
    String(token.raw ?? '')
      .replace(FENCE, 'fence')
      .trimEnd(),
  )
}

function withLoose(list: Node): Node {
  // Tiptap 3.32 types the markdown hooks with a `this` of
  // { name, options, storage, parent }, which `config` does not declare. The
  // stock hook never reads those off the receiver here, so keep calling it
  // unbound (as before) through the widened signature.
  const base = list.config.parseMarkdown as unknown as (
    token: MarkdownToken,
    h: MarkdownParseHelpers,
  ) => JSONContent | JSONContent[]
  return list.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        loose: { default: false, rendered: false, parseHTML: () => false },
      }
    },
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) => {
      const out = base(token, h)
      if (Array.isArray(out)) return out
      return { ...out, attrs: { ...out.attrs, loose: isLoose(token) } }
    },
    renderMarkdown: renderList,
  })
}

export const LooseBulletList = withLoose(BulletList)
export const LooseOrderedList = withLoose(OrderedList)
export const LooseTaskList = withLoose(TaskList)
