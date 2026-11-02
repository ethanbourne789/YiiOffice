/**
 * Edit handlers for Wails: wire pptx-engine functions to the slides-bridge.
 *
 * Each handler accesses the OpenedPptx model, calls pptx-engine, then
 * re-renders the affected slide(s). Handlers not implemented here remain
 * no-op through the callEdit fallback.
 */
import type { NewChartKind, OpenedPptx, PackageArchive, SmartArtLayout } from '@yiioffice/pptx-engine'
import type { RenderSlide } from '@yiioffice/pptx-render'
import {
  setElementFill,
  setElementImageFill,
  setElementEffects,
  setSlideTransition,
  getSlideTransition,
  setSlideAnimations,
  getSlideAnimations,
  setSlideHidden,
  insertBlankSlide,
  deleteSlide,
  duplicateSlide as engineDuplicateSlide,
  copySlide as engineCopySlide,
  pasteSlide as enginePasteSlide,
  insertSlideWithLayout,
  groupElements as engineGroupElements,
  ungroupElement as engineUngroupElement,
  reorderElement as engineReorderElement,
  copyElementData,
  pasteElements as enginePasteElements,
  setSlideLayout,
  setSlideSize,
  setShapePresetGeometry,
  setShapeAdjustValues,
  setElementTextAnchor,
  setElementTextBodyProps,
  setPictureOpacity,
  editPictureSrcRect,
  setSlideBackground,
  deleteElement as engineDeleteElement,
  addPicture as engineAddPicture,
  replacePictureBytes as engineReplacePictureBytes,
  updateConnectorsForMoved,
  setElementConnection,
  addTable as engineAddTable,
  editTableCellText,
  editTableStructure,
  mergeTableCells,
  setTableColWidth,
  setTableRowHeight,
  editTableStyle,
  setElementLink,
  getElementLink,
  getSlideLinks,
  getRunLinks,
  addElement as engineAddElement,
  addChart as engineAddChart,
  editChartElement,
  getChartElementData,
  addSmartArt as engineAddSmartArt,
  addMedia as engineAddMedia,
  addModel3d,
  setShapeCustomGeometry,
  getSlideNotes,
  setSlideNotes,
  getSlideComments,
  addSlideComment,
  deleteSlideComment,
  getSections,
  setSections as engineSetSections,
  addSection as engineAddSection,
  renameSection as engineRenameSection,
  removeSection as engineRemoveSection,
  moveSection as engineMoveSection,
  moveSlide as engineMoveSlide,
  applyThemeToArchive,
  readHeaderFooter,
  applyHeaderFooter,
  listMasterParts,
  parseMasterPart,
  listSlideLayouts,
  setSlideAdvanceTime,
  patchElementStroke,
  patchedElementXml,
  listEmbeddedFonts,
} from '@yiioffice/pptx-engine'
import { renderSlide, renderAllSlides } from './pptx-model'

import type { UndoStack } from './undo-stack'

export interface EditHandlerContext {
  openedPptxRef: { current: OpenedPptx | null }
  fitWidthPx: number
  setDirty: (d: boolean) => void
  applySlide: (slideIndex: number, updated: RenderSlide) => void
  applyDeck: (slides: RenderSlide[], goTo?: number) => void
  getCurrent: () => number
  /** Optional undo stack — when provided, edits are snapshotted and undo/redo work */
  undoStack?: UndoStack
}

export function createEditHandlers(ctx: EditHandlerContext): Record<string, (...args: any[]) => Promise<any>> {
  const h: Record<string, (...args: any[]) => Promise<any>> = {}

  const getOpened = (): OpenedPptx => {
    const o = ctx.openedPptxRef.current
    if (!o) throw new Error('No file open')
    return o
  }

  /** Wrap an edit handler to push an undo snapshot before executing */
  async function wrapEdit(fn: (...args: any[]) => Promise<any>, ...args: any[]): Promise<any> {
    if (ctx.undoStack) {
      const opened = ctx.openedPptxRef.current
      if (opened) await ctx.undoStack.push(opened)
    }
    return fn(...args)
  }

  const applySlideDirty = (idx: number): RenderSlide | null => {
    const s = renderSlide(getOpened(), idx, { fitWidthPx: ctx.fitWidthPx })
    if (s) ctx.applySlide(idx, s)
    ctx.setDirty(true)
    return s
  }

  const applyDeckDirty = (goTo?: number): RenderSlide[] => {
    const all = renderAllSlides(getOpened(), { fitWidthPx: ctx.fitWidthPx })
    ctx.applyDeck(all, goTo)
    ctx.setDirty(true)
    return all
  }

  // ── Fill ──
  h.editFill = async (op: { slideIndex: number; sourceId: string; fill: any; groupId?: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setElementFill(opened, slide, op.sourceId, op.fill, { groupId: op.groupId })
    return applySlideDirty(op.slideIndex)
  })

  // ── Effects ──
  h.setEffects = async (op: { slideIndex: number; sourceId: string; effects: any }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setElementEffects(slide, op.sourceId, op.effects)
    return applySlideDirty(op.slideIndex)
  })

  // ── Group / Ungroup ──
  h.groupElements = async (op: { slideIndex: number; sourceIds: string[] }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const result = engineGroupElements(opened, op.slideIndex, op.sourceIds)
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, groupId: result?.groupId } : null
  })

  h.ungroupElement = async (op: { slideIndex: number; sourceId: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    engineUngroupElement(opened, op.slideIndex, op.sourceId)
    return applySlideDirty(op.slideIndex)
  })

  // ── Reorder ──
  h.reorderElement = async (op: { slideIndex: number; sourceId: string; direction: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    engineReorderElement(slide, op.sourceId, op.direction as 'front' | 'back' | 'forward' | 'backward')
    return applySlideDirty(op.slideIndex)
  })

  // ── Shape geometry ──
  h.changeShape = async (op: { slideIndex: number; sourceId: string; prst: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setShapePresetGeometry(slide, op.sourceId, op.prst)
    return applySlideDirty(op.slideIndex)
  })

  h.setShapeAdjust = async (op: { slideIndex: number; sourceId: string; adjust: Record<string, number> }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setShapeAdjustValues(slide, op.sourceId, op.adjust)
    return applySlideDirty(op.slideIndex)
  })

  // ── Text anchor / body props ──
  h.setTextAnchor = async (op: { slideIndex: number; sourceId: string; anchor: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setElementTextAnchor(slide, op.sourceId, op.anchor as 'top' | 'middle' | 'bottom')
    return applySlideDirty(op.slideIndex)
  })

  h.setTextBodyProps = async (op: { slideIndex: number; sourceId: string; props: any }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setElementTextBodyProps(slide, op.sourceId, op.props)
    return applySlideDirty(op.slideIndex)
  })

  // ── Picture operations ──
  h.editPictureSrcRect = async (op: { slideIndex: number; sourceId: string; srcRect: any }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    editPictureSrcRect(slide, op.sourceId, op.srcRect)
    return applySlideDirty(op.slideIndex)
  })

  h.editPictureOpacity = async (op: { slideIndex: number; sourceId: string; opacity: number }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setPictureOpacity(slide, op.sourceId, op.opacity)
    return applySlideDirty(op.slideIndex)
  })

  h.replacePictureBytes = async (op: {
    slideIndex: number; sourceId: string;
    bytes: number[]; ext: string; keepSrcRect?: boolean;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const uint8 = new Uint8Array(op.bytes)
    engineReplacePictureBytes(opened, slide, op.sourceId, uint8, op.ext, { keepSrcRect: op.keepSrcRect })
    return applySlideDirty(op.slideIndex)
  })

  // ── Clipboard ──
  h.copyElements = async (op: { slideIndex: number; sourceIds: string[] }) => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return 0
    const items: any[] = []
    for (const id of op.sourceIds) {
      const el = slide.elements.find((e: any) => e.id === id)
      if (el) items.push(copyElementData(opened, slide, el))
    }
    if (items.length) {
      sessionStorage.setItem('slides-clipboard', JSON.stringify(items))
      return items.length
    }
    return 0
  }

  h.pasteElements = async (op: { slideIndex: number }) => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const stored = sessionStorage.getItem('slides-clipboard')
    if (!stored) return null
    try {
      const items = JSON.parse(stored)
      const result = enginePasteElements(opened, op.slideIndex, items, { dx: 100000, dy: 100000 })
      if (result) {
        const updated = applySlideDirty(op.slideIndex)
        return updated ? { slide: updated, sourceIds: result.elementIds } : null
      }
    } catch { /* ignore */ }
    return null
  }

  h.clipboardProbe = async () => !!sessionStorage.getItem('slides-clipboard')

  // ── Slide operations ──
  h.addBlankSlide = async (op: { sourceIndex: number }) => wrapEdit(async () => {
    const opened = getOpened()
    const newSlide = insertBlankSlide(opened, op.sourceIndex)
    if (!newSlide) return null
    const all = applyDeckDirty(op.sourceIndex + 1)
    return { slides: all, index: op.sourceIndex + 1 }
  })

  h.deleteSlides = async (op: { slideIndexes: number[] }) => wrapEdit(async () => {
    const opened = getOpened()
    const indexes = [...op.slideIndexes].sort((a, b) => b - a)
    for (const idx of indexes) deleteSlide(opened, idx)
    return applyDeckDirty()
  })

  h.setHidden = async (op: { slideIndex: number; hidden: boolean }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setSlideHidden(slide, op.hidden)
    return applySlideDirty(op.slideIndex)
  })

  // ── Transition / Animation ──
  h.setTransition = async (op: { slideIndex: number; kind: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return false
    setSlideTransition(slide, op.kind as any)
    ctx.setDirty(true)
    return true
  })

  h.getTransition = async (slideIndex: number) => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return 'none'
    return getSlideTransition(slide)
  }

  h.setAnimations = async (op: { slideIndex: number; items: any[] }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return false
    setSlideAnimations(slide, op.items)
    ctx.setDirty(true)
    return true
  })

  h.getAnimations = async (slideIndex: number) => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return []
    return getSlideAnimations(slide)
  }

  // ── Layout / Size ──
  h.setSlideLayout = async (op: { slideIndex: number; layoutPath: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setSlideLayout(opened, op.slideIndex, op.layoutPath)
    return applySlideDirty(op.slideIndex)
  })

  h.setSlideSize = async (op: { cx: number; cy: number }) => wrapEdit(async () => {
    const opened = getOpened()
    setSlideSize(opened, op.cx, op.cy)
    return applyDeckDirty()
  })

  // ── Background ──
  h.editBackground = async (op: { slideIndex: number; bg: any; allSlides?: boolean }) => wrapEdit(async () => {
    const opened = getOpened()
    if (op.allSlides) {
      for (const slide of opened.deck.slides) {
        setSlideBackground(opened, slide, op.bg)
      }
      return applyDeckDirty()
    } else {
      const slide = opened.deck.slides[op.slideIndex]
      if (!slide) return null
      setSlideBackground(opened, slide, op.bg)
      return applySlideDirty(op.slideIndex)
    }
  })

  // Note: fontDownload is a safe stub — renderer-only mode has no Go backend
  // for font catalog management. privateFontFaces/privateFontData read
  // embedded fonts from the opened PPTX via listEmbeddedFonts.
  const embeddedFontCache = {
    faces: [] as Array<{ id: string; family: string; bold: boolean; italic: boolean; sfnt: Uint8Array }>,
    archiveRef: null as PackageArchive | null,
  }

  // ── Private font faces (embedded in PPTX) ──────────────────────────────
  h.privateFontFaces = async () => {
    const opened = ctx.openedPptxRef.current
    if (!opened) return []
    // Re-extract when the opened file changes (archive ref changed)
    if (embeddedFontCache.archiveRef !== opened.archive) {
      const fonts = listEmbeddedFonts(opened.archive)
      embeddedFontCache.faces = fonts.map((f, i) => ({
        id: `${f.typeface}-${f.style}-${i}`,
        family: f.typeface,
        bold: f.style === 'bold' || f.style === 'boldItalic',
        italic: f.style === 'italic' || f.style === 'boldItalic',
        sfnt: f.sfnt,
      }))
      embeddedFontCache.archiveRef = opened.archive
    }
    return embeddedFontCache.faces.map((f) => ({
      id: f.id,
      family: f.family,
      bold: f.bold,
      italic: f.italic,
    }))
  }

  // ── Private font data (sfnt bytes for a given face id) ─────────────────
  h.privateFontData = async (id: string) => {
    const face = embeddedFontCache.faces.find((f) => f.id === id)
    if (!face) return null
    // Convert Uint8Array to ArrayBuffer (what doc-fonts.ts / export-fonts.ts expect)
    return face.sfnt.buffer as ArrayBuffer
  }

  // ── Font download (stub — needs Go backend for font catalog) ───────────
  // Returns { ok: false } to signal "not available"; callers handle gracefully.
  h.fontDownload = async (family: string) => ({
    ok: false,
    error: `Font download not available for "${family}" in renderer-only mode`,
  })

  // ── Stroke ──────────────────────────────────────────────────────────────
  h.editStroke = async (op: {
    slideIndex: number; sourceId: string;
    stroke?: { color: string; widthEmu: number; dash?: string; cap?: string; compound?: string };
    groupId?: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const el = slide.elements.find((e: any) => e.id === op.sourceId)
    if (!el) return null
    const xml = patchedElementXml(el)
    const newXml = patchElementStroke(xml, op.stroke ? op.stroke as any : null)
    el.anchor.originalXml = newXml
    el.dirtyStroke = true
    el.dirty = true
    return applySlideDirty(op.slideIndex)
  })

  // ── Image fill ──────────────────────────────────────────────────────────
  h.editImageFill = async (op: {
    slideIndex: number; sourceId: string;
    base64?: string; ext?: string;
    tile?: boolean; groupId?: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    if (!op.base64 || !op.ext) return null
    const binary = atob(op.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    setElementImageFill(opened, slide, op.sourceId, { bytes, ext: op.ext }, {
      tile: op.tile,
      groupId: op.groupId,
    })
    return applySlideDirty(op.slideIndex)
  })

  // ── Connector endpoints ─────────────────────────────────────────────────
  h.editConnectorEndpoints = async (op: {
    slideIndex: number; sourceId: string;
    start?: { id: number; idx: number } | null;
    end?: { id: number; idx: number } | null;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const ok = setElementConnection(slide, op.sourceId, {
      start: op.start,
      end: op.end,
    })
    if (!ok) return null
    return applySlideDirty(op.slideIndex)
  })

  // ── Layouts ─────────────────────────────────────────────────────────────
  h.getLayouts = async () => {
    const opened = getOpened()
    return listSlideLayouts(opened.archive)
  }

  // ── Slide advance time (auto-advance) ──────────────────────────────────
  h.setAdvanceTimes = async (op: { slideIndex: number; ms: number | null }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    setSlideAdvanceTime(slide, op.ms)
    ctx.setDirty(true)
    return true
  })

  // ── Slide-level clipboard ──────────────────────────────────────────────
  h.copySlides = async (op: { slideIndexes: number[] }) => {
    const opened = getOpened()
    const bundles: any[] = []
    for (const idx of op.slideIndexes) {
      const b = engineCopySlide(opened, idx)
      if (b) bundles.push(b)
    }
    if (bundles.length) {
      // Store bundles as serialized strings (SlideBundle is plain JSON-ish)
      sessionStorage.setItem('slides-slide-clipboard', JSON.stringify(bundles))
      return bundles.length
    }
    return 0
  }

  h.hasSlideClipboard = async () => !!sessionStorage.getItem('slides-slide-clipboard')

  h.pasteSlide = async (op: { afterIndex?: number }) => {
    const opened = getOpened()
    const stored = sessionStorage.getItem('slides-slide-clipboard')
    if (!stored) return null
    try {
      const bundles = JSON.parse(stored)
      const afterIdx = op.afterIndex ?? ctx.getCurrent()
      let lastIdx = afterIdx
      for (const bundle of bundles) {
        const slide = enginePasteSlide(opened, lastIdx, bundle)
        if (slide) lastIdx++
      }
      return applyDeckDirty(afterIdx + 1)
    } catch { /* ignore */ }
    return null
  }

  h.repasteSlide = h.pasteSlide // repaste re-uses the last clipboard

  // ── Duplicate slides ───────────────────────────────────────────────────
  h.duplicateSlides = async (op: { slideIndexes: number[] }) => wrapEdit(async () => {
    const opened = getOpened()
    const indexes = [...op.slideIndexes].sort((a, b) => b - a)
    for (const idx of indexes) {
      const dup = engineDuplicateSlide(opened, idx)
      if (!dup) continue
      opened.deck.slides.splice(idx + 1, 0, dup)
    }
    return applyDeckDirty()
  })

  // ── Move slide(s) ──────────────────────────────────────────────────────
  h.moveSlide = async (op: { fromIndex: number; toIndex: number }) => wrapEdit(async () => {
    const opened = getOpened()
    engineMoveSlide(opened, op.fromIndex, op.toIndex)
    return applyDeckDirty()
  })

  h.moveSlides = async (op: { fromIndexes: number[]; toIndex: number }) => wrapEdit(async () => {
    // Move multiple slides by moving them one by one from end to start
    const indexes = [...op.fromIndexes].sort((a, b) => b - a)
    for (const from of indexes) {
      await h.moveSlide({ fromIndex: from, toIndex: op.toIndex })
    }
    return null
  })

  // ── Add slide with layout ──────────────────────────────────────────────
  h.addSlideWithLayout = async (op: { sourceIndex: number; layoutPath: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = insertSlideWithLayout(opened, op.sourceIndex, op.layoutPath)
    if (!slide) return null
    const all = applyDeckDirty(op.sourceIndex + 1)
    return { slides: all, index: op.sourceIndex + 1 }
  })

  // ── Set picture srcRect (alias for editPictureSrcRect) ─────────────────
  h.setPictureSrcRect = h.editPictureSrcRect

  // ── Chart data ─────────────────────────────────────────────────────────
  h.getChartData = async (op: { slideIndex: number; sourceId: string }) => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    return getChartElementData(slide, op.sourceId)
  }

  h.getChartColorSchemes = async () => [
    { name: 'Default', colors: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#548235'] },
    { name: 'Pastel', colors: ['#70AD47', '#9FE2BF', '#D9E1F2', '#F3F3F3'] },
  ]

  // ── Insert 3D model ────────────────────────────────────────────────────
  h.insertModel = async (op: {
    slideIndex: number; base64: string; ext: string;
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const binary = atob(op.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const scale = ((): number => {
      const s = opened.deck.slides[op.slideIndex]
      return s ? opened.deck.size.cx / op.fitWidthPx : 1
    })()
    const result = await addModel3d(opened, op.slideIndex, {
      bytes,
      ext: op.ext,
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
    })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Get slide links ────────────────────────────────────────────────────
  h.getSlideLinks = async (slideIndex: number) => {
    const opened = getOpened()
    return getSlideLinks(opened, slideIndex)
  }

  h.getRunLinks = async (op: { slideIndex: number; sourceId: string }) => {
    const opened = getOpened()
    // the engine reports every run link on the slide; narrow to the requested element
    return getRunLinks(opened, op.slideIndex).filter((link) => link.elementId === op.sourceId)
  }

  // ── Clipboard external / native (safe no-op — renderer-only) ───────────
  // External clipboard access requires Go backend; native clipboard is
  // handled by browser navigator.clipboard API on the frontend side.
  h.clipboardExternal = async () => null
  h.nativeClipboard = async () => null

  // ── Master close ───────────────────────────────────────────────────────
  // Master editing is a renderer-side mode; masterClose just signals the
  // renderer to exit master mode and re-render the normal deck.
  h.masterClose = async () => {
    // No-op — renderer handles mode switching
    return null
  }

  // ── Master edit stroke (alias editStroke for master context) ───────────
  h.masterEditStroke = h.editStroke

  // ── Table: add table ─────────────────────────────────────────────────
  h.addTable = async (op: {
    slideIndex: number; rows: number; cols: number;
    xPx: number; yPx: number; wPx: number; hPx: number;
    rowHeightEmu?: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    const result = engineAddTable(opened, op.slideIndex, {
      rows: op.rows,
      cols: op.cols,
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
      ...(op.rowHeightEmu ? { rowHeightsEmu: Array(op.rows).fill(op.rowHeightEmu) } : {}),
    })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Table: edit cell text ────────────────────────────────────────────
  h.editTableCell = async (op: {
    slideIndex: number; sourceId: string;
    row: number; col: number; paragraphs: any[];
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    editTableCellText(slide, op.sourceId, op.row, op.col, op.paragraphs)
    return applySlideDirty(op.slideIndex)
  })

  // ── Table: structure (insert/delete row/col) ─────────────────────────
  h.tableStructure = async (op: {
    slideIndex: number; sourceId: string;
    kind: string; index: number; before?: boolean;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const result = editTableStructure(opened, op.slideIndex, op.sourceId, {
      kind: op.kind as any,
      index: op.index,
      ...(op.before ? { before: true } : {}),
    } as any)
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Table: merge/split cells ─────────────────────────────────────────
  h.tableMerge = async (op: {
    slideIndex: number; sourceId: string;
    kind: string; row: number; col: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const result = mergeTableCells(opened, op.slideIndex, op.sourceId, {
      kind: op.kind as any,
      row: op.row,
      col: op.col,
    } as any)
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Table: column width ──────────────────────────────────────────────
  h.setTableColWidth = async (op: {
    slideIndex: number; sourceId: string;
    col: number; wPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    setTableColWidth(slide, op.sourceId, op.col, Math.round(op.wPx * scale))
    return applySlideDirty(op.slideIndex)
  })

  // ── Table: row height ────────────────────────────────────────────────
  h.setTableRowHeight = async (op: {
    slideIndex: number; sourceId: string;
    row: number; hPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    setTableRowHeight(slide, op.sourceId, op.row, Math.round(op.hPx * scale))
    return applySlideDirty(op.slideIndex)
  })

  // ── Table: style ─────────────────────────────────────────────────────
  h.setTableStyle = async (op: {
    slideIndex: number; sourceId: string; style: any;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    editTableStyle(slide, op.sourceId, op.style)
    return applySlideDirty(op.slideIndex)
  })

  // editTableStyle is the same as setTableStyle — both bridge callers
  // (style-actions.ts and context-menu-items.ts) use this name:
  h.editTableStyle = h.setTableStyle

  // ── Link: set ────────────────────────────────────────────────────────
  h.setLink = async (op: {
    slideIndex: number; sourceId: string; target: any;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = setElementLink(opened, op.slideIndex, op.sourceId, op.target)
    if (!slide) return null
    return applySlideDirty(op.slideIndex)
  })

  // ── Link: get ────────────────────────────────────────────────────────
  h.getLink = async (slideIndex: number, sourceId: string) => {
    const opened = getOpened()
    return getElementLink(opened, slideIndex, sourceId)
  }

  // ── Element: duplicate ───────────────────────────────────────────────
  h.duplicateElements = async (op: {
    slideIndex: number; sourceIds: string[];
    dxPx: number; dyPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    const dx = Math.round(op.dxPx * scale)
    const dy = Math.round(op.dyPx * scale)
    // Copy each element's data and paste with offset
    const items: any[] = []
    for (const id of op.sourceIds) {
      const el = slide.elements.find((e: any) => e.id === id)
      if (el) items.push(copyElementData(opened, slide, el))
    }
    if (!items.length) return null
    const result = enginePasteElements(opened, op.slideIndex, items, { dx, dy })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceIds: result.elementIds } : null
  })

  // ── Element: flip ────────────────────────────────────────────────────
  h.flipElements = async (op: {
    slideIndex: number; sourceIds: string[]; axis: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    for (const id of op.sourceIds) {
      const el = slide.elements.find((e: any) => e.id === id)
      if (!el || !el.transform) continue
      if (op.axis === 'h') el.transform.flipH = !el.transform.flipH
      else el.transform.flipV = !el.transform.flipV
      el.dirtyTransform = true
    }
    return applySlideDirty(op.slideIndex)
  })

  // ── Text edit ────────────────────────────────────────────────────────
  h.editText = async (op: { slideIndex: number; sourceId: string; paragraphs: any[]; groupId?: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const el = slide.elements.find((e: any) => e.id === op.sourceId)
    if (!el || (el.type !== 'text' && el.type !== 'shape')) return null
    // Update the text model in-place and mark dirty so patchedElementXml
    // will call patchTextElementXml on save.
    ;(el as any).text = { paragraphs: op.paragraphs }
    ;(el as any).dirty = true
    return applySlideDirty(op.slideIndex)
  })

  // ── Delete element ───────────────────────────────────────────────────
  h.deleteElement = async (op: { slideIndex: number; sourceId: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    engineDeleteElement(opened, slide, op.sourceId)
    return applySlideDirty(op.slideIndex)
  })

  h.deleteElements = async (op: { slideIndex: number; sourceIds: string[] }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    for (const id of [...op.sourceIds].reverse()) {
      engineDeleteElement(opened, slide, id)
    }
    return applySlideDirty(op.slideIndex)
  })

  // ── Transform (move/resize/rotate) ───────────────────────────────────
  // Bridge passes pixel coords; handler converts to EMU using slide aspect.
  h.editTransform = async (op: {
    slideIndex: number; sourceId: string;
    xPx: number; yPx: number; wPx: number; hPx: number;
    rotationDeg: number; fitWidthPx: number;
    preview?: boolean; groupId?: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    const box = {
      x: Math.round(op.xPx * scale),
      y: Math.round(op.yPx * scale),
      cx: Math.round(op.wPx * scale),
      cy: Math.round(op.hPx * scale),
    }
    const el = slide.elements.find((e: any) => e.id === op.sourceId)
    if (!el) return null
    el.transform = {
      ...el.transform,
      offset: box,
      rot: Math.round((op.rotationDeg ?? 0) * 60000),
    }
    el.dirtyTransform = true
    updateConnectorsForMoved(slide, [op.sourceId])
    return applySlideDirty(op.slideIndex)
  })

  h.editTransformMulti = async (ops: any[]) => wrapEdit(async () => {
    for (const op of ops) {
      await h.editTransform(op)
    }
    return null
  })

  h.batchEditTransform = async (ops: any[]) => {
    return h.editTransformMulti(ops)
  }

  // ── Insert image ─────────────────────────────────────────────────────
  // Bridge passes (slideIndex, fitWidthPx). Handler picks an image file,
  // reads it, and inserts it into the slide center.
  h.insertImage = async (slideIndex: number, fitWidthPx: number) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return null
    // Use the bridge's file picker and reader
    const pickFiles = async (kind: string) => {
      try {
        const { PickFiles } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice')
        const files = await PickFiles(kind)
        return Array.isArray(files) ? files : []
      } catch { return [] }
    }
    const filesReadImage = async (path: string) => {
      try {
        const { FilesReadImage } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice')
        return await FilesReadImage(path)
      } catch { return '' }
    }
    const files = await pickFiles('image')
    if (!files.length) return null
    const base64 = await filesReadImage(files[0])
    if (!base64) return null
    // Decode base64 to Uint8Array
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    // Detect extension from path
    const ext = (files[0].split('.').pop() || 'png').toLowerCase()
    // Place image at slide center with a reasonable default size
    const imgW = Math.round(opened.deck.size.cx * 0.4)
    const imgH = imgW // square default; aspect corrected after load
    const cx = Math.round((opened.deck.size.cx - imgW) / 2)
    const cy = Math.round((opened.deck.size.cy - imgH) / 2)
    const pic = engineAddPicture(opened, slide, {
      bytes,
      ext,
      offset: { x: cx, y: cy, cx: imgW, cy: imgH },
    })
    if (!pic) return null
    const updated = applySlideDirty(slideIndex)
    return updated ? { slide: updated, sourceId: pic.id } : null
  })

  // ── Add element (textbox/shape/connector) ────────────────────────────
  h.addElement = async (op: {
    slideIndex: number; kind: string;
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
    paragraphs?: any[]; stroke?: any;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    const el = engineAddElement(slide, {
      kind: op.kind as any,
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
      ...(op.paragraphs ? { paragraphs: op.paragraphs } : {}),
      ...(op.stroke ? { stroke: op.stroke } : {}),
    })
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: el.id } : null
  })

  // ── Add image from base64 bytes ──────────────────────────────────────
  h.addImageBytes = async (op: {
    slideIndex: number; base64: string; ext: string;
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
    name?: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const binary = atob(op.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const scale = opened.deck.size.cx / op.fitWidthPx
    const pic = engineAddPicture(opened, slide, {
      bytes,
      ext: op.ext,
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
      name: op.name,
    })
    if (!pic) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: pic.id } : null
  })

  // ── Chart: add ───────────────────────────────────────────────────────
  h.addChart = async (op: {
    slideIndex: number; kind: string;
    categories?: string[]; series?: any[];
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const scale = ((): number => {
      const s = opened.deck.slides[op.slideIndex]
      return s ? opened.deck.size.cx / op.fitWidthPx : 1
    })()
    const result = engineAddChart(opened, op.slideIndex, {
      kind: op.kind as NewChartKind,
      categories: op.categories ?? [],
      series: op.series ?? [],
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
    })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Chart: edit ──────────────────────────────────────────────────────
  h.editChart = async (op: {
    slideIndex: number; sourceId: string;
    kind?: string; barDir?: string; categories?: string[]; series?: any[];
    title?: string; legendPos?: string; dataLabels?: boolean; gridlines?: boolean;
    gapWidthPct?: number; holeSizePct?: number; switchRowCol?: boolean;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    editChartElement(opened, op.slideIndex, op.sourceId, {
      ...(op.kind ? { kind: op.kind as NewChartKind } : {}),
      ...(op.barDir ? { barDir: op.barDir as 'col' | 'bar' } : {}),
      ...(op.categories ? { categories: op.categories } : {}),
      ...(op.series ? { series: op.series as Array<{ name: string; values: number[] }> } : {}),
      ...(op.title ? { title: op.title } : {}),
      ...(op.legendPos ? { legendPos: op.legendPos as 'b' | 't' | 'r' | 'l' | 'none' } : {}),
      ...(typeof op.dataLabels === 'boolean' ? { dataLabels: op.dataLabels } : {}),
      ...(typeof op.gridlines === 'boolean' ? { gridlines: op.gridlines } : {}),
      ...(typeof op.gapWidthPct === 'number' ? { gapWidthPct: op.gapWidthPct } : {}),
      ...(typeof op.holeSizePct === 'number' ? { holeSizePct: op.holeSizePct } : {}),
      ...(typeof op.switchRowCol === 'boolean' ? { switchRowCol: op.switchRowCol } : {}),
    })
    return applySlideDirty(op.slideIndex)
  })

  // ── SmartArt ─────────────────────────────────────────────────────────
  h.addSmartArt = async (op: {
    slideIndex: number; layout: string; items: any[];
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const scale = ((): number => {
      const s = opened.deck.slides[op.slideIndex]
      return s ? opened.deck.size.cx / op.fitWidthPx : 1
    })()
    const result = engineAddSmartArt(opened, op.slideIndex, {
      layout: op.layout as SmartArtLayout,
      items: op.items,
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
    })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Media: add media from bytes (audio/video/3D) ─────────────────────
  h.addMediaBytes = async (op: {
    slideIndex: number; kind: string; ext: string; fitWidthPx: number;
    name?: string; centerPx?: { x: number; y: number };
    base64?: string; path?: string;
    natural?: { width: number; height: number };
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const bytes = op.base64 ? (() => {
      const binary = atob(op.base64!)
      const b = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i)
      return b
    })() : new Uint8Array()
    const scale = ((): number => {
      const s = opened.deck.slides[op.slideIndex]
      return s ? opened.deck.size.cx / op.fitWidthPx : 1
    })()
    const result = await engineAddMedia(opened, op.slideIndex, {
      kind: op.kind as any,
      bytes,
      ext: op.ext,
      name: op.name,
      offset: {
        x: Math.round((op.centerPx?.x ?? (opened.deck.size.cx / scale - 300) / 2) * scale),
        y: Math.round((op.centerPx?.y ?? (opened.deck.size.cy / scale - 200) / 2) * scale),
        cx: Math.round(300 * scale),
        cy: Math.round(200 * scale),
      },
    })
    if (!result) return null
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Shape: custom geometry ───────────────────────────────────────────
  h.setShapeGeometry = async (op: {
    slideIndex: number; sourceId: string;
    pathPx: number[][]; fitWidthPx: number; preview?: boolean;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const scale = opened.deck.size.cx / op.fitWidthPx
    const geom = {
      path: op.pathPx.map((seg) => seg.map((v: number) => Math.round(v * scale))),
    }
    setShapeCustomGeometry(slide, op.sourceId, geom as any)
    return applySlideDirty(op.slideIndex)
  })

  // ── Notes ────────────────────────────────────────────────────────────
  h.getNotes = async (slideIndex: number) => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return ''
    return getSlideNotes(opened.archive, slide.path)
  }

  h.setNotes = async (op: { slideIndex: number; text: string }) => wrapEdit(async () => {
    const opened = getOpened()
    setSlideNotes(opened, op.slideIndex, op.text)
    ctx.setDirty(true)
    return true
  })

  // ── Comments ─────────────────────────────────────────────────────────
  h.getComments = async (slideIndex: number) => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return []
    return getSlideComments(opened.archive, slide.path)
  }

  h.addComment = async (op: { slideIndex: number; text: string }) => wrapEdit(async () => {
    const opened = getOpened()
    const c = addSlideComment(opened, op.slideIndex, {
      author: 'YiiOffice',
      text: op.text,
    })
    ctx.setDirty(true)
    return c
  })

  h.deleteComment = async (op: { slideIndex: number; authorId: number; idx: number }) => wrapEdit(async () => {
    const opened = getOpened()
    deleteSlideComment(opened, op.slideIndex, { authorId: op.authorId, idx: op.idx })
    ctx.setDirty(true)
    return true
  })

  // ── Sections ─────────────────────────────────────────────────────────
  h.getSections = async () => {
    const opened = getOpened()
    return getSections(opened)
  }

  h.setSections = async (sections: any[]) => wrapEdit(async () => {
    const opened = getOpened()
    engineSetSections(opened, sections)
    return applyDeckDirty()
  })

  h.addSection = async (op: { atSlideIndex: number; name: string }) => wrapEdit(async () => {
    const opened = getOpened()
    engineAddSection(opened, op.atSlideIndex, op.name)
    return applyDeckDirty()
  })

  // Bridge may pass { id, name } object or two separate args
  h.renameSection = async (idOrObj: any, nameMaybe?: string) => wrapEdit(async () => {
    const opened = getOpened()
    const id = typeof idOrObj === 'object' ? idOrObj.id : idOrObj
    const name = typeof idOrObj === 'object' ? idOrObj.name : (nameMaybe ?? '')
    engineRenameSection(opened, id, name)
    return applyDeckDirty()
  })

  // Bridge may pass { id } object
  h.removeSection = async (idOrObj: any) => wrapEdit(async () => {
    const opened = getOpened()
    const id = typeof idOrObj === 'object' ? idOrObj.id : idOrObj
    engineRemoveSection(opened, id)
    return applyDeckDirty()
  })

  // Bridge may pass { id, dir } object
  h.moveSection = async (idOrObj: any) => wrapEdit(async () => {
    const opened = getOpened()
    const id = typeof idOrObj === 'object' ? idOrObj.id : idOrObj
    const dir = typeof idOrObj === 'object' ? idOrObj.dir : 'down'
    engineMoveSection(opened, id, dir)
    return applyDeckDirty()
  })

  h.removeSectionSlides = async (idOrObj: any) => wrapEdit(async () => {
    const opened = getOpened()
    const id = typeof idOrObj === 'object' ? idOrObj.id : idOrObj
    const sections = getSections(opened)
    const section = sections.find((s: any) => s.id === id)
    if (!section) return null
    // Remove slides belonging to this section: descending, so each delete keeps
    // the remaining indices valid.
    for (const idx of [...section.slideIndices].reverse()) deleteSlide(opened, idx)
    // Then remove the section itself
    engineRemoveSection(opened, id)
    return applyDeckDirty()
  })

  // ── Theme ────────────────────────────────────────────────────────────
  h.applyTheme = async (op: {
    name: string; colors?: any; majorFont?: any; minorFont?: any;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    applyThemeToArchive(opened, {
      name: op.name,
      colors: op.colors ?? {},
      ...(op.majorFont ? { majorFont: op.majorFont } : {}),
      ...(op.minorFont ? { minorFont: op.minorFont } : {}),
    })
    return applyDeckDirty()
  })

  // ── Header/Footer ────────────────────────────────────────────────────
  h.getHeaderFooter = async (slideIndex?: number) => {
    const opened = getOpened()
    const si = typeof slideIndex === 'number' ? slideIndex : ctx.getCurrent()
    const slide = opened.deck.slides[si]
    if (!slide) return null
    return readHeaderFooter(slide)
  }

  h.applyHeaderFooter = async (op: {
    footer: string | null; slideNum: boolean;
    date: string | null; dateAuto?: boolean;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    applyHeaderFooter(opened, {
      footer: op.footer,
      slideNum: op.slideNum,
      date: op.dateAuto ? null : op.date,
    })
    return applyDeckDirty()
  })

  // ── Master slide ─────────────────────────────────────────────────────
  // Master slide editing reuses the regular edit handlers but operates on
  // the master/notes slide parsed via parseMasterPart. For now, wire up
  // the entry points that the renderer calls.
  h.masterOpen = async (partPath: string) => {
    const opened = getOpened()
    const masterSlide = parseMasterPart(opened.archive, partPath)
    if (!masterSlide) return null
    const s = renderSlide({ ...opened, deck: { ...opened.deck, slides: [masterSlide] } }, 0, { fitWidthPx: ctx.fitWidthPx })
    return s
  }

  h.masterEnter = async () => {
    const opened = getOpened()
    const parts = listMasterParts(opened.archive)
    return parts
  }

  h.masterEditText = h.editText
  h.masterEditTransform = h.editTransform
  h.masterEditFill = h.editFill
  h.masterDeleteElement = h.deleteElement

  // ── Ink (freehand pen) ────────────────────────────────────────────────
  // Ink strokes are rasterized to PNG by the frontend; we insert them as
  // pictures with a special name/descr so they can be identified later.
  h.addInk = async (op: {
    slideIndex: number; base64: string;
    xPx: number; yPx: number; wPx: number; hPx: number; fitWidthPx: number;
    payload?: string;
  }) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const binary = atob(op.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const scale = opened.deck.size.cx / op.fitWidthPx
    const pic = engineAddPicture(opened, slide, {
      bytes,
      ext: 'png',
      offset: {
        x: Math.round(op.xPx * scale),
        y: Math.round(op.yPx * scale),
        cx: Math.round(op.wPx * scale),
        cy: Math.round(op.hPx * scale),
      },
      name: 'aislides-ink',
    })
    if (!pic) return null
    // Store vector payload in descr for future editing
    ;(pic as any).descr = op.payload || ''
    const updated = applySlideDirty(op.slideIndex)
    return updated ? { slide: updated, sourceId: pic.id } : null
  })

  // ── Media: insert via file picker (menu "Insert > Video/Audio") ──────
  h.insertMedia = async (slideIndex: number, kind: string, fitWidthPx: number) => wrapEdit(async () => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return null
    // Use Wails file picker, then read and embed
    const pickFiles = async (k: string) => {
      try {
        const { PickFiles } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice')
        const files = await PickFiles(k)
        return Array.isArray(files) ? files : []
      } catch { return [] }
    }
    const filesRead = async (path: string) => {
      try {
        const { FilesRead } = await import('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice')
        return await FilesRead(path)
      } catch { return '' }
    }
    const files = await pickFiles(kind === 'audio' ? 'audio' : 'video')
    if (!files.length) return null
    const base64 = await filesRead(files[0])
    if (!base64) return null
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const ext = (files[0].split('.').pop() || (kind === 'audio' ? 'mp3' : 'mp4')).toLowerCase()
    const result = await engineAddMedia(opened, slideIndex, {
      kind: kind as any,
      bytes,
      ext,
      name: files[0].split('/').pop(),
      offset: {
        x: Math.round(opened.deck.size.cx * 0.15),
        y: Math.round(opened.deck.size.cy * 0.15),
        cx: Math.round(opened.deck.size.cx * 0.7),
        cy: Math.round(opened.deck.size.cy * 0.7),
      },
    })
    if (!result) return null
    const updated = applySlideDirty(slideIndex)
    return updated ? { slide: updated, sourceId: result.elementId } : null
  })

  // ── Media: extract data for playback ──────────────────────────────────
  // Reads the media bytes from the archive and returns a data URL.
  h.getMediaData = async (slideIndex: number, sourceId: string) => {
    const opened = getOpened()
    const slide = opened.deck.slides[slideIndex]
    if (!slide) return null
    const el = slide.elements.find((e) => e.id === sourceId)
    // Media elements carry the resolved zip path of the clip on the picture element.
    const media = (el as { media?: { kind: 'video' | 'audio'; target?: string } } | undefined)?.media
    const target = media?.target
    if (!media || !target) return null
    const kind: 'video' | 'audio' = media.kind
    const ext = target.split('.').pop()?.toLowerCase() ?? ''
    const bytes = opened.archive.readBytes(target)
    if (!bytes) return null
    const mime = kind === 'video'
      ? (ext === 'webm' ? 'video/webm' : 'video/mp4')
      : (ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg')
    let b64 = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      b64 += btoa(String.fromCharCode(...chunk))
    }
    return { kind, dataUrl: `data:${mime};base64,${b64}` }
  }

  // ── History batch (safe no-op stubs) ──────────────────────────────────
  // Returning false/null means "no batch opened", which the caller handles
  // gracefully by skipping the matching endHistoryBatch call.
  h.beginHistoryBatch = async () => false
  h.endHistoryBatch = async () => null

  // ── Transaction (not supported in renderer-only mode) ─────────────────
  h.applyTxn = async () => ({
    applied: false,
    failures: [{ index: 0, error: 'Transactions not supported in renderer mode' }],
  })

  // ── Undo/Redo (snapshot-based) ─────────────────────────────────────────
  h.undo = async () => {
    const stack = ctx.undoStack
    if (!stack || !stack.canUndo()) return null
    const restored = await stack.undo()
    if (!restored) return null
    // Replace the current opened model with the restored one
    ctx.openedPptxRef.current = restored
    ctx.setDirty(true)
    return renderAllSlides(restored, { fitWidthPx: ctx.fitWidthPx })
  }

  h.redo = async () => {
    const stack = ctx.undoStack
    if (!stack || !stack.canRedo()) return null
    const restored = await stack.redo()
    if (!restored) return null
    ctx.openedPptxRef.current = restored
    ctx.setDirty(true)
    return renderAllSlides(restored, { fitWidthPx: ctx.fitWidthPx })
  }

  return h
}
