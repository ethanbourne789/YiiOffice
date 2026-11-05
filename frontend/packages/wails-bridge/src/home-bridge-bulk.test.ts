import { describe, expect, it, vi } from 'vitest'

// The Go bindings take one path per call; the UI removes and assigns in bulk.
// These tests pin the fan-out so passing the array straight through can't come
// back: Wails would reject it (it unmarshals a string and receives an array),
// which surfaced to the user as "操作失败：操作失败，请稍后重试".
const calls = vi.hoisted(() => ({
  removed: [] as string[],
  grouped: [] as Array<[string, string]>,
}))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice', () => ({
  RemoveRecent: async (path: string) => {
    calls.removed.push(path)
  },
  SetStarredGroup: async (path: string, group: string) => {
    calls.grouped.push([path, group])
  },
}))
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/models', () => ({}))

import { createHomeApi } from './home-bridge'

describe('home bridge bulk recents', () => {
  it('removes one path per call', async () => {
    calls.removed.length = 0
    await createHomeApi().removeRecent(['a.docx', 'b.docx'])
    expect(calls.removed).toEqual(['a.docx', 'b.docx'])
  })

  it('assigns the group to every path, mapping null to the clear label', async () => {
    calls.grouped.length = 0
    await createHomeApi().setStarredGroup(['a.docx', 'b.docx'], null)
    expect(calls.grouped).toEqual([
      ['a.docx', ''],
      ['b.docx', ''],
    ])
  })

  it('keeps an explicit group label', async () => {
    calls.grouped.length = 0
    await createHomeApi().setStarredGroup(['a.docx'], '报告')
    expect(calls.grouped).toEqual([['a.docx', '报告']])
  })
})
