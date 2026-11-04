import { describe, expect, it } from 'vitest'
import { detectUnpersistedSave, isUnpersistedObjectCommand, type SaveLossProbe } from './save-loss'

function probe(overrides: Partial<SaveLossProbe> = {}): SaveLossProbe {
  return {
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    tableEdits: [],
    pivotAdditions: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetOps: [],
    filterStates: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
    ...overrides,
  }
}

describe('detectUnpersistedSave', () => {
  it('reports nothing for a cell-only or structural-only save', () => {
    expect(detectUnpersistedSave(probe())).toEqual([])
  })

  it('reports the object kinds the Go engine drops', () => {
    expect(
      detectUnpersistedSave(
        probe({
          chartEdits: [{}],
          visualAdditions: [{}],
          pivotAdditions: [{}],
          tableAdditions: [{}],
          noteStates: [{}],
          cfStates: [{}],
          dvStates: [{}],
          pageSetupStates: [{}],
          filterStates: [{}],
          sparklineAdditions: [{}],
          sheetOps: [{}],
          definedNamesState: { names: [], preserveNames: [] },
          themeState: { colors: { name: 'x', values: [] } },
          sheetProtections: [{}],
          protectedRangeStates: [{}],
        }),
      ),
    ).toEqual([
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
    ])
  })

  it('treats a workbook-protection change as protection only', () => {
    expect(detectUnpersistedSave(probe({ workbookProtectionState: { lockStructure: true } }))).toEqual(
      ['protection'],
    )
  })
})

describe('isUnpersistedObjectCommand', () => {
  it('lets hyperlink edits through now that the save writes them', () => {
    expect(isUnpersistedObjectCommand('link-open')).toBe(false)
  })

  it('still blocks object kinds the save drops', () => {
    expect(isUnpersistedObjectCommand('table-create-open')).toBe(true)
    expect(isUnpersistedObjectCommand('insert-chart:col')).toBe(true)
  })
})
