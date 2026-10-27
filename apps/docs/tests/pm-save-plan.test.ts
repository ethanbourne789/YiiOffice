import { describe, expect, it } from 'vitest'
import type { Block, SaveBlock } from '@yiioffice/docx-engine'
import { pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import {
  tableFormattingSignature,
  tableStructureSignature,
} from '../src/renderer/editor/pm-shared'

/**
 * `pmDocToSavePlan` decides, block by block, whether the parsed bytes can be
 * reused (`kind: 'original'`) or have to be regenerated (`kind: 'generated'`).
 * Every save of an untouched document rides on the first answer: a wrong
 * "changed" verdict rewrites XML the user never touched, a wrong "unchanged"
 * one drops an edit. These cases pin that decision grid down without a TipTap
 * editor, which is why the save direction was split out of convert.ts.
 */

const docOf = (...content: PmNode[]): PmNode => ({ type: 'doc', content })

const paraNode = (
  docxIndex: number | null,
  text: string,
  attrs: Record<string, unknown> = {},
): PmNode => ({
  type: 'docParagraph',
  attrs: { docxIndex, ...attrs },
  content: text ? [{ type: 'text', text }] : [],
})

const paraBlock = (docxIndex: number, text: string, extra: Partial<Block> = {}): Block => ({
  id: `b${docxIndex}`,
  type: 'paragraph',
  docxIndex,
  originalXml: null,
  runs: [{ text }],
  ...extra,
})

function generatedBlock(block: SaveBlock) {
  if (block.kind !== 'generated') throw new Error(`expected generated, got ${block.kind}`)
  return block.block
}

describe('pmDocToSavePlan block reuse', () => {
  it('keeps every untouched paragraph on its original bytes', () => {
    const original = [paraBlock(0, 'alpha'), paraBlock(1, 'beta')]
    const plan = pmDocToSavePlan(docOf(paraNode(0, 'alpha'), paraNode(1, 'beta')), original)

    expect(plan.saveBlocks).toEqual([
      { kind: 'original', docxIndex: 0 },
      { kind: 'original', docxIndex: 1 },
    ])
    expect(plan.changedCount).toBe(0)
    expect(plan.deletedCount).toBe(0)
    expect(plan.totalOriginal).toBe(2)
    expect([...plan.saveBlockIndexByDocx]).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it('regenerates only the paragraph whose text changed', () => {
    const original = [paraBlock(0, 'alpha'), paraBlock(1, 'beta')]
    const plan = pmDocToSavePlan(docOf(paraNode(0, 'alpha'), paraNode(1, 'beta edited')), original)

    expect(plan.saveBlocks[0]).toEqual({ kind: 'original', docxIndex: 0 })
    const block = generatedBlock(plan.saveBlocks[1])
    expect(block.runs.map((run) => run.text).join('')).toBe('beta edited')
    expect(plan.saveBlocks[1]).toMatchObject({ docxIndex: 1 })
    expect(plan.changedCount).toBe(1)
    expect(plan.deletedCount).toBe(0)
  })

  it('regenerates for a formatting-only edit even when the text is identical', () => {
    const node: PmNode = {
      type: 'docParagraph',
      attrs: { docxIndex: 0 },
      content: [{ type: 'text', text: 'alpha', marks: [{ type: 'bold' }] }],
    }
    const plan = pmDocToSavePlan(docOf(node), [paraBlock(0, 'alpha')])

    expect(plan.changedCount).toBe(1)
    expect(generatedBlock(plan.saveBlocks[0]).runs[0].bold).toBe(true)
  })

  it('drops a removed block and counts it as deleted, not changed', () => {
    const original = [paraBlock(0, 'alpha'), paraBlock(1, 'beta'), paraBlock(2, 'gamma')]
    const plan = pmDocToSavePlan(docOf(paraNode(0, 'alpha'), paraNode(2, 'gamma')), original)

    expect(plan.saveBlocks).toEqual([
      { kind: 'original', docxIndex: 0 },
      { kind: 'original', docxIndex: 2 },
    ])
    expect(plan.changedCount).toBe(0)
    expect(plan.deletedCount).toBe(1)
    expect(plan.totalOriginal).toBe(3)
    expect(plan.saveBlockIndexByDocx.get(2)).toBe(1)
  })

  it('emits an inserted paragraph as a generated block with no anchor', () => {
    const plan = pmDocToSavePlan(
      docOf(paraNode(0, 'alpha'), paraNode(null, 'brand new')),
      [paraBlock(0, 'alpha')],
    )

    const inserted = plan.saveBlocks[1]
    expect(inserted.kind).toBe('generated')
    expect('docxIndex' in inserted).toBe(false)
    expect(generatedBlock(inserted).runs.map((run) => run.text).join('')).toBe('brand new')
    expect(plan.changedCount).toBe(1)
    expect(plan.deletedCount).toBe(0)
  })

  it('follows the document order after a move without renumbering the anchors', () => {
    const original = [paraBlock(0, 'alpha'), paraBlock(1, 'beta')]
    const plan = pmDocToSavePlan(docOf(paraNode(1, 'beta'), paraNode(0, 'alpha')), original)

    expect(plan.saveBlocks).toEqual([
      { kind: 'original', docxIndex: 1 },
      { kind: 'original', docxIndex: 0 },
    ])
    expect([...plan.saveBlockIndexByDocx]).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(plan.changedCount).toBe(0)
    expect(plan.deletedCount).toBe(0)
  })

  it('gives the anchor to the first node and a generated twin to a copy of it', () => {
    // a duplicated node inherits the source's docxIndex; only one block may
    // claim that anchor or the save would emit the original bytes twice
    const plan = pmDocToSavePlan(
      docOf(paraNode(0, 'alpha'), paraNode(0, 'alpha')),
      [paraBlock(0, 'alpha')],
    )

    expect(plan.saveBlocks[0]).toEqual({ kind: 'original', docxIndex: 0 })
    const twin = plan.saveBlocks[1]
    expect(twin.kind).toBe('generated')
    expect('docxIndex' in twin).toBe(false)
    expect(plan.changedCount).toBe(1)
    expect(plan.deletedCount).toBe(0)
  })

  it('never anchors a hidden original block', () => {
    const original = [paraBlock(0, 'alpha'), paraBlock(1, 'beta', { hidden: true })]
    const plan = pmDocToSavePlan(docOf(paraNode(0, 'alpha'), paraNode(1, 'beta')), original)

    expect(plan.saveBlocks[0]).toEqual({ kind: 'original', docxIndex: 0 })
    expect(plan.saveBlocks[1].kind).toBe('generated')
    expect(plan.totalOriginal).toBe(1)
    expect(plan.changedCount).toBe(1)
  })

  it('carries a tracked insertion onto the emitted save block', () => {
    const revision = { kind: 'ins' as const, author: 'A', date: '2026-01-01T00:00:00Z' }
    const plan = pmDocToSavePlan(docOf(paraNode(0, 'alpha', { blockRevision: revision })), [
      paraBlock(0, 'alpha'),
    ])

    const emitted = plan.saveBlocks[0] as unknown as { revision?: unknown }
    expect(emitted.revision).toEqual(revision)
    expect(generatedBlock(plan.saveBlocks[0]).blockRevision).toEqual(revision)
    // the revision is a real change: the block cannot stay on its raw bytes
    expect(plan.changedCount).toBe(1)
  })
})

describe('pmDocToSavePlan block types', () => {
  it('keeps an unchanged heading on its original bytes and regenerates a level bump', () => {
    const headingNode = (level: number): PmNode => ({
      type: 'docHeading',
      attrs: { docxIndex: 0, level },
      content: [{ type: 'text', text: 'Title' }],
    })
    const original: Block[] = [
      { id: 'h0', type: 'heading', level: 2, docxIndex: 0, originalXml: null, runs: [{ text: 'Title' }] },
    ]

    expect(pmDocToSavePlan(docOf(headingNode(2)), original).saveBlocks[0]).toEqual({
      kind: 'original',
      docxIndex: 0,
    })

    const bumped = pmDocToSavePlan(docOf(headingNode(3)), original)
    expect(bumped.changedCount).toBe(1)
    expect(generatedBlock(bumped.saveBlocks[0])).toMatchObject({ type: 'heading', level: 3 })
  })

  it('keeps an unchanged list item original and regenerates an indent change', () => {
    const listNode = (ilvl: number): PmNode => ({
      type: 'docListItem',
      attrs: { docxIndex: 0, numId: '5', kind: 'bullet', ilvl },
      content: [{ type: 'text', text: 'point' }],
    })
    const original: Block[] = [
      {
        id: 'l0',
        type: 'listItem',
        docxIndex: 0,
        originalXml: null,
        list: { kind: 'bullet', numId: '5', ilvl: 0 },
        runs: [{ text: 'point' }],
      },
    ]

    expect(pmDocToSavePlan(docOf(listNode(0)), original).saveBlocks[0]).toEqual({
      kind: 'original',
      docxIndex: 0,
    })

    const indented = pmDocToSavePlan(docOf(listNode(1)), original)
    expect(indented.changedCount).toBe(1)
    expect(generatedBlock(indented.saveBlocks[0])).toMatchObject({
      type: 'listItem',
      list: { kind: 'bullet', numId: '5', ilvl: 1 },
    })
  })

  it('leaves a structurally unchanged table on its original bytes', () => {
    const tableNode: PmNode = {
      type: 'docTable',
      attrs: { docxIndex: 0 },
      content: [
        {
          type: 'docTableRow',
          content: [
            {
              type: 'docTableCell',
              content: [{ type: 'docParagraph', attrs: { docxIndex: null }, content: [{ type: 'text', text: 'cell' }] }],
            },
          ],
        },
      ],
    }
    // the parse records the signatures it saw; a table the user never touched
    // still matches both, which is what lets the raw bytes survive
    tableNode.attrs = {
      ...tableNode.attrs,
      originalStructure: tableStructureSignature(tableNode),
      originalFormatting: tableFormattingSignature(tableNode),
    }
    const original: Block[] = [
      { id: 't0', type: 'table', docxIndex: 0, originalXml: null, table: { rows: [], colWidthsPct: [] } },
    ]

    const plan = pmDocToSavePlan(docOf(tableNode), original)
    expect(plan.saveBlocks[0]).toEqual({ kind: 'original', docxIndex: 0 })
    expect(plan.changedCount).toBe(0)
  })
})
