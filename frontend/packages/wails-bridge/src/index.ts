import { createHomeApi } from './home'
import { createTabsApi } from './tabs'

export { invoke, on, runtime } from './transport'
export type { HomeBridge } from './home'
export type { TabsBridge, TabSummary } from './tabs'
export type { AppTheme, UiLanguage } from './types'

declare global {
  interface Window {
    aiOffice?: unknown
    aiOfficeTabs?: unknown
    desktop?: unknown
  }
}

/**
 * Installs the Electron-compatible globals exactly once. Called from every
 * renderer entry before React mounts.
 */
export function installBridge(): void {
  if (window.aiOffice) return
  const home = createHomeApi()
  window.aiOffice = home
  window.desktop = home
  window.aiOfficeTabs = createTabsApi()
}
