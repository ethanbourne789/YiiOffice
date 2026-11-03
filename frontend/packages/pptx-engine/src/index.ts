/**
 * pptx-engine top-level API.
 *
 * Phase 1 scope: openPptx (parsing) + savePptx's "no changes = byte identical"
 * path (proving fidelity). Element-level patch regeneration is left for Phase 3.
 */
export * from './types'
export {
  REDACT_EXT_URI,
  hasRedactExtIn,
  readRedactLabel,
  redactExtXml,
  setRedactExt,
  stripRedactExt,
  syncRedactExt,
} from './redaction-xml'
export { cleanupSupersededSlideResources } from './resource-cleanup'
export type { ResourceCleanupStats } from './resource-cleanup'
export {
  animClassOf,
  isMediaEffect,
  buildTimingXml,
  DEFAULT_MOTION_PATH,
  elementSpid,
  getSlideAnimations,
  patchSlideTimingIncrementalXml,
  patchSlideTimingXml,
  readSlideTimingXml,
  setSlideAnimations,
  pruneTimingForSpids,
  cNvPrIdsInXml,
  ANIM_EFFECTS,
  ANIM_TRIGGERS,
  ANIM_DIRECTIONS,
  type AnimDirection,
  type AnimClass,
  type AnimEffectKind,
  type AnimTrigger,
  type SlideAnimation,
} from './animation'
export { PackageArchive, PPTX_ZIP_LIMITS, assertZipWithinLimits } from './zip'
export {
  listEmbeddedFonts,
  eotToSfnt,
  type EmbeddedFontFace,
  type EmbeddedFontStyle,
} from './embedded-fonts'
export { scanSlide, type SlideScan, type SpElement } from './scan'
export {
  parseSlide,
  parseDecorations,
  DEFAULT_BODY_INSETS,
  EMU_PER_PT,
  type ParseContext,
  type DecorationOptions,
} from './parse'
export { tableRowGridCols } from './table-grid'
export { parseTheme, parseClrMap, resolveSchemeColor, type Theme } from './theme'
export {
  patchTextElementXml,
  patchElementXfrm,
  patchElementFill,
  patchElementPPr,
  patchParagraphPPrXml,
  patchElementStroke,
  patchBodyPrAutofit,
  patchPictureSrcRect,
  patchSlideAdvanceTimeXml,
  patchSlideBackgroundXml,
  patchSlideHiddenXml,
  patchSlideShowMasterSpXml,
  patchSlideTransitionXml,
  readSlideAdvanceTimeXml,
  readSlideHiddenXml,
  readSlideTransitionXml,
  removeSlideBackgroundXml,
  generateParagraphXml,
  generateXfrmXml,
  isConnectorXml,
  TRANSITION_KINDS,
  type GradientFillPatch,
  type BackgroundImagePatch,
  type SlideTransitionKind,
  type StrokePatch,
} from './generate'
export {
  addElement,
  addPicture,
  addImageMediaAndRel,
  deleteElement,
  buildSpXml,
  buildTableXml,
  buildTableGridXml,
  MAX_INSERT_TABLE_DIM,
  buildGrpSpXml,
  calcBoundingBox,
  type NewElementOptions,
  type NewElementBodyPr,
  type NewPictureOptions,
  type NewShapeKind,
  type NewTableOptions,
  type NewTableCellSpec,
  type NewTableGridOptions,
} from './insert'
export {
  alignRects,
  distributeRects,
  type AlignKind,
  type DistributeKind,
  type AlignRect,
} from './align'
export { createBlankPptx } from './blank'
export {
  BUILTIN_TABLE_STYLES,
  builtinTableStyleName,
  resolveBuiltinTableStyleId,
  type BuiltinTableStyle,
} from './table-style'
export {
  elementCNvPrId,
  elementDurableId,
  ensureCreationId,
  groupChildDurableId,
  matchesElementRef,
  slideDurableId,
} from './identity'
export { promoteSlideBackground, isBackgroundLikeElement } from './background-promote'
export {
  applyThemeToArchive,
  buildColorMap,
  collectExplicitColors,
  patchThemeXml,
  recolorXml,
  remapDeckColors,
  type ThemeSpec,
} from './theme-apply'
export { escapeXmlText, escapeXmlAttr } from './xml-utils'
export {
  custGeomXml,
  parseCustGeom,
  validCustGeomPath,
  CUST_GEOM_PT_COUNT,
  type CustGeomPath,
  type CustGeomPathCmd,
} from './custgeom'
export {
  extractFormat,
  applyFormat,
  type CopiedFormat,
  type ShapeFormat,
  type TextRunFormat,
  type ParagraphFormat,
  type FormatPatchResult,
} from './format-brush'
export { listSlideLayouts, type SlideLayoutInfo, type LayoutPlaceholder } from './layout'
export {
  BUILTIN_LAYOUTS,
  BUILTIN_LAYOUT_PREFIX,
  builtinLayoutInfos,
  ensureBuiltinLayout,
  shouldOfferBuiltinLayouts,
  type BuiltinLayoutDef,
} from './builtin-layouts'
export {
  parsePlaceholderMap,
  resolvePlaceholderTransform,
  parseMasterTextStyles,
  parseLstStyleLevels,
  placeholderStyleChain,
  mergeTextStyleChain,
  type PlaceholderMap,
  type PlaceholderGeom,
  type LevelTextStyle,
  type TextStyleLevels,
  type MasterTextStyles,
} from './placeholder'
export { resolveFontRef } from './theme'
export { resolveColorNode, applyColorMods } from './color'
export {
  parseChartXml,
  type ChartModel,
  type ChartSeries,
  type ChartKind,
  type ChartAxisStyle,
} from './chart'
export { parseChartExXml } from './chartex'
export { getSlideNotes, setSlideNotes, notesPathForSlide, unescapeXml } from './notes'
export {
  getSlideComments,
  addSlideComment,
  deleteSlideComment,
  type SlideComment,
} from './comments'
export {
  setElementLink,
  getElementLink,
  getSlideLinks,
  getRunLinks,
  ensureRunLinkRels,
  encodeRunLink,
  decodeRunLink,
  type LinkTarget,
} from './hyperlink'
export { NAMED_ACTIONS, namedActionOf, type NamedAction } from './named-action'
export {
  addChart,
  buildChartSpaceXml,
  type NewChartKind,
  type NewChartOptions,
} from './chart-insert'
export {
  addSmartArt,
  buildSmartArtXml,
  type SmartArtLayout,
  type NewSmartArtOptions,
} from './smartart'
export {
  addMedia,
  addModel3d,
  model3dPartOf,
  solidPng,
  type NewMediaOptions,
  type NewModel3dOptions,
} from './media-insert'
export { applyHeaderFooter, readHeaderFooter, type HeaderFooterOptions } from './headerfooter'
export {
  getSections,
  setSections,
  addSection,
  renameSection,
  removeSection,
  moveSection,
  moveSlide,
  normalizeSections,
  type SectionInfo,
} from './sections'
export {
  collectSlideBundle,
  importSourceLayout,
  materializeSlideBundle,
  chooseLayout,
  listLayouts,
  type SlideBundle,
  type SlideBundleChain,
} from './slide-transfer'
export {
  patchTableStyleXml,
  findTableElementInSlide,
  ensureTableStyleXml,
  TABLE_STYLE_PRESETS,
  type TableStyleEdit,
  type TableStylePreset,
} from './table-edit'
export { listMasterParts, parseMasterPart, type MasterPartInfo } from './master-edit'

export {
  type OpenedPptx,
  openPptx,
  reparseDeck,
  savePptx,
  savePptxToFile,
  commitSaved,
} from './package'
export { patchSlideXml, patchedElementXml, reassembleSlideXml } from './builder/patch'
export {
  type ElementFontPatch,
  type FontSizeMap,
  type ParagraphFormatPatch,
  applyParagraphFormat,
  strokePatchToModel,
} from './builder/shared'
export {
  setSlideBackground,
  setSlideBackgroundImage,
  resetSlideBackground,
  setSlideBgGraphicsHidden,
} from './builder/background'
export {
  editPictureSrcRect,
  setShapePresetGeometry,
  setShapeCustomGeometry,
  setShapeAdjustValues,
} from './builder/geometry'
export {
  setElementTextAnchor,
  autofitGeneratedTextBoxes,
  type TextBodyPropsPatch,
  setElementTextBodyProps,
  type EffectsPatch,
  setElementEffects,
  setElementFill,
  setElementImageFill,
  setElementRedaction,
  setPictureOpacity,
  replacePictureBytes,
} from './builder/fill-effects'
export {
  duplicateSlide,
  copySlide,
  pasteSlide,
  insertBlankSlide,
  mergeSlideFromPptx,
  type MergeSlideOptions,
  type MergeSlideSource,
  extractMergeSlideSource,
  mergeSlideFromSource,
  insertSlideWithLayout,
  deleteSlide,
  type ReorderDirection,
  reorderElement,
  materializeSlide,
  appendRawElements,
  setSlideTransition,
  getSlideTransition,
  setSlideAdvanceTime,
  getSlideAdvanceTime,
  setSlideHidden,
  getSlideHidden,
} from './builder/slide-ops'
export {
  type ConnectionSide,
  connectionSiteForSide,
  updateConnectorsForMoved,
  setElementConnection,
} from './builder/connectors'
export { setSlideLayout, resetSlideLayout, setSlideSize } from './builder/slide-layout'
export {
  addTable,
  editTableCellText,
  editTableStyle,
  ensureTableStylePart,
  type TableStructureOp,
  editTableStructure,
  type TableMergeOp,
  mergeTableCells,
  setTableColWidth,
  setTableRowHeight,
  resizeTable,
  setTableCellAnchor,
} from './builder/table'
export { editChartElement, markChartEditable, getChartElementData } from './builder/chart'
export {
  setElementFont,
  type ReplaceOptions,
  replaceAllInDeck,
  setElementParagraphFormat,
} from './builder/text'
export { type ElementClipboardItem, copyElementData, pasteElements } from './builder/clipboard'
export {
  groupElements,
  ungroupElement,
  type GroupChildSlice,
  groupChildSlices,
  patchGroupChildXml,
  findGroupChild,
  editGroupChildTransform,
  patchGroupChildText,
  setGroupChildFont,
  editGroupChildFill,
  editGroupChildStroke,
  setGroupChildParagraphFormat,
  setGroupChildShapeAdjustValues,
  setGroupChildShapePresetGeometry,
  setGroupChildShapeCustomGeometry,
} from './builder/group'
