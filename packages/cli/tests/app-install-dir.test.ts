import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appBinaryForResources } from '../src/resources'

describe('appBinaryForResources', () => {
  it('finds the app in a custom Windows install directory', () => {
    expect(appBinaryForResources(join('D:\\Apps\\YiiOffice', 'resources'), 'win32')).toBe(
      join('D:\\Apps\\YiiOffice', 'YiiOffice.exe'),
    )
  })

  it('resolves the same binary for the default Windows install directory', () => {
    const localAppData = 'C:\\Users\\test\\AppData\\Local'
    const resources = join(localAppData, 'Programs', 'YiiOffice', 'resources')
    expect(appBinaryForResources(resources, 'win32')).toBe(
      join(localAppData, 'Programs', 'YiiOffice', 'YiiOffice.exe'),
    )
  })

  it('finds the app in a custom macOS bundle location', () => {
    expect(
      appBinaryForResources(join('/Volumes/Work/YiiOffice.app/Contents/Resources'), 'darwin'),
    ).toBe(join('/Volumes/Work/YiiOffice.app/Contents/MacOS/YiiOffice'))
  })

  it('finds the app in a custom Linux prefix', () => {
    expect(appBinaryForResources(join('/opt/yiioffice-custom/resources'), 'linux')).toBe(
      join('/opt/yiioffice-custom/yiioffice'),
    )
  })
})
