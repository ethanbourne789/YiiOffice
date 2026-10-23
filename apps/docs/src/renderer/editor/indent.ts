import type { Editor } from '@tiptap/core'

/** Word's Ctrl+T / Ctrl+Shift+T: hanging indent one half-inch stop out or back */
export function stepHangingIndent(editor: Editor, delta: 1 | -1): boolean {
  return (editor.chain() as any).focus().stepHangingIndent(delta).run()
}

/** Ribbon increase/decrease indent: list items change level, paragraphs and headings snap to the next half-inch stop */
export function stepParagraphIndent(editor: Editor, delta: 1 | -1): boolean {
  return (editor.chain() as any).focus().stepIndent(delta).run()
}
