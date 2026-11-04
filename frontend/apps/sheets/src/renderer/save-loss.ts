/**
 * Detects save-payload content the Go workbook engine cannot persist.
 *
 * The engine only applies cell edits, hyperlink edits, structural
 * (row/column/merge) ops and bulk constant fills (see internal/workbook/reads.go
 * Save). Everything else the renderer journals — charts, floating objects,
 * pivots, tables, notes, conditional formatting, data validation, page setup,
 * filters, sparklines, sheet add/remove/rename, defined names, themes and
 * protection — is silently dropped by the JSON decode on the Go side. This
 * module turns those into an explicit list so the save flow can warn before
 * writing.
 */

export type UnpersistedSaveCategory =
  | 'charts'
  | 'visuals'
  | 'pivots'
  | 'tables'
  | 'notes'
  | 'conditionalFormatting'
  | 'dataValidation'
  | 'pageSetup'
  | 'filters'
  | 'sparklines'
  | 'sheets'
  | 'definedNames'
  | 'theme'
  | 'protection'

/** The subset of a save request that matters for loss detection. */
export interface SaveLossProbe {
  chartEdits: readonly unknown[]
  visualEdits: readonly unknown[]
  visualAdditions: readonly unknown[]
  tableAdditions: readonly unknown[]
  tableEdits: readonly unknown[]
  pivotAdditions: readonly unknown[]
  pivotCacheRefreshPaths: readonly unknown[]
  pivotRefreshUpdates: readonly unknown[]
  sheetOps: readonly unknown[]
  filterStates: readonly unknown[]
  cfStates: readonly unknown[]
  dvStates: readonly unknown[]
  pageSetupStates: readonly unknown[]
  noteStates: readonly unknown[]
  sheetProtections: readonly unknown[]
  sparklineAdditions: readonly unknown[]
  definedNamesState: unknown | null
  themeState: unknown | null
  workbookProtectionState: unknown | null
  protectedRangeStates: readonly unknown[]
}

/** Stable report order (heaviest user-visible loss first). */
const CATEGORY_ORDER: readonly UnpersistedSaveCategory[] = [
  'charts',
  'visuals',
  'pivots',
  'tables',
  'notes',
  'conditionalFormatting',
  'dataValidation',
  'pageSetup',
  'filters',
  'sparklines',
  'sheets',
  'definedNames',
  'theme',
  'protection',
]

/** True when the current engine can persist these object kinds at all. */
export const SAVE_PERSISTS_RICH_OBJECTS = false

// Commands that create or modify objects the engine cannot write. The ribbon
// hides their buttons; shortcuts and context menus funnel through here so no
// remaining entry point can produce content that is dropped on save.
const UNSAVED_OBJECT_COMMANDS = new Set([
  'pivot-open',
  'pivot-edit',
  'note-open',
  'table-create-open',
  'table-resize-open',
  'insert-picture',
  'insert-icons',
  'insert-screenshot',
  'insert-checkbox',
  'insert-textbox',
  'header-footer-open',
  'slicer-open',
  'timeline-open',
])
const UNSAVED_OBJECT_PREFIXES = [
  'insert-chart:',
  'insert-pivot-chart:',
  'insert-shape:',
  'sparkline:',
  'format-as-table:',
]

export function isUnpersistedObjectCommand(command: string): boolean {
  return (
    UNSAVED_OBJECT_COMMANDS.has(command) ||
    UNSAVED_OBJECT_PREFIXES.some((prefix) => command.startsWith(prefix))
  )
}

export function detectUnpersistedSave(probe: SaveLossProbe): UnpersistedSaveCategory[] {
  const present: Record<UnpersistedSaveCategory, boolean> = {
    charts: probe.chartEdits.length > 0,
    visuals: probe.visualEdits.length > 0 || probe.visualAdditions.length > 0,
    pivots:
      probe.pivotAdditions.length > 0 ||
      probe.pivotCacheRefreshPaths.length > 0 ||
      probe.pivotRefreshUpdates.length > 0,
    tables: probe.tableAdditions.length > 0 || probe.tableEdits.length > 0,
    notes: probe.noteStates.length > 0,
    conditionalFormatting: probe.cfStates.length > 0,
    dataValidation: probe.dvStates.length > 0,
    pageSetup: probe.pageSetupStates.length > 0,
    filters: probe.filterStates.length > 0,
    sparklines: probe.sparklineAdditions.length > 0,
    sheets: probe.sheetOps.length > 0,
    definedNames: probe.definedNamesState !== null,
    theme: probe.themeState !== null,
    protection:
      probe.sheetProtections.length > 0 ||
      probe.protectedRangeStates.length > 0 ||
      probe.workbookProtectionState !== null,
  }
  return CATEGORY_ORDER.filter((category) => present[category])
}
