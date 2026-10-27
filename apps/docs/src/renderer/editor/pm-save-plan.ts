/**
 * ProseMirror doc -> SaveBlock[]: the save direction of the editor conversion.
 *
 * `pmDocToSavePlan` walks the live editor doc, matches every node against the
 * block it was parsed from, and only regenerates the ones whose content
 * signature actually changed. Everything below it (patch builders, per-node
 * block conversion, sdt shell rebalancing) exists to serve that walk, which is
 * why this file is the only place they can be tested from.
 *
 * Shared primitives come from `pm-shared.ts`; the parse direction lives in
 * `convert.ts`, which also re-exports this module's public surface.
 */

import {
  charFormatKey,
  inlineToRuns,
  mergeRuns,
  nodeFormat,
  normalizedFormat,
  pmTableToModel,
  revisionKey,
  tableFormattingSignature,
  tableStructureSignature,
  unwrapBlockRevisionXml,
} from './pm-shared'
import type { PmNode } from './pm-shared'
import {
  mergePPrFormat,
  parseLazyMediaUrl,
  setPPrChange,
  stripPPrChange,
  patchFieldParagraphXml,
  applyImageWrap,
  applyImageZOrder,
  applyShapeWrapAt,
  applyShapeZOrderAt,
  patchImageParagraphXml,
  patchMathTokens,
  patchTableCellTexts,
  type CellParaPatch,
  type CellTextsPatch,
  patchDrawingExtent,
  patchTextboxSizes,
  patchShapeStyles,
  type ShapeStylePatch,
  type TextboxSizePatch,
  patchTextboxParas,
  generateTableModelXml,
  type Block,
  type ChartDisplay,
  type ChartPatch,
  type ChartSeriesPatch,
  type FieldDisplay,
  type FieldTextPatch,
  type FormulaDisplay,
  type GeneratedBlock,
  type ImageWrap,
  type NewChart,
  type NewImage,
  type ParaFormat,
  type Run,
  type SaveBlock,
  type SdtShell,
  type TableCell,
  type TableModel,
  type TextboxDisplay,
  type TextboxParaPatch,
  type TextboxParasPatchSet,
} from '@yiioffice/docx-engine'
import { t } from '../i18n/locale'
import { isStraightLineKind } from './shape-svg'
import { SHAPE_INLINE_WRAP, shapeWrapOf } from './floating-z-order'

export interface SavePlan {
  saveBlocks: SaveBlock[]
  /**
   * Chart data edits. These patch the chart's own zip part, not the body
   * paragraph (which stays byte-identical); App applies patchChartPartXml
   * and hands the result to saveDocx via options.partXml.
   */
  chartPatches: Array<{ partPath: string; patch: ChartPatch }>
  /**
   * docxIndex of an original block -> its index in saveBlocks. Ink
   * annotations anchor by docxIndex and the engine wants finalBlocks indexes.
   */
  saveBlockIndexByDocx: Map<number, number>
  /** count of blocks whose content was regenerated */
  changedCount: number
  /** count of original blocks removed */
  deletedCount: number
  totalOriginal: number
}

export function pmDocToSavePlan(inputDoc: PmNode, originalBlocks: Block[]): SavePlan {
  const doc = inputDoc
  const originalByIndex = new Map<number, Block>()
  for (const block of originalBlocks) {
    if (!block.hidden && block.docxIndex !== null) originalByIndex.set(block.docxIndex, block)
  }

  // Mixed-encoding guard: parse compresses wild producer relativeHeight values
  // (LibreOffice writes 1, 2, …) to compact ranks, but the raw XML keeps the
  // wild bytes. Word paints by the raw value, so rewriting ONE anchor to the
  // base+rank encoding while wild siblings survive would invert the saved
  // paint order. Once any wrap/z-order edit exists, every normalized anchor is
  // rewritten to base+rank; untouched documents still keep their bytes.
  const hasZOrderEdit = (nodes: PmNode[] | undefined): boolean => {
    for (const n of nodes ?? []) {
      if (n.type === 'docProtected' && n.attrs?.blockType === 'image') {
        const idx = n.attrs.docxIndex as number | null | undefined
        const orig = idx !== null && idx !== undefined ? originalByIndex.get(idx) : undefined
        if (orig) {
          const wrap = (n.attrs.imageWrap as ImageWrap | null) ?? null
          const z = n.attrs.imageZOrder != null ? Number(n.attrs.imageZOrder) : undefined
          if (wrap !== (orig.imageWrap ?? null) || (z !== undefined && z !== orig.imageZOrder))
            return true
        }
      }
      if (hasZOrderEdit(n.content)) return true
    }
    return false
  }
  const harmonizeZOrders =
    originalBlocks.some((b) => b.imageZOrderNormalized) && hasZOrderEdit(doc.content)

  // Multi-block sdt groups (one w:sdt split into N blocks): the shell open/close
  // bytes live on the first/last member. Track which surviving member emits
  // them so deleting or regenerating a boundary member never unbalances the sdt.
  const sdtGroupOf = new Map<number, number>()
  const sdtGroupShells = new Map<number, SdtShell>()
  // first/last original member per group: nested content controls leave wrapper
  // fragments on MIDDLE members' closeXml, so "emits closeXml" alone no longer
  // means "emits the group close" — only the boundary members do
  const sdtGroupFirst = new Map<number, number>()
  const sdtGroupLast = new Map<number, number>()
  for (const block of originalBlocks) {
    const shell = block.sdtShell
    if (block.hidden || block.docxIndex === null || shell?.group === undefined) continue
    sdtGroupOf.set(block.docxIndex, shell.group)
    if (!sdtGroupFirst.has(shell.group)) sdtGroupFirst.set(shell.group, block.docxIndex)
    sdtGroupLast.set(shell.group, block.docxIndex)
    const agg = sdtGroupShells.get(shell.group)
    if (!agg) sdtGroupShells.set(shell.group, { ...shell })
    else {
      if (shell.openXml) agg.openXml = shell.openXml
      if (shell.closeXml) agg.closeXml = shell.closeXml
    }
  }
  const sdtGroupEmits = new Map<
    number,
    Array<{ at: number; idx: number; open: boolean; close: boolean }>
  >()

  const saveBlocks: SaveBlock[] = []
  const chartPatches: Array<{ partPath: string; patch: ChartPatch }> = []
  const saveBlockIndexByDocx = new Map<number, number>()
  let changedCount = 0
  const usedIndexes = new Set<number>()
  /** record where an original anchor ended up in saveBlocks (set before push) */
  const mapAnchor = (idx: number) => saveBlockIndexByDocx.set(idx, saveBlocks.length)

  const recordSdtEmit = (node: PmNode, sb: SaveBlock, at: number) => {
    const idx = node.attrs?.docxIndex as number | null | undefined
    if (idx === null || idx === undefined) return
    if (saveBlockIndexByDocx.get(idx) !== at) return
    const group = sdtGroupOf.get(idx)
    if (group === undefined) return
    const shell = sdtGroupShells.get(group)!
    let open = false
    let close = false
    if (sb.kind === 'original') {
      const original = originalByIndex.get(idx)
      open = !!original?.sdtShell?.openXml
      close = !!original?.sdtShell?.closeXml
    } else if (sb.kind === 'generated') {
      open = !!sb.block.sdtShell?.openXml
      close = !!sb.block.sdtShell?.closeXml
    } else if (sb.kind === 'xml') {
      open = !!shell.openXml && sb.xml.startsWith(shell.openXml)
      close = !!shell.closeXml && sb.xml.endsWith(shell.closeXml)
    }
    // middle members may emit nested wrapper fragments; only the boundary
    // members' bytes are the group open/close the rebalance below cares about
    open = open && sdtGroupFirst.get(group) === idx
    close = close && sdtGroupLast.get(group) === idx
    let emits = sdtGroupEmits.get(group)
    if (!emits) sdtGroupEmits.set(group, (emits = []))
    emits.push({ at, idx, open, close })
  }

  for (const node of doc.content ?? []) {
    const revision = node.attrs?.blockRevision as {
      kind: 'ins' | 'del'
      author: string
      date?: string
      id?: string
    } | null
    const pushBlock = (block: SaveBlock) => {
      recordSdtEmit(node, block, saveBlocks.length)
      saveBlocks.push(revision ? { ...block, revision } : block)
    }
    if (node.type === 'docTable') {
      const idx = node.attrs?.docxIndex as number | null
      const original =
        idx !== null && idx !== undefined && !usedIndexes.has(idx)
          ? originalByIndex.get(idx)
          : undefined
      const model = pmTableToModel(node)
      if (original?.type === 'table') {
        usedIndexes.add(idx!)
        mapAnchor(idx!)
        const structurallyUnchanged =
          node.attrs?.originalStructure === tableStructureSignature(node)
        const formattingUnchanged =
          node.attrs?.originalFormatting === tableFormattingSignature(node)
        if (
          original.blockRevision &&
          !revision &&
          structurallyUnchanged &&
          formattingUnchanged &&
          original.originalXml
        ) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: unwrapBlockRevisionXml(original.originalXml),
          })
          continue
        }
        const tableTexts =
          structurallyUnchanged && formattingUnchanged
            ? tableTextsPatchFromModel(model, original)
            : null
        if (structurallyUnchanged && formattingUnchanged && tableTexts && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: patchTableCellTexts(original.originalXml, tableTexts),
          })
        } else if (structurallyUnchanged && formattingUnchanged) {
          pushBlock({ kind: 'original', docxIndex: idx! })
        } else {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: generateTableModelXml(model, original.originalXml ?? undefined),
          })
        }
      } else {
        changedCount++
        pushBlock({ kind: 'xml', xml: generateTableModelXml(model) })
      }
      continue
    }
    if (node.type === 'docProtected') {
      const idx = node.attrs?.docxIndex as number | null
      if (idx !== null && idx !== undefined && originalByIndex.has(idx) && !usedIndexes.has(idx)) {
        usedIndexes.add(idx)
        mapAnchor(idx)
        const original = originalByIndex.get(idx)!
        if (original.blockRevision && !revision && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: unwrapBlockRevisionXml(original.originalXml),
          })
          continue
        }
        const imagePatch = imagePatchOf(node, original)
        const tableTexts = tableTextsPatch(node, original)
        const textboxTexts = textboxParasPatch(node, original)
        const textboxSizes = textboxSizesPatch(node, original)
        const textboxStyles = textboxStylesPatch(node, original)
        const shapeWrapChanges = shapeWrapPatchOf(node, original)
        const textboxOffsetX =
          node.attrs?.imageOffsetXEmu != null ? Number(node.attrs.imageOffsetXEmu) : undefined
        const textboxOffsetY =
          node.attrs?.imageOffsetYEmu != null ? Number(node.attrs.imageOffsetYEmu) : undefined
        const textboxPositionChanged =
          !!original.textboxes?.length &&
          textboxOffsetX !== undefined &&
          textboxOffsetY !== undefined &&
          (textboxOffsetX !== original.imageOffsetXEmu ||
            textboxOffsetY !== original.imageOffsetYEmu)
        const fieldText = fieldTextPatch(node, original)
        const formulaTokens = formulaTokensPatch(node, original)
        // chart data edits live in the chart's own part; the body block stays original
        const chartPatch = chartPatchOf(node, original)
        if (chartPatch) {
          changedCount++
          chartPatches.push(chartPatch)
        }
        // chart resize rewrites the body drawing's extent
        const chartDisplay = node.attrs?.chartDisplay as ChartDisplay | null
        const chartSize =
          chartDisplay?.widthPx &&
          chartDisplay.heightPx &&
          (chartDisplay.widthPx !== original.chartDisplay?.widthPx ||
            chartDisplay.heightPx !== original.chartDisplay?.heightPx)
            ? { w: chartDisplay.widthPx, h: chartDisplay.heightPx }
            : null
        const imageReplace =
          original.type === 'image'
            ? (node.attrs?.imageReplace as {
                base64: string
                mime: string
              } | null)
            : null
        if ((imagePatch || imageReplace) && original.originalXml) {
          changedCount++
          let xml = imagePatch
            ? patchImageParagraphXml(original.originalXml, imagePatch)
            : original.originalXml
          if (imagePatch?.wrap !== undefined) {
            const posOffset =
              imagePatch.posOffsetX !== undefined && imagePatch.posOffsetY !== undefined
                ? { x: imagePatch.posOffsetX, y: imagePatch.posOffsetY }
                : undefined
            const marginAlign =
              posOffset === undefined && imagePatch.posH && imagePatch.posV
                ? { h: imagePatch.posH, v: imagePatch.posV }
                : undefined
            // a wrap-only change must not reset an existing stacking rank: the
            // patch carries zOrder only when the rank itself changed
            xml = applyImageWrap(
              xml,
              imagePatch.wrap,
              posOffset,
              marginAlign,
              imagePatch.zOrder ?? original.imageZOrder,
            )
          } else if (
            imagePatch?.zOrder !== undefined &&
            (node.attrs?.imageWrap as ImageWrap | null) != null
          ) {
            // z-order changed without a wrap-mode change on a still-floating
            // image: re-encode ONLY relativeHeight — a full anchor rebuild
            // would reset the position basis (relativeFrom) and distances
            xml = applyImageZOrder(xml, imagePatch.zOrder)
          } else if (
            imagePatch &&
            (imagePatch.posOffsetX !== undefined || imagePatch.posOffsetY !== undefined)
          ) {
            // posOffset changed without wrap change: patchImageParagraphXml already rewrote it
          } else if (
            harmonizeZOrders &&
            original.type === 'image' &&
            original.imageZOrderNormalized &&
            (node.attrs?.imageWrap as ImageWrap | null) != null
          ) {
            // geometry-only edit (resize/align/rotate) on a sibling that still
            // carries a wild producer relativeHeight: re-encode base+rank on
            // top of the geometry patch — relativeHeight only, the anchor's
            // position basis and wrap bytes must survive (see applyImageZOrder)
            xml = applyImageZOrder(xml, original.imageZOrder)
          }
          pushBlock({
            kind: 'xml',
            xml,
            ...(imageReplace
              ? {
                  replaceImage: {
                    base64: imageReplace.base64,
                    mime: imageReplace.mime as NewImage['mime'],
                  },
                }
              : {}),
          })
        } else if (tableTexts && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: patchTableCellTexts(original.originalXml, tableTexts),
          })
        } else if (
          (textboxTexts ||
            textboxSizes ||
            textboxStyles ||
            textboxPositionChanged ||
            shapeWrapChanges.length > 0) &&
          original.originalXml
        ) {
          changedCount++
          let xml = original.originalXml
          if (textboxTexts) xml = patchTextboxParas(xml, textboxTexts)
          if (textboxSizes) xml = patchTextboxSizes(xml, textboxSizes)
          if (textboxStyles) xml = patchShapeStyles(xml, textboxStyles)
          for (const change of [...shapeWrapChanges].sort((a, b) => b.index - a.index)) {
            const location = {
              shapeId: change.shapeId,
              boxIndex: change.index,
            }
            if (change.wrapChanged) {
              xml = applyShapeWrapAt(
                xml,
                location,
                change.wrap,
                change.zChanged ? change.z : undefined,
              )
            } else if (change.zChanged) {
              xml = applyShapeZOrderAt(xml, location, change.z ?? 0)
            }
          }
          const mirrored = node.attrs?.imageWrap as ImageWrap | typeof SHAPE_INLINE_WRAP | null
          // an inline shape has no position: a drag that preceded the inline
          // choice must not rebuild the anchor applyShapeWrapAt just removed
          if (textboxPositionChanged && mirrored !== SHAPE_INLINE_WRAP) {
            const firstBox = (node.attrs?.textboxes as TextboxDisplay[] | undefined)?.[0]
            const wrap =
              (firstBox ? shapeWrapOf(firstBox) : null) ??
              mirrored ??
              original.imageWrap ??
              'square-left'
            const rank =
              firstBox?.z !== undefined
                ? Number(firstBox.z)
                : node.attrs?.imageZOrder != null
                  ? Number(node.attrs.imageZOrder)
                  : undefined
            xml = applyImageWrap(
              xml,
              wrap,
              { x: textboxOffsetX!, y: textboxOffsetY! },
              undefined,
              rank,
            )
          }
          pushBlock({ kind: 'xml', xml })
        } else if (fieldText && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: patchFieldParagraphXml(original.originalXml, fieldText),
          })
        } else if (formulaTokens && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: patchMathTokens(original.originalXml, formulaTokens),
          })
        } else if (chartSize && original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: patchDrawingExtent(original.originalXml, chartSize.w, chartSize.h),
          })
        } else if (
          harmonizeZOrders &&
          original.type === 'image' &&
          original.imageZOrderNormalized &&
          original.imageWrap &&
          original.originalXml
        ) {
          // untouched anchor still carrying a wild producer relativeHeight:
          // re-encode ONLY that attribute to base+rank so it stays ordered
          // against the anchors this session re-encoded (harmonizeZOrders
          // pre-scan). Position/wrap bytes stay untouched — the picture must
          // not shift from a reorder it wasn't even part of.
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: applyImageZOrder(original.originalXml, original.imageZOrder),
          })
        } else {
          pushBlock({ kind: 'original', docxIndex: idx })
        }
      } else if (idx !== null && idx !== undefined && originalByIndex.has(idx)) {
        // pasted copy: the anchor is consumed by the first occurrence, so clone from the block's own data
        const original = originalByIndex.get(idx)!
        const image = imageFromProtectedAttrs(node)
        if (image) {
          changedCount++
          pushBlock({ kind: 'image', image })
        } else if (original.originalXml) {
          changedCount++
          pushBlock({
            kind: 'xml',
            xml: stripAnchorMarkers(original.originalXml),
          })
        } else {
          console.warn('dropping unclonable copy of protected block', node.attrs?.label)
        }
      } else if (node.attrs?.genXml) {
        // editor-created table or other self-contained fragment
        changedCount++
        let xml = String(node.attrs.genXml)
        const table = node.attrs?.table as TableModel | null
        if (table && node.attrs?.blockType === 'table') {
          xml = patchTableCellTexts(
            xml,
            table.rows.map((row) => row.map((cell) => cell.paras)),
          )
        }
        // editor-generated TOC lines: write the auto-refreshed page number back
        // (right only — the title is already in the genXml, and a left+right
        // patch bails out entirely when the title text nodes don't line up)
        const genField = node.attrs?.fieldDisplay as FieldDisplay | null
        if (genField?.kind === 'tocLine' && genField.right) {
          xml = patchFieldParagraphXml(xml, { right: genField.right })
        }
        // patch textbox paragraphs for newly-inserted textboxes/shapes with text
        const genTextboxes = node.attrs?.textboxes as TextboxDisplay[] | null
        const hasNonEmptyTextbox =
          genTextboxes != null &&
          genTextboxes.length > 0 &&
          genTextboxes.some((box) => box.paras.some((p) => p.runs.some((r) => r.text !== '')))
        if (hasNonEmptyTextbox) {
          // editor-built XML has exactly one txbxContent per box, in box order
          xml = patchTextboxParas(xml, {
            byIndex: genTextboxes!.map((box) =>
              box.paras.map((p) => ({
                runs: mergeRuns(p.runs),
                align: p.align ?? null,
              })),
            ),
          })
        }
        // persist resize/autogrow of newly-inserted single-box shapes/lines;
        // horizontal lines keep their zero-height extent (display box is a grab band)
        const genBox = genTextboxes?.length === 1 ? genTextboxes[0] : null
        if (genBox && (genBox.widthPx || genBox.heightPx)) {
          xml = patchTextboxSizes(xml, [
            {
              wPx: genBox.widthPx ?? null,
              hPx: isStraightLineKind(genBox.prst) ? null : (genBox.heightPx ?? null),
            },
          ])
        }
        if (genBox) {
          xml = patchShapeStyles(xml, [
            {
              fillHex: genBox.fill ?? null,
              borderHex: genBox.borderColor ?? null,
            },
          ])
        }
        // apply wrap changes for floating textboxes/shapes
        const genWrap = node.attrs?.imageWrap as ImageWrap | typeof SHAPE_INLINE_WRAP | null
        const genOffsetX =
          node.attrs?.imageOffsetXEmu != null ? Number(node.attrs.imageOffsetXEmu) : undefined
        const genOffsetY =
          node.attrs?.imageOffsetYEmu != null ? Number(node.attrs.imageOffsetYEmu) : undefined
        const genShape = {
          shapeId: (node.attrs?.textboxes as TextboxDisplay[] | undefined)?.[0]?.shapeId,
          boxIndex: 0,
        }
        if (genWrap === SHAPE_INLINE_WRAP) {
          xml = applyShapeWrapAt(xml, genShape, null)
        } else if (genWrap !== undefined && genWrap !== null) {
          const posOffset =
            genOffsetX !== undefined && genOffsetY !== undefined
              ? { x: genOffsetX, y: genOffsetY }
              : undefined
          // a moved shape rebuilds its position from the drag offsets; a pure
          // wrap change keeps the anchor's own position bytes
          xml = posOffset
            ? applyImageWrap(xml, genWrap, posOffset)
            : applyShapeWrapAt(xml, genShape, genWrap)
        }
        const genZ = node.attrs?.imageZOrder != null ? Number(node.attrs.imageZOrder) : undefined
        if (genZ !== undefined && genWrap !== SHAPE_INLINE_WRAP)
          xml = applyShapeZOrderAt(xml, genShape, genZ)
        pushBlock({ kind: 'xml', xml })
      } else if (node.attrs?.genImage) {
        changedCount++
        const image = { ...(node.attrs.genImage as NewImage) }
        if (node.attrs.imageWidthPx) image.widthPx = Number(node.attrs.imageWidthPx)
        if (node.attrs.imageHeightPx) image.heightPx = Number(node.attrs.imageHeightPx)
        const align = node.attrs.imageAlign as NewImage['align'] | null
        if (align) image.align = align
        const wrap = node.attrs.imageWrap as ImageWrap | null
        if (wrap) image.wrap = wrap
        if (node.attrs.imageZOrder != null) image.zOrder = Number(node.attrs.imageZOrder)
        if (node.attrs.imageRotDeg) image.rotDeg = Number(node.attrs.imageRotDeg)
        if (node.attrs.imageFlipH) image.flipH = true
        if (node.attrs.imageFlipV) image.flipV = true
        pushBlock({ kind: 'image', image })
      } else if (node.attrs?.genChart) {
        // in-place edits live in chartDisplay; the saved part reflects them
        changedCount++
        const spec = { ...(node.attrs.genChart as NewChart) }
        const display = node.attrs.chartDisplay as ChartDisplay | null
        if (display) {
          if (display.title !== undefined) spec.title = display.title
          spec.categories = display.categories
          spec.series = display.series.map((s, i) => ({
            name: s.name ?? spec.series[i]?.name ?? t('editorChartSeries', { num: i + 1 }),
            values: s.values,
          }))
        }
        pushBlock({
          kind: 'chart',
          chart: spec,
          ...(display?.widthPx && display.heightPx
            ? { extentPx: { w: display.widthPx, h: display.heightPx } }
            : {}),
        })
      } else {
        // picture that traveled through clipboard HTML (r136 cross-document
        // paste): no anchor and no genImage — rebuild from the preview bytes
        // or it silently vanishes on save
        const image = imageFromProtectedAttrs(node)
        if (image) {
          changedCount++
          pushBlock({ kind: 'image', image })
        }
      }
      // any other protected node without an anchor or generated payload cannot be regenerated; drop it
      continue
    }

    const generated = pmNodeToGeneratedBlock(node)
    const idx = node.attrs?.docxIndex as number | null
    const original = idx !== null && idx !== undefined ? originalByIndex.get(idx) : undefined
    if (
      original &&
      !usedIndexes.has(idx!) &&
      signatureOfBlock(original) === signatureOfGenerated(generated)
    ) {
      usedIndexes.add(idx!)
      mapAnchor(idx!)
      pushBlock({ kind: 'original', docxIndex: idx! })
    } else {
      changedCount++
      // an in-place edit consumes its original anchor: it is replaced, not
      // deleted — and may reuse the anchor's original pPr bytes. A split twin
      // (anchor already consumed) gets no rawPPr, so revision records and
      // section props are never duplicated.
      const replacesOriginal = original !== undefined && !usedIndexes.has(idx!)
      if (replacesOriginal) {
        usedIndexes.add(idx!)
        mapAnchor(idx!)
        applyRawPPr(generated, original!)
      } else if (original) {
        // A split twin inherits the source node's attrs, but pPrChange and
        // bookmark/comment anchors belong only to the anchored original.
        delete generated.pPrChange
        delete generated.bookmarks
        delete generated.hiddenBookmarks
        delete generated.commentStarts
        delete generated.commentEnds
        // A grouped shell (partial open/close of a multi-block sdt) must be
        // emitted exactly once, by the anchor.
        if (generated.sdtShell?.group !== undefined) delete generated.sdtShell
      }
      pushBlock({
        kind: 'generated',
        block: generated,
        ...(replacesOriginal ? { docxIndex: idx! } : {}),
      })
    }
  }

  const attachShell = (emit: { at: number; idx: number }, side: 'open' | 'close') => {
    const group = sdtGroupOf.get(emit.idx)!
    const shell = sdtGroupShells.get(group)!
    const add = side === 'open' ? shell.openXml : shell.closeXml
    const sb = saveBlocks[emit.at]
    if (sb.kind === 'original') {
      const xml = originalByIndex.get(emit.idx)?.originalXml
      if (xml === undefined) return
      saveBlocks[emit.at] = {
        kind: 'xml',
        xml: side === 'open' ? add + xml : xml + add,
        docxIndex: emit.idx,
        ...(sb.revision ? { revision: sb.revision } : {}),
      }
    } else if (sb.kind === 'generated') {
      const gShell = sb.block.sdtShell ?? {
        ...shell,
        openXml: '',
        closeXml: '',
      }
      // concatenate: a nested wrapper fragment may already sit here, and the
      // group open must precede it (the group close must follow it)
      if (side === 'open') gShell.openXml = add + (gShell.openXml ?? '')
      else gShell.closeXml = (gShell.closeXml ?? '') + add
      sb.block.sdtShell = gShell
    } else if (sb.kind === 'xml') {
      sb.xml = side === 'open' ? add + sb.xml : sb.xml + add
    }
  }
  // Nested content controls put inner wrapper fragments on MIDDLE members'
  // closeXml (between-children bytes: "</inner sdt><next inner sdt>"). A
  // deleted middle member must not take its fragment with it, or the group
  // saves unbalanced sdt XML. Reattach the fragment to the nearest surviving
  // member before it (else the first after), before the group-level open/close
  // rebalance below so the outer close still lands last.
  const appendXml = (at: number, frag: string, before: boolean, group: number) => {
    const sb = saveBlocks[at]
    if (sb.kind === 'original') {
      const xml = originalByIndex.get(sb.docxIndex)?.originalXml
      if (xml === undefined) return
      saveBlocks[at] = {
        kind: 'xml',
        xml: before ? frag + xml : xml + frag,
        docxIndex: sb.docxIndex,
        ...(sb.revision ? { revision: sb.revision } : {}),
      }
    } else if (sb.kind === 'generated') {
      const shell = sb.block.sdtShell ?? {
        ...sdtGroupShells.get(group)!,
        openXml: '',
        closeXml: '',
      }
      if (before) shell.openXml = frag + (shell.openXml ?? '')
      else shell.closeXml = (shell.closeXml ?? '') + frag
      sb.block.sdtShell = shell
    } else if (sb.kind === 'xml') {
      sb.xml = before ? frag + sb.xml : sb.xml + frag
    }
  }
  for (const [group, emits] of sdtGroupEmits) {
    const members = [...sdtGroupOf.entries()]
      .filter(([, g]) => g === group)
      .map(([idx]) => idx)
      .sort((a, b) => a - b)
    const last = members[members.length - 1]
    const sorted = [...emits].sort((a, b) => a.at - b.at)
    // deleted leading members all prepend to the first survivor: collect their
    // fragments in document order and prepend once, or they stack reversed
    const prefixFrags: string[] = []
    for (const idx of members) {
      if (idx === last || usedIndexes.has(idx)) continue
      const frag = originalByIndex.get(idx)?.sdtShell?.closeXml
      if (!frag) continue
      const prev = [...sorted].reverse().find((e) => e.idx < idx)
      if (prev) appendXml(prev.at, frag, false, group)
      else prefixFrags.push(frag)
    }
    if (prefixFrags.length > 0) appendXml(sorted[0].at, prefixFrags.join(''), true, group)
  }
  for (const [group, emits] of sdtGroupEmits) {
    const shell = sdtGroupShells.get(group)!
    if (shell.openXml && !emits.some((e) => e.open)) attachShell(emits[0], 'open')
    if (shell.closeXml && !emits.some((e) => e.close)) attachShell(emits[emits.length - 1], 'close')
  }

  const deletedCount = [...originalByIndex.keys()].filter((i) => !usedIndexes.has(i)).length
  return {
    saveBlocks,
    chartPatches,
    saveBlockIndexByDocx,
    changedCount,
    deletedCount,
    totalOriginal: originalByIndex.size,
  }
}

/** rebuild a pasted image copy from its preview bytes; null when not materializable */
function imageFromProtectedAttrs(node: PmNode): NewImage | null {
  if (node.attrs?.blockType !== 'image') return null
  const src = String(node.attrs?.imageDataUrl ?? '')
  const lazy = parseLazyMediaUrl(src)
  const m = lazy ? null : /^data:(image\/(?:png|jpeg|gif));base64,(.+)$/.exec(src)
  const widthPx = Number(node.attrs?.imageWidthPx)
  const heightPx = Number(node.attrs?.imageHeightPx)
  if ((!m && !lazy) || !widthPx || !heightPx) return null
  const image: NewImage = lazy
    ? {
        base64: '',
        mime: 'image/png',
        sourcePart: lazy.partPath,
        widthPx,
        heightPx,
      }
    : { base64: m![2], mime: m![1] as NewImage['mime'], widthPx, heightPx }
  const align = node.attrs?.imageAlign as NewImage['align'] | null
  if (align) image.align = align
  const wrap = node.attrs?.imageWrap as ImageWrap | null
  if (wrap) image.wrap = wrap
  if (node.attrs?.imageZOrder != null) image.zOrder = Number(node.attrs.imageZOrder)
  if (node.attrs?.imageRotDeg) image.rotDeg = Number(node.attrs.imageRotDeg)
  if (node.attrs?.imageFlipH) image.flipH = true
  if (node.attrs?.imageFlipV) image.flipV = true
  return image
}

/** cloned XML must not repeat the anchor's bookmark/comment ids */
function stripAnchorMarkers(xml: string): string {
  return xml.replace(
    /<w:(?:bookmarkStart|bookmarkEnd|commentRangeStart|commentRangeEnd|commentReference)\b[^>]*\/>/g,
    '',
  )
}

/** chart data changes vs the parsed model; null when untouched or unpatchable */
function chartPatchOf(
  node: PmNode,
  original: Block,
): { partPath: string; patch: ChartPatch } | null {
  const current = node.attrs?.chartDisplay as ChartDisplay | null
  const initial = original.chartDisplay
  if (!current || !initial || current.partPath !== initial.partPath) return null
  if (
    current.series.length !== initial.series.length ||
    current.categories.length !== initial.categories.length
  ) {
    return null
  }
  const patch: ChartPatch = {}
  if (initial.title !== undefined && (current.title ?? '') !== initial.title) {
    patch.title = current.title ?? ''
  }
  let catChanged = false
  const categories = current.categories.map((cat, i) => {
    if (cat === initial.categories[i]) return null
    catChanged = true
    return cat
  })
  if (catChanged) patch.categories = categories
  let serChanged = false
  const series = current.series.map((ser, i): ChartSeriesPatch | null => {
    const orig = initial.series[i]
    if (ser.values.length !== orig.values.length) return null
    const serPatch: ChartSeriesPatch = {}
    if (orig.name !== undefined && (ser.name ?? '') !== orig.name) serPatch.name = ser.name ?? ''
    let valChanged = false
    const values = ser.values.map((value, j) => {
      // gaps in the cache have no pt to patch; they stay read-only
      if (value === orig.values[j] || orig.values[j] === null) return null
      valChanged = true
      return value
    })
    if (valChanged) serPatch.values = values
    if (Object.keys(serPatch).length === 0) return null
    serChanged = true
    return serPatch
  })
  if (serChanged) patch.series = series
  if (Object.keys(patch).length === 0) return null
  return { partPath: initial.partPath, patch }
}

interface ImageBlockPatch {
  widthPx?: number
  heightPx?: number
  align?: 'left' | 'center' | 'right' | null
  /** null = back to inline; undefined = wrap unchanged */
  wrap?: ImageWrap | null
  /** stacking rank among overlapping anchors (bring-forward/send-back); undefined = keep */
  zOrder?: number
  /** posOffset in EMU for free-position floating images; undefined = keep */
  posOffsetX?: number
  posOffsetY?: number
  /** margin-relative align pair (Word position-gallery presets); undefined = keep */
  posH?: 'left' | 'center' | 'right'
  posV?: 'top' | 'center' | 'bottom'
  /** rotation (deg clockwise, 0 removes) / mirror flips; undefined = keep */
  rotDeg?: number
  flipH?: boolean
  flipV?: boolean
}

/** size/align/wrap changes on an original image block; null when untouched */
function imagePatchOf(node: PmNode, original: Block): ImageBlockPatch | null {
  if (original.type !== 'image' || node.attrs?.blockType !== 'image') return null
  const patch: ImageBlockPatch = {}
  const w = node.attrs?.imageWidthPx ? Number(node.attrs.imageWidthPx) : null
  const h = node.attrs?.imageHeightPx ? Number(node.attrs.imageHeightPx) : null
  if (w && h && (w !== (original.imageWidthPx ?? null) || h !== (original.imageHeightPx ?? null))) {
    patch.widthPx = w
    patch.heightPx = h
  }
  const align = (node.attrs?.imageAlign as 'left' | 'center' | 'right' | null) ?? null
  if (align !== (original.imageAlign ?? null)) {
    patch.align = align
  }
  const wrap = (node.attrs?.imageWrap as ImageWrap | null) ?? null
  if (wrap !== (original.imageWrap ?? null)) {
    patch.wrap = wrap
  }
  const zOrder = node.attrs?.imageZOrder != null ? Number(node.attrs.imageZOrder) : undefined
  if (zOrder !== undefined && zOrder !== (original.imageZOrder ?? undefined)) {
    patch.zOrder = zOrder
  }
  // posOffset for free-position floating images
  const posOffsetX =
    node.attrs?.imageOffsetXEmu != null ? Number(node.attrs.imageOffsetXEmu) : undefined
  const posOffsetY =
    node.attrs?.imageOffsetYEmu != null ? Number(node.attrs.imageOffsetYEmu) : undefined
  if (posOffsetX !== undefined && posOffsetX !== (original.imageOffsetXEmu ?? undefined)) {
    patch.posOffsetX = posOffsetX
  }
  if (posOffsetY !== undefined && posOffsetY !== (original.imageOffsetYEmu ?? undefined)) {
    patch.posOffsetY = posOffsetY
  }
  const rotDeg = node.attrs?.imageRotDeg != null ? Number(node.attrs.imageRotDeg) : 0
  if (rotDeg !== (original.imageRotDeg ?? 0)) patch.rotDeg = rotDeg
  const flipH = !!node.attrs?.imageFlipH
  const flipV = !!node.attrs?.imageFlipV
  if (flipH !== (original.imageFlipH ?? false)) patch.flipH = flipH
  if (flipV !== (original.imageFlipV ?? false)) patch.flipV = flipV
  const posH = (node.attrs?.imagePosH as ImageBlockPatch['posH'] | null) ?? null
  const posV = (node.attrs?.imagePosV as ImageBlockPatch['posV'] | null) ?? null
  if (
    posH &&
    posV &&
    (posH !== (original.imagePosH ?? null) || posV !== (original.imagePosV ?? null))
  ) {
    patch.posH = posH
    patch.posV = posV
    // the position pair is written by applyImageWrap, which only runs when wrap is in the patch
    if (patch.wrap === undefined) patch.wrap = wrap
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/** gridGap placeholders have no w:tc in the original XML: drop them so the
 *  patch grid's indexes line up with document-order w:tc segments */

/** gridGap placeholders have no w:tc in the original XML: drop them so the
 *  patch grid's indexes line up with document-order w:tc segments */
function patchableCells(row: TableCell[] | undefined): TableCell[] {
  return (row ?? []).filter((cell) => !cell.gridGap)
}

/** per-cell text changes on an original table block; null when untouched */
function tableTextsPatch(node: PmNode, original: Block): (string[] | null)[][] | null {
  if (original.type !== 'table' || node.attrs?.blockType !== 'table') return null
  const current = node.attrs?.table as TableModel | null
  const orig = original.table
  if (!current || !orig) return null
  let changed = false
  const texts = current.rows.map((row, r) => {
    const origRow = patchableCells(orig.rows[r])
    return patchableCells(row).map((cell, c) => {
      const originalCell = origRow[c]
      if (!originalCell || cell.vMerge === 'continue') return null
      if (cell.paras.join('\n') === originalCell.paras.join('\n')) return null
      changed = true
      return cell.paras
    })
  })
  return changed ? texts : null
}

function tableTextsPatchFromModel(
  current: TableModel,
  original: Block,
): (CellTextsPatch | null)[][] | null {
  if (original.type !== 'table' || !original.table) return null
  let changed = false
  const texts = current.rows.map((row, r) => {
    const origRow = patchableCells(original.table!.rows[r])
    return patchableCells(row).map((cell, c): CellTextsPatch | null => {
      const originalCell = origRow[c]
      // the PM model never carries continuation-cell content: their original bytes stay
      if (!originalCell || cell.vMerge === 'continue') return null
      // nested tables: diff cell texts per table; changes go through the recursive surgical patch
      if (cell.nestedTables?.length && originalCell.nestedTables?.length) {
        const nested = cell.nestedTables.map((nt, i) => {
          const origNt = originalCell.nestedTables![i]
          if (!origNt) return null
          const grid = nestedTextsDiff(nt, origNt)
          return grid
        })
        const nestedChanged = nested.some((g) => g !== null)
        // The cell's own paragraphs sit outside the nested tables. They must be
        // diffed too: without this, typing next to a nested table was silently
        // dropped on save (the nested grid was unchanged, so the cell returned
        // null and the original bytes won).
        const ownTexts = parsedCellParaTexts(originalCell)
        const ownParas: (string | null)[] =
          cell.paras.length === ownTexts.length
            ? cell.paras.map((text, i) => (text === ownTexts[i] ? null : text))
            : [...cell.paras]
        if (!nestedChanged && !ownParas.some((p) => p !== null)) return null
        changed = true
        return {
          ...(ownParas.some((p) => p !== null) ? { paras: ownParas } : {}),
          ...(nestedChanged ? { nested } : {}),
        }
      }
      const origTexts = parsedCellParaTexts(originalCell)
      if (cell.paras.join('\n') === origTexts.join('\n')) return null
      changed = true
      const rich = cell.richParas
      // rich paragraph patches keep per-run formatting, hyperlinks and images;
      // untouched paragraphs (per-index text match) keep their original bytes
      if (rich && rich.length === cell.paras.length) {
        if (rich.length === origTexts.length) {
          return rich.map((p, i): CellParaPatch =>
            p.runs.map((run) => run.text).join('') === origTexts[i] ? null : { runs: p.runs },
          )
        }
        return rich.map((p): CellParaPatch => ({ runs: p.runs }))
      }
      return cell.paras
    })
  })
  return changed ? texts : null
}

/**
 * Original-cell paragraph texts in the same encoding the PM model uses (run
 * texts with tabs/breaks/symbols as control/decoded chars). The parse-side
 * paras cache is built with a plain text extractor that drops them, so
 * comparing against it flags every break/tab/symbol cell as edited and sends
 * the whole untouched table through the lossy cell-text patch.
 */

/**
 * Original-cell paragraph texts in the same encoding the PM model uses (run
 * texts with tabs/breaks/symbols as control/decoded chars). The parse-side
 * paras cache is built with a plain text extractor that drops them, so
 * comparing against it flags every break/tab/symbol cell as edited and sends
 * the whole untouched table through the lossy cell-text patch.
 */
function parsedCellParaTexts(cell: TableCell): string[] {
  return cell.richParas?.length
    ? cell.richParas.map((p) => p.runs.map((run) => run.text).join(''))
    : cell.paras
}

/** per-cell text diff of one nested table; null = untouched cell, null entry = untouched paragraph */
function nestedTextsDiff(
  current: TableModel,
  original: TableModel,
): (CellParaPatch[] | null)[][] | null {
  if (current.rows.length !== original.rows.length) return null
  let changed = false
  const grid = current.rows.map((row, r) => {
    const origRow = patchableCells(original.rows[r])
    return patchableCells(row).map((cell, c): CellParaPatch[] | null => {
      const originalCell = origRow[c]
      if (!originalCell || cell.vMerge === 'continue') return null
      const text = cell.paras.join('\n')
      const richTexts = parsedCellParaTexts(originalCell)
      if (text === originalCell.paras.join('\n') || text === richTexts.join('\n')) return null
      changed = true
      if (cell.paras.length !== originalCell.paras.length) return cell.paras
      return cell.paras.map((p, i) =>
        p === originalCell.paras[i] || p === richTexts[i] ? null : p,
      )
    })
  })
  return changed ? grid : null
}

/** rich-run signature of one textbox paragraph, for per-paragraph change detection */
export function textboxParaSignature(para: TextboxDisplay['paras'][number]): string {
  return JSON.stringify([para.align ?? null, normalizedRuns(para.runs)])
}

/** all-empty sub-editor content counts as "still no text" for a paras:[] box */
function boxStillEmpty(paras: TextboxDisplay['paras']): boolean {
  return paras.every((p) => p.runs.every((r) => r.text === ''))
}

/**
 * Per-box, per-paragraph rich-run patches on an original textbox block,
 * addressed by the box's txbxIndex (or shapeId for a box gaining its first
 * text); null when untouched. Unchanged paragraphs stay null so the engine
 * keeps their original bytes.
 */

/**
 * Per-box, per-paragraph rich-run patches on an original textbox block,
 * addressed by the box's txbxIndex (or shapeId for a box gaining its first
 * text); null when untouched. Unchanged paragraphs stay null so the engine
 * keeps their original bytes.
 */
function textboxParasPatch(node: PmNode, original: Block): TextboxParasPatchSet | null {
  const current = node.attrs?.textboxes as TextboxDisplay[] | null
  const orig = original.textboxes
  if (!current || !orig || current.length !== orig.length) return null
  const byIndex: (TextboxParaPatch | null)[][] = []
  const inject: Array<{ shapeId: string; paras: TextboxParaPatch[] }> = []
  current.forEach((box, i) => {
    const origBox = orig[i]
    const origParas = origBox.paras
    const same =
      box.paras.length === origParas.length &&
      box.paras.every((p, j) => textboxParaSignature(p) === textboxParaSignature(origParas[j]))
    if (same || (origParas.length === 0 && boxStillEmpty(box.paras))) return
    if (origBox.txbxIndex !== undefined) {
      byIndex[origBox.txbxIndex] = box.paras.map((p, j) => {
        if (
          j < origParas.length &&
          textboxParaSignature(p) === textboxParaSignature(origParas[j])
        ) {
          return null
        }
        // align is always explicit so a removed alignment also clears w:jc
        return { runs: mergeRuns(p.runs), align: p.align ?? null }
      })
    } else if (origBox.shapeId) {
      inject.push({
        shapeId: origBox.shapeId,
        paras: box.paras.map((p) => ({
          runs: mergeRuns(p.runs),
          align: p.align ?? null,
        })),
      })
    }
  })
  if (byIndex.length === 0 && inject.length === 0) return null
  return {
    ...(byIndex.length > 0 ? { byIndex } : {}),
    ...(inject.length > 0 ? { inject } : {}),
  }
}

function textboxSizesPatch(node: PmNode, original: Block): (TextboxSizePatch | null)[] | null {
  const current = node.attrs?.textboxes as TextboxDisplay[] | null
  const initial = original.textboxes
  if (!current || !initial || current.length !== initial.length) return null
  let changed = false
  const sizes = current.map((box, index) => {
    // a resize on an autofit box (no initial heightPx) pins its height:
    // patchTextboxSizes drops spAutoFit so Word honors the fixed extent
    const wPx = box.widthPx && box.widthPx !== initial[index].widthPx ? box.widthPx : null
    const hPx = box.heightPx && box.heightPx !== initial[index].heightPx ? box.heightPx : null
    if (wPx == null && hPx == null) return null
    changed = true
    return { wPx, hPx }
  })
  return changed ? sizes : null
}

function textboxStylesPatch(node: PmNode, original: Block): (ShapeStylePatch | null)[] | null {
  const current = node.attrs?.textboxes as TextboxDisplay[] | null
  const initial = original.textboxes
  if (!current || !initial || current.length !== initial.length) return null
  let changed = false
  const styles = current.map((box, index) => {
    const fillHex =
      (box.fill ?? null) !== (initial[index].fill ?? null) ? (box.fill ?? null) : undefined
    const borderHex =
      (box.borderColor ?? null) !== (initial[index].borderColor ?? null)
        ? (box.borderColor ?? null)
        : undefined
    if (fillHex === undefined && borderHex === undefined) return null
    changed = true
    return { fillHex, borderHex }
  })
  return changed ? styles : null
}

interface ShapeWrapChange {
  index: number
  shapeId?: string
  wrap: ImageWrap | null
  wrapChanged: boolean
  z?: number
  zChanged: boolean
}

/** Per-box wrap/rank changes of a shape node vs its parsed original. */
function shapeWrapPatchOf(
  node: { attrs?: Record<string, unknown> } | null,
  original: Block,
): ShapeWrapChange[] {
  const boxes = node?.attrs?.textboxes as TextboxDisplay[] | undefined
  const originals = original.textboxes
  if (!Array.isArray(boxes) || !originals?.length) return []
  const out: ShapeWrapChange[] = []
  const count = Math.min(boxes.length, originals.length)
  for (let i = 0; i < count; i++) {
    const mode = shapeWrapOf(boxes[i])
    const origMode = shapeWrapOf(originals[i])
    const z = boxes[i].z ?? 0
    const origZ = originals[i].z ?? 0
    const wrapChanged = mode !== origMode
    const zChanged = z !== origZ
    if (wrapChanged || zChanged) {
      out.push({
        index: i,
        shapeId: boxes[i].shapeId,
        wrap: mode,
        wrapChanged,
        ...(zChanged ? { z } : {}),
        zChanged,
      })
    }
  }
  return out
}

function fieldTextPatch(node: PmNode, original: Block): FieldTextPatch | null {
  const current = node.attrs?.fieldDisplay as FieldDisplay | null
  const initial = original.fieldDisplay
  if (!current || !initial || current.kind !== initial.kind) return null
  const patch: FieldTextPatch = {}
  if ((current.left ?? '') !== (initial.left ?? '')) patch.left = current.left ?? ''
  if (current.kind === 'tocLine' && (current.right ?? '') !== (initial.right ?? '')) {
    patch.right = current.right ?? ''
  }
  return Object.keys(patch).length > 0 ? patch : null
}

function formulaTokensPatch(node: PmNode, original: Block): string[] | null {
  const current = node.attrs?.formulaDisplay as FormulaDisplay | null
  const initial = original.formulaDisplay
  if (!current || !initial || current.tokens.length !== initial.tokens.length) return null
  return current.tokens.some((token, i) => token !== initial.tokens[i]) ? current.tokens : null
}

/**
 * High-fidelity pPr passthrough for in-place paragraph edits: text-only edits
 * reuse the original <w:pPr> bytes verbatim; format edits merge the six
 * format-model children into it (everything else keeps its bytes). Structure
 * changes (type / style / list) fall back to a full rebuild.
 */

/**
 * High-fidelity pPr passthrough for in-place paragraph edits: text-only edits
 * reuse the original <w:pPr> bytes verbatim; format edits merge the six
 * format-model children into it (everything else keeps its bytes). Structure
 * changes (type / style / list) fall back to a full rebuild.
 */
function applyRawPPr(generated: GeneratedBlock, original: Block): void {
  const structureSame =
    original.type === generated.type &&
    (original.level ?? null) === (generated.level ?? null) &&
    (original.styleId ?? null) === (generated.styleId ?? null) &&
    JSON.stringify(original.list ?? null) === JSON.stringify(generated.list ?? null)
  if (original.rawPPr === undefined) {
    // a pPr-less paragraph laid out with the Normal style's character-unit
    // indents: an indent edit must also write their cancel attributes
    // (w:firstLineChars="0"…), which only mergePPrFormat knows how to do —
    // the generator's plain rebuild would let the style indent win on reload
    if (
      !original.format?.charIndents ||
      !structureSame ||
      generated.type !== 'paragraph' ||
      indentSame(original.format, generated.format)
    )
      return
    let built = mergePPrFormat('', generated.format, original.format)
    if (generated.pPrChange) built = setPPrChange(built, generated.pPrChange)
    generated.rawPPr = built
    return
  }
  if (!structureSame) return
  const formatSame =
    JSON.stringify(normalizedFormat(original.format)) ===
    JSON.stringify(normalizedFormat(generated.format))
  let rawPPr = formatSame
    ? original.rawPPr
    : mergePPrFormat(original.rawPPr, generated.format, original.format)
  // Strip pPrChange when the user accepted/rejected it (pPrChange: null in generated block)
  if (generated.pPrChange === null && original.pPrChangeInfo !== undefined) {
    rawPPr = stripPPrChange(rawPPr)
  } else if (generated.pPrChange) {
    rawPPr = setPPrChange(rawPPr, generated.pPrChange)
  }
  generated.rawPPr = rawPPr
}

export function pmNodeToGeneratedBlock(node: PmNode): GeneratedBlock {
  const runs = inlineToRuns(node.content ?? [])
  const format = nodeFormat(node)
  const bookmarks = nodeBookmarks(node, 'bookmarks')
  const hiddenBookmarks = nodeBookmarks(node, 'hiddenBookmarks')
  const commentStarts = nodeBookmarks(node, 'commentStarts')
  const commentEnds = nodeBookmarks(node, 'commentEnds')
  if (node.type === 'docHeading') {
    const pPrChange = node.attrs?.pPrChange as string | null | undefined
    const blockRevision = node.attrs?.blockRevision as GeneratedBlock['blockRevision']
    return {
      type: 'heading',
      level: Number(node.attrs?.level) || 1,
      ...(node.attrs?.outlineOnly ? { outlineOnly: true } : {}),
      styleId: (node.attrs?.styleId as string) ?? undefined,
      format,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs,
      ...(pPrChange !== undefined ? { pPrChange: pPrChange ?? null } : {}),
      ...(blockRevision !== undefined ? { blockRevision: blockRevision ?? null } : {}),
    }
  }
  if (node.type === 'docListItem') {
    const numId = node.attrs?.numId as string | null
    if (numId) {
      const pPrChange = node.attrs?.pPrChange as string | null | undefined
      const blockRevision = node.attrs?.blockRevision as GeneratedBlock['blockRevision']
      return {
        type: 'listItem',
        styleId: (node.attrs?.styleId as string) ?? undefined,
        list: {
          kind: (node.attrs?.kind as 'bullet' | 'ordered') ?? 'bullet',
          numId,
          ilvl: Number(node.attrs?.ilvl) || 0,
        },
        format,
        bookmarks,
        hiddenBookmarks,
        commentStarts,
        commentEnds,
        runs,
        ...(pPrChange !== undefined ? { pPrChange: pPrChange ?? null } : {}),
        ...(blockRevision !== undefined ? { blockRevision: blockRevision ?? null } : {}),
      }
    }
    // list item without a docx numbering id degrades to a plain paragraph with marker
    return {
      type: 'paragraph',
      format,
      bookmarks,
      hiddenBookmarks,
      commentStarts,
      commentEnds,
      runs: [{ text: '• ' }, ...runs],
    }
  }
  // Extract sdtShell from node attrs (serialized as JSON)
  const sdtShell = node.attrs?.sdtShell
    ? (() => {
        try {
          const parsed = JSON.parse(String(node.attrs.sdtShell))
          return parsed && typeof parsed === 'object' ? parsed : undefined
        } catch {
          return undefined
        }
      })()
    : undefined
  // pPrChange: propagate to GeneratedBlock so applyRawPPr can strip it when accepted
  const pPrChange = node.attrs?.pPrChange as string | null | undefined
  const blockRevision = node.attrs?.blockRevision as GeneratedBlock['blockRevision']
  return {
    type: 'paragraph',
    styleId: (node.attrs?.styleId as string) ?? undefined,
    format,
    bookmarks,
    hiddenBookmarks,
    commentStarts,
    commentEnds,
    runs,
    ...(sdtShell ? { sdtShell } : {}),
    // carry pPrChange through: null means "user accepted/rejected, strip from rawPPr"
    ...(pPrChange !== undefined ? { pPrChange: pPrChange ?? null } : {}),
    ...(blockRevision !== undefined ? { blockRevision: blockRevision ?? null } : {}),
  }
}

function nodeBookmarks(
  node: PmNode,
  attr: 'bookmarks' | 'hiddenBookmarks' | 'commentStarts' | 'commentEnds',
): string[] | undefined {
  const value = node.attrs?.[attr] as string[] | null | undefined
  return Array.isArray(value) && value.length > 0 ? value : undefined
}

function normalizedRuns(runs: Run[]): unknown[] {
  return mergeRuns(runs).map((r) =>
    // a picture/rule run's rPr-derived display fields do not survive the image
    // node round trip; its identity is the fragment plus the raw rPr it re-emits
    r.text === '' && r.image
      ? ['image', r.rawRPr ?? null, r.image.xml, r.link?.href ?? null, revisionKey(r)]
      : [
          r.text,
          r.rawRPr ?? null,
          r.styleId ?? null,
          !!r.bold,
          !!r.italic,
          !!r.underline,
          !!r.strike,
          r.color ?? null,
          r.sizeHalfPoints ?? null,
          r.font ?? null,
          r.fontAscii ?? null,
          r.eastAsiaFont ?? null,
          r.highlight ?? null,
          ...charFormatKey(r),
          r.vertAlign ?? null,
          r.link?.href ?? null,
          r.commentIds?.join(' ') ?? null,
          revisionKey(r),
          r.noteRef ? [r.noteRef.kind, r.noteRef.id] : null,
          r.xeTerm ?? null,
          r.refField ?? null,
          r.instrField ?? null,
          r.fldBeginXml ?? null,
          r.fldDirty ?? null,
          r.sdtCheckboxXml ?? null,
          r.math?.omml ?? null,
          r.sym ? [r.sym.font, r.sym.char] : null,
          r.ruby?.xml ?? null,
          r.image?.xml ?? null,
        ],
  )
}

/** same indent twips in two paragraph formats (an explicit 0 differs from unset, as emitted) */
function indentSame(a: ParaFormat | undefined, b: ParaFormat | undefined): boolean {
  const norm = (v: number | undefined) => (v !== undefined ? Math.round(v) : null)
  return (
    norm(a?.indentLeft) === norm(b?.indentLeft) &&
    norm(a?.indentRight) === norm(b?.indentRight) &&
    norm(a?.indentFirstLine) === norm(b?.indentFirstLine)
  )
}

export function signatureOfBlock(block: Block): string {
  return JSON.stringify({
    type: block.type,
    level: block.level ?? null,
    styleId: block.styleId ?? null,
    list: block.list ? [block.list.kind, block.list.numId, block.list.ilvl] : null,
    format: normalizedFormat(block.format),
    bookmarks: block.bookmarks ?? null,
    hiddenBookmarks: block.hiddenBookmarks ?? null,
    commentStarts: block.commentStarts ?? null,
    commentEnds: block.commentEnds ?? null,
    runs: normalizedRuns(block.runs ?? []),
    // include pPrChangeInfo in signature: present = has pPrChange, absent = clean
    pPrChange: block.pPrChangeInfo ? JSON.stringify(block.pPrChangeInfo) : null,
    blockRevision: block.blockRevision ?? null,
  })
}

export function signatureOfGenerated(block: GeneratedBlock): string {
  return JSON.stringify({
    type: block.type,
    level: block.level ?? null,
    styleId: block.styleId ?? null,
    list: block.list ? [block.list.kind, block.list.numId, block.list.ilvl] : null,
    format: normalizedFormat(block.format),
    bookmarks: block.bookmarks ?? null,
    hiddenBookmarks: block.hiddenBookmarks ?? null,
    commentStarts: block.commentStarts ?? null,
    commentEnds: block.commentEnds ?? null,
    runs: normalizedRuns(block.runs),
    // include pPrChange in signature: null (accepted/rejected) != non-null (has pPrChange)
    pPrChange: block.pPrChange ?? null,
    blockRevision: block.blockRevision ?? null,
  })
}
