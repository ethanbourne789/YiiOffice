import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from './index'

const shellBridge = vi.hoisted(() => ({ OpenExternal: vi.fn(async () => undefined) }))
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/shellservice', () => shellBridge)

const homeBridge = vi.hoisted(() => ({ GetAppVersion: vi.fn(async () => '0.13.0') }))
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