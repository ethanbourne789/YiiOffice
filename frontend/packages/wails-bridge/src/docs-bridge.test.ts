import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const docxPath = 'C:\\docs\\report.docx'

const docsBindings = vi.hoisted(() => ({
  OpenDocxPath: vi.fn(async (path: string) => ({ path, base64: '' })),
}))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/docsservice', () => docsBindings)

const tabBindings = vi.hoisted(() => ({
  List: vi.fn(async () => [{ id: 'tab-1', kind: 'docs', title: 'report.docx', path: '', active: true }]),
}))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/tabservice', () => tabBindings)

import { docsConsumePendingOpenDocx } from './docs-bridge'

describe('docs bridge open handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:docx-handoff')
    URL.revokeObjectURL = vi.fn()
    window.history.replaceState({}, '', '/docs/index.html?tabId=tab-1')
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('resolves the tab path and returns the shape the editor fetches', async () => {
    tabBindings.List.mockResolvedValueOnce([
      { id: 'tab-1', kind: 'docs', title: 'report.docx', path: docxPath, active: true },
    ])
    docsBindings.OpenDocxPath.mockResolvedValueOnce({
      path: docxPath,
      base64: btoa('PK\u0003\u0004docx'),
    })

    const result = (await docsConsumePendingOpenDocx()) as {
      path: string
      name: string
      dataUrl: string
      hash: string
    }

    expect(docsBindings.OpenDocxPath).toHaveBeenCalledWith(docxPath)
    // The editor calls fetch(result.dataUrl); without this shape every opened
    // document landed on a blank page.
    expect(result.path).toBe(docxPath)
    expect(result.name).toBe('report.docx')
    expect(result.dataUrl).toBe('blob:docx-handoff')
    expect(typeof result.hash).toBe('string')
  })

  it('stays blank for an untitled tab', async () => {
    tabBindings.List.mockResolvedValueOnce([
      { id: 'tab-1', kind: 'docs', title: 'Untitled Document', path: '', active: true },
    ])
    const result = await docsConsumePendingOpenDocx()
    expect(result).toBeNull()
    expect(docsBindings.OpenDocxPath).not.toHaveBeenCalled()
  })
})
