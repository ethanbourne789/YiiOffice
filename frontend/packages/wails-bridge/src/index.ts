import { createHomeApi } from './home'
import { createTabsApi } from './tabs'
import { invoke } from './transport'

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

const EXTERNAL_ATTR = 'data-wails-external'

/**
 * Routes every external navigation attempt through Go so the shell can validate
 * the URL and open the system browser instead of navigating the WebView.
 */
export function installExternalLinkGuard(): void {
  window.open = (url?: string | URL): Window | null => {
    const raw = typeof url === 'string' ? url : url?.toString() ?? ''
    void invoke('shell:open-external', raw).catch(() => undefined)
    return null
  }

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      const isExternal = /^https?:/i.test(href) && (anchor.getAttribute('target') === '_blank' || anchor.hasAttribute(EXTERNAL_ATTR))
      if (!isExternal) return
      event.preventDefault()
      void invoke('shell:open-external', href).catch(() => undefined)
    },
    true,
  )
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
  installExternalLinkGuard()
}
