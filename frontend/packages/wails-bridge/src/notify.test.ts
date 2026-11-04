import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notify } = vi.hoisted(() => ({ notify: vi.fn(() => Promise.resolve()) }))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/notificationservice', () => ({
  Notify: notify,
}))

describe('systemNotify', () => {
  beforeEach(() => {
    notify.mockClear()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('sends the localized message under the app title', async () => {
    const { systemNotify } = await import('./notify')
    systemNotify('导出完成')
    expect(notify).toHaveBeenCalledWith('YiiOffice', '导出完成')
  })

  it('drops an identical failure repeated within a minute', async () => {
    const { systemNotify } = await import('./notify')
    systemNotify('保存失败', { whenUnfocused: false })
    systemNotify('保存失败', { whenUnfocused: false })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('still sends a different failure', async () => {
    const { systemNotify } = await import('./notify')
    systemNotify('保存失败', { whenUnfocused: false })
    systemNotify('导出失败：磁盘已满', { whenUnfocused: false })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('does not dedupe user-initiated export successes', async () => {
    const { systemNotify } = await import('./notify')
    systemNotify('导出完成')
    systemNotify('导出完成')
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('stays quiet while the window has focus', async () => {
    vi.stubGlobal('document', { hasFocus: () => true })
    const { systemNotify } = await import('./notify')
    systemNotify('导出完成')
    expect(notify).not.toHaveBeenCalled()
  })

  it('notifies an unfocused window', async () => {
    vi.stubGlobal('document', { hasFocus: () => false })
    const { systemNotify } = await import('./notify')
    systemNotify('导出完成')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty body', async () => {
    const { systemNotify } = await import('./notify')
    systemNotify('')
    expect(notify).not.toHaveBeenCalled()
  })
})
