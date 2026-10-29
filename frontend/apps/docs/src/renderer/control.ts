import type { Editor } from '@tiptap/core'

/** Request/reply the shell relays from `yiioffice open --block` and `yiioffice selection`. */
export type ControlRequest =
  { cmd: 'goto'; target: { kind: string; block?: number } } | { cmd: 'selection' }

export type ControlReply =
  | { status: 'ok'; result: Record<string, unknown> }
  | { status: 'not_ready' }
  | {
      status: 'error'
      error: { reason: string; message: string; detail?: Record<string, unknown> }
    }

export function handleDocsControl(
  req: ControlRequest,
  editor: Editor | null,
  loaded: boolean,
): ControlReply {
  if (!editor || !loaded) return { status: 'not_ready' }
  const doc = editor.state.doc
  if (req.cmd === 'selection') {
    const { from, to, empty } = editor.state.selection
    const lastIndex = doc.childCount - 1
    // a caret after the last node resolves to childCount; `to` is exclusive, so a
    // whole-paragraph selection ends on the next block's boundary
    const first = Math.min(doc.resolve(from).index(0), lastIndex)
    const last = empty ? first : Math.min(doc.resolve(Math.max(from, to - 1)).index(0), lastIndex)
    return {
      status: 'ok',
      result: {
        blocks: [first, Math.max(first, last)],
        text: empty ? '' : doc.textBetween(from, to, '\n'),
        collapsed: empty,
      },
    }
  }
  const { block } = req.target
  if (block === undefined || !Number.isInteger(block) || block < 0 || block >= doc.childCount) {
    return {
      status: 'error',
      error: {
        reason: 'out_of_range',
        message: `block ${block} is out of range (the document has ${doc.childCount} blocks)`,
        detail: { valid_range: `0-${doc.childCount - 1}` },
      },
    }
  }
  editor.commands.focus('start', { scrollIntoView: true })
  const pos = block * 1 // approximate: move caret near the target block
  editor.commands.setTextSelection(Math.min(pos, editor.state.doc.content.size))
  return { status: 'ok', result: { block, type: doc.child(block).type.name } }
}
