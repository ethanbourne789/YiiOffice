/**
 * Custom editor commands for the Docs Ribbon toolbar.
 *
 * Registers setParagraphAttrs, stepHangingIndent, stepIndent, unsetList, and
 * toggleListItem as proper TipTap chain commands with full type safety.
 */
import { Extension } from '@tiptap/core'
import type { ChainedCommands, RawCommands } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'

// ── TypeScript module augmentation ──────────────────────────────────────────

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docEditor: {
      /** Apply paragraph-level attrs to every block in the selection. */
      setParagraphAttrs: (attrs: Record<string, unknown>) => ReturnType
      /** Word Ctrl+T / Ctrl+Shift+T: shift hanging indent by one stop. */
      stepHangingIndent: (delta: number) => ReturnType
      /** Ribbon indent: list items change level; paragraphs snap to next stop. */
      stepIndent: (delta: number) => ReturnType
      /** Remove list formatting, convert list items to paragraphs. */
      unsetList: () => ReturnType
      /** Toggle a list item with the given kind and numbering definition. */
      toggleListItem: (options: {
        kind: 'bullet' | 'ordered'
        numId: string
        level: number
      }) => ReturnType
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Block node names that carry paragraph-level attributes */
const PARA_BLOCK_NAMES = new Set(['docParagraph', 'docHeading', 'docListItem'])

/** Collect every top-level block position covered by a range */
function paraPositionsInRange(
  doc: EditorState['doc'],
  from: number,
  to: number,
): number[] {
  const positions: number[] = []
  doc.nodesBetween(from, to, (node, p, parent) => {
    if (parent && PARA_BLOCK_NAMES.has(node.type.name)) {
      positions.push(p)
    }
    return false
  })
  return positions
}

// ── Command implementations ─────────────────────────────────────────────────

function setParagraphAttrsCommand(attrs: Record<string, unknown>) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const { from, to } = state.selection
    const changed: [number, Record<string, unknown>][] = []

    for (const pos of paraPositionsInRange(state.doc, from, to)) {
      const node = state.doc.nodeAt(pos)
      if (node && PARA_BLOCK_NAMES.has(node.type.name)) {
        const newAttrs = { ...node.attrs, ...attrs }
        // Strip null values (they mean "clear the attribute")
        for (const key of Object.keys(attrs)) {
          if (attrs[key] === null) delete newAttrs[key]
        }
        if (JSON.stringify(newAttrs) !== JSON.stringify(node.attrs)) {
          changed.push([pos, newAttrs])
        }
      }
    }

    if (changed.length === 0) return false

    if (dispatch) {
      for (const [pos, newAttrs] of changed) {
        dispatch(state.tr.setNodeMarkup(pos, undefined, newAttrs))
      }
    }
    return true
  }
}

function stepHangingIndentCommand(delta: number) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const HALF_INCH_TWIPS = 360
    const { from, to } = state.selection
    let didChange = false

    if (!dispatch) return false

    for (const pos of paraPositionsInRange(state.doc, from, to)) {
      const node = state.doc.nodeAt(pos)
      if (node && PARA_BLOCK_NAMES.has(node.type.name)) {
        const current = (node.attrs.hangingIndent as number) ?? 0
        const next = Math.max(0, current + delta * HALF_INCH_TWIPS)
        if (next !== current) {
          dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              hangingIndent: next,
            }),
          )
          didChange = true
        }
      }
    }
    return didChange
  }
}

function stepIndentCommand(delta: number) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const HALF_INCH_TWIPS = 360

    if (!dispatch) return false

    const { from, to } = state.selection
    let didChange = false

    for (const pos of paraPositionsInRange(state.doc, from, to)) {
      const node = state.doc.nodeAt(pos)
      if (!node || !PARA_BLOCK_NAMES.has(node.type.name)) continue

      if (node.type.name === 'docListItem') {
        // List items: change list level
        const ilvl = (node.attrs.ilvl as number) ?? 0
        const next = Math.max(0, ilvl + delta)
        if (next !== ilvl) {
          dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              ilvl: next,
            }),
          )
          didChange = true
        }
      } else {
        // Paragraphs and headings: snap indent to next half-inch stop
        const current = (node.attrs.indentLeft as number) ?? 0
        const next = Math.max(0, current + delta * HALF_INCH_TWIPS)
        if (next !== current) {
          dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indentLeft: next,
            }),
          )
          didChange = true
        }
      }
    }
    return didChange
  }
}

function unsetListCommand() {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const { from, to } = state.selection
    let didChange = false

    if (!dispatch) return false

    for (const pos of paraPositionsInRange(state.doc, from, to)) {
      const node = state.doc.nodeAt(pos)
      if (node && node.type.name === 'docListItem') {
        // Convert list item to paragraph, preserving content and paragraph attrs
        const paraAttrs: Record<string, unknown> = {
          styleId: node.attrs.styleId ?? null,
          indentLeft: node.attrs.indentLeft ?? null,
          indentFirstLine: node.attrs.indentFirstLine ?? null,
          hangingIndent: node.attrs.hangingIndent ?? null,
          align: node.attrs.align ?? null,
        }
        // Remove nulls
        for (const key of Object.keys(paraAttrs)) {
          if (paraAttrs[key] === null) delete paraAttrs[key]
        }

        dispatch(
          state.tr.setNodeMarkup(
            pos,
            state.schema.nodes.docParagraph,
            paraAttrs,
          ),
        )
        didChange = true
      }
    }
    return didChange
  }
}

function toggleListItemCommand(options: {
  kind: 'bullet' | 'ordered'
  numId: string
  level: number
}) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const { from, to } = state.selection
    let didChange = false

    if (!dispatch) return false

    for (const pos of paraPositionsInRange(state.doc, from, to)) {
      const node = state.doc.nodeAt(pos)
      if (!node) continue

      if (PARA_BLOCK_NAMES.has(node.type.name) && node.type.name !== 'docListItem') {
        // Convert paragraph/heading to list item
        dispatch(
          state.tr.setNodeMarkup(pos, state.schema.nodes.docListItem, {
            ...node.attrs,
            numId: node.type.name === 'docListItem' ? node.attrs.numId : options.numId,
            ilvl: options.level,
          }),
        )
        didChange = true
      } else if (node.type.name === 'docListItem') {
        // Update existing list item attrs
        dispatch(
          state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            numId: options.numId,
            ilvl: options.level,
          }),
        )
        didChange = true
      }
    }
    return didChange
  }
}

// ── Extension ───────────────────────────────────────────────────────────────

export const DocEditorCommands = Extension.create({
  name: 'docEditorCommands',

  addCommands() {
    return {
      setParagraphAttrs: setParagraphAttrsCommand,
      stepHangingIndent: stepHangingIndentCommand,
      stepIndent: stepIndentCommand,
      unsetList: unsetListCommand,
      toggleListItem: toggleListItemCommand,
    } as Partial<RawCommands>
  },
})

// ── Extended chain type for consumers ───────────────────────────────────────

export interface DocEditorChainedCommands extends ChainedCommands {
  setParagraphAttrs(attrs: Record<string, unknown>): ChainedCommands
  stepHangingIndent(delta: number): ChainedCommands
  stepIndent(delta: number): ChainedCommands
  unsetList(): ChainedCommands
  toggleListItem(options: {
    kind: 'bullet' | 'ordered'
    numId: string
    level: number
  }): ChainedCommands
}