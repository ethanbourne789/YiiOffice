import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tabBindings = vi.hoisted(() => ({
  Activate: vi.fn(async () => undefined),
  Close: vi.fn(async () => undefined),
  Detach: vi.fn(async () => undefined),
  Dock: vi.fn(async () => undefined),
  List: vi.fn(async () => []),
  Reorder: vi.fn(async () => undefined),
  SetDirty: vi.fn(async () => undefined),
  GetDirtyTabs: vi.fn(async () => []),
  ShowAppMenu: vi.fn(async () => []),
  ShowNewMenu: vi.fn(async () => []),
  ShowTabMenu: vi.fn(async () => []),
  ShowTabStripMenu: vi.fn(async () => []),
  TearOff: vi.fn(async () => undefined),
}))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/tabservice', () => tabBindings)
vi.mock('./transport', () => ({ on: vi.fn(() => () => undefined) }))

import { setCurrentTabDirty } from './tabs-bridge'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('setCurrentTabDirty', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    window.history.replaceState({}, '', '/sheets/index.html?tabId=tab-1')
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('surfaces SetDirty failures instead of swallowing them', async () => {
    tabBindings.SetDirty.mockRejectedValueOnce(new Error('ipc down'))
    setCurrentTabDirty(true)
    await flush()

    expect(tabBindings.SetDirty).toHaveBeenCalledWith('tab-1', true)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('tab=tab-1')
  })

  it('stays silent when the shell accepts the flag', async () => {
    setCurrentTabDirty(false)
    await flush()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('no-ops outside an iframe host (no tab id)', async () => {
    window.history.replaceState({}, '', '/sheets/index.html')
    setCurrentTabDirty(true)
    await flush()
    expect(tabBindings.SetDirty).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
