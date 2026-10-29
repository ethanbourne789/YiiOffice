import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from './index'
import { invoke } from './transport'

interface FakeRuntime {
  Call: { ByName: ReturnType<typeof vi.fn> }
  Events: { On: ReturnType<typeof vi.fn>; Off: ReturnType<typeof vi.fn> }
}

function installFakeRuntime(): FakeRuntime {
  const runtime: FakeRuntime = {
    Call: { ByName: vi.fn(async () => '0.13.0') },
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
  })

  it('invokes the generic router with channel and args array', async () => {
    const runtime = installFakeRuntime()
    await invoke('demo:echo', 'a', 1)
    expect(runtime.Call.ByName).toHaveBeenCalledWith('bridge.Service.Invoke', 'demo:echo', ['a', 1])
  })

  it('throws a clear error when the runtime is missing', async () => {
    await expect(invoke('x')).rejects.toThrow(/Wails runtime is not available/)
  })

  it('installs aiOffice and aiOfficeTabs once', () => {
    installFakeRuntime()
    installBridge()
    installBridge()
    expect(typeof (window as unknown as { aiOffice: { getAppVersion: unknown } }).aiOffice.getAppVersion).toBe('function')
    expect(typeof (window as unknown as { aiOfficeTabs: { list: unknown } }).aiOfficeTabs.list).toBe('function')
  })

  it('reads the version through the shim', async () => {
    const runtime = installFakeRuntime()
    installBridge()
    const version = await (window as unknown as { aiOffice: { getAppVersion(): Promise<string> } }).aiOffice.getAppVersion()
    expect(version).toBe('0.13.0')
    expect(runtime.Call.ByName).toHaveBeenCalledWith(
      'bridge.Service.Invoke',
      'home:get-app-version',
      [],
    )
  })

  it('rejects an unknown theme value before hitting go', async () => {
    installFakeRuntime()
    installBridge()
    const api = (window as unknown as { aiOffice: { setTheme(t: string): Promise<void> } }).aiOffice
    await expect(api.setTheme('sepia')).rejects.toThrow(/Invalid theme/)
  })
})
