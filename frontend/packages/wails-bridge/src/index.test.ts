import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from './index'

const shellBridge = vi.hoisted(() => ({ OpenExternal: vi.fn(async () => undefined) }))
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/shellservice', () => shellBridge)

const homeBridge = vi.hoisted(() => ({
  GetAppVersion: vi.fn(async () => '0.13.0'),
  Browse: vi.fn(async (): Promise<string[]> => []),
  OpenPath: vi.fn(async (_path: string) => undefined),
}))
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice', () => homeBridge)

interface FakeRuntime {
  Events: { On: ReturnType<typeof vi.fn>; Off: ReturnType<typeof vi.fn> }
}

function installFakeRuntime(): FakeRuntime {
  const runtime: FakeRuntime = {
    Events: { On: vi.fn(), Off: vi.fn() },
  }
  ;(window as unknown as { wails?: FakeRuntime }).wails = runtime
  return runtime
}

describe('wails bridge', () => {
  beforeEach(() => {
    delete (window as unknown as { wails?: FakeRuntime }).wails
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
    delete (window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs
    shellBridge.OpenExternal.mockClear()
    homeBridge.GetAppVersion.mockClear()
    homeBridge.Browse.mockClear()
    homeBridge.OpenPath.mockClear()
  })

  it('installs aiOffice using the runtime module fallback', () => {
    // @wailsio/runtime is imported and sets window.wails ??= runtimeModule,
    // so installBridge always has a runtime to use even without explicit setup.
    installBridge()
    expect(typeof (window as unknown as { aiOffice: { getAppVersion: unknown } }).aiOffice.getAppVersion).toBe('function')
  })

  it('installs aiOffice and aiOfficeTabs once', () => {
    installFakeRuntime()
    installBridge()
    installBridge()
    expect(typeof (window as unknown as { aiOffice: { getAppVersion: unknown } }).aiOffice.getAppVersion).toBe('function')
    expect(typeof (window as unknown as { aiOfficeTabs: { list: unknown } }).aiOfficeTabs.list).toBe('function')
  })

  it('reads the version through the shim', async () => {
    installFakeRuntime()
    installBridge()
    const version = await (window as unknown as { aiOffice: { getAppVersion(): Promise<string> } }).aiOffice.getAppVersion()
    expect(version).toBe('0.13.0')
    expect(homeBridge.GetAppVersion).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown theme value before hitting go', async () => {
    installFakeRuntime()
    installBridge()
    const api = (window as unknown as { aiOffice: { setTheme(t: string): Promise<void> } }).aiOffice
    await expect(api.setTheme('sepia')).rejects.toThrow(/Invalid theme/)
  })

  it('opens the files the native dialog returns', async () => {
    // The home "open local file" card only calls browse(); unless the shim
    // routes the picks itself the dialog closes and no tab ever appears.
    installFakeRuntime()
    installBridge()
    homeBridge.Browse.mockResolvedValueOnce(['C:\\docs\\report.docx', 'C:\\docs\\notes.txt'])
    const api = (window as unknown as { aiOffice: { browse(): Promise<string[]> } }).aiOffice
    const picked = await api.browse()
    expect(picked).toEqual(['C:\\docs\\report.docx', 'C:\\docs\\notes.txt'])
    expect(homeBridge.OpenPath).toHaveBeenCalledTimes(1)
    expect(homeBridge.OpenPath).toHaveBeenCalledWith('C:\\docs\\report.docx')
  })

  it('opens every dropped file in order and ignores unusable entries', async () => {
    // Wails resolves drop paths in Go and forwards them as this event; the
    // shell must open each file (and keep going past one failure).
    const runtime = installFakeRuntime()
    installBridge()
    const handler = runtime.Events.On.mock.calls.find(
      ([name]) => name === 'common:WindowFilesDropped',
    )?.[1] as ((data: { filenames?: unknown }) => void) | undefined
    expect(handler).toBeTypeOf('function')

    const order: string[] = []
    homeBridge.OpenPath.mockImplementation(async (path: string) => {
      if (path.endsWith('gone.docx')) throw new Error('missing')
      order.push(path)
    })
    handler?.({ filenames: ['C:\\docs\\gone.docx', '', 42, 'C:\\docs\\notes.md'] })

    await vi.waitFor(() => expect(order).toEqual(['C:\\docs\\notes.md']))
  })

  it('routes https links through shell:open-external and blocks navigation', async () => {
    installFakeRuntime()
    installBridge()

    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/x'
    anchor.target = '_blank'
    document.body.append(anchor)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(shellBridge.OpenExternal).toHaveBeenCalledWith('https://example.com/x')
    anchor.remove()
  })
})