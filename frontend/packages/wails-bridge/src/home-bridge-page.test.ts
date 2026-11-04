import { describe, expect, it, vi } from 'vitest'

// pageOf is pure; the bindings only feed it in production, so they are stubbed
// out to keep the test focused on the paging/filtering contract.
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice', () => ({}))
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/models', () => ({
  FileSearchQuery: class {},
}))

import { pageOf, type RecentEntry } from './home-bridge'

function row(path: string, ext: string, mtimeMs = 0): RecentEntry {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    ext,
    mtimeMs,
    sizeBytes: 1,
    starred: false,
  }
}

/** the shape an older build left in recent.json: StatDocument("") → ".", missing */
function junkRow(): RecentEntry {
  return { path: '', name: '.', ext: '', mtimeMs: 0, sizeBytes: 0, starred: false, missing: true }
}

const REAL = [
  row('D:\\docs\\a.xlsx', 'xlsx', 1),
  row('D:\\docs\\b.docx', 'docx', 2),
  row('D:\\docs\\c.md', 'md', 3),
  row('D:\\docs\\d.pdf', 'pdf', 4),
]

describe('pageOf', () => {
  it('never turns blank-path records into rows or counters', () => {
    const all = [...REAL, ...Array.from({ length: 12 }, junkRow)]

    const page = pageOf(all, { offset: 0, limit: 50 })

    expect(page.entries).toHaveLength(REAL.length)
    expect(page.entries.every((e) => e.path !== '')).toBe(true)
    // the sidebar counter reads totalAll: junk must not inflate it either
    expect(page.totalAll).toBe(REAL.length)
    expect(page.total).toBe(REAL.length)
  })

  it('scopes the filtered total but leaves the collection total alone', () => {
    const all = [...REAL, ...Array.from({ length: 12 }, junkRow)]

    const page = pageOf(all, { offset: 0, limit: 50, ext: 'xlsx' })

    expect(page.entries.map((e) => e.name)).toEqual(['a.xlsx'])
    expect(page.total).toBe(1)
    expect(page.totalAll).toBe(REAL.length)
  })

  it('keeps the counter call (limit 0) free of rows', () => {
    const page = pageOf(REAL, { offset: 0, limit: 0 })

    expect(page.entries).toEqual([])
    expect(page.total).toBe(REAL.length)
    expect(page.totalAll).toBe(REAL.length)
  })

  it('ignores blank-path rows in the starred group totals too', () => {
    const starred = [...REAL.map((e) => ({ ...e, starred: true, group: 'Important' })), junkRow()]

    const page = pageOf(starred, { offset: 0, limit: 50, group: 'Important' })

    expect(page.entries).toHaveLength(REAL.length)
    expect(page.totalAll).toBe(REAL.length)
  })
})
