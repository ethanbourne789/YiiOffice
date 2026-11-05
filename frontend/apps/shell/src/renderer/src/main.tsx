import { installBridge } from '@yiioffice/wails-bridge'
installBridge()

import React from 'react'
import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang } from '@yiioffice/i18n'
import { AppFrame } from './AppFrame'
import { LocaleProvider } from './locale'
import '@yiioffice/ui/tokens.css'
import '@yiioffice/ui/screentip.css'
import '@yiioffice/ui/dropdown.css'
import '@yiioffice/ui/segmented.css'
import './home.css'
import './tabbar.css'
import { installScreenTips } from '@yiioffice/ui'

installScreenTips()

// macOS shell window is created with vibrancy; a transparent body lets the
// editor views' translucent regions (e.g. slides thumbnail pane) show it
const IS_MAC = navigator.platform.toLowerCase().includes('mac')
if (IS_MAC) document.body.classList.add('vib')
// non-mac: the tab strip doubles as the title bar (caption buttons overlay it)
document.body.classList.add(IS_MAC ? 'mac' : 'overlay-title-bar')

// Resolve the persisted language and theme before first paint. Every binding
// call has its own fallback and the chain has a terminal catch, so a rejected
// or missing preference can never leave the main window blank.
type UiLanguage = 'zh' | 'en'
type AppTheme = 'light' | 'dark' | 'system'

let mounted = false
function mountShell(lang: UiLanguage, theme: AppTheme): void {
  if (mounted) return
  mounted = true
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  // apply theme attribute before first paint to avoid flash
  if (theme !== 'system') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  // A broken event subscription must not stop the UI from mounting.
  try {
    window.aiOffice.onThemeChanged((next) => {
      if (next === 'system') document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', next)
    })
  } catch (err) {
    console.error('[shell] theme subscription failed', err)
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LocaleProvider initial={lang}>
        <AppFrame />
      </LocaleProvider>
    </React.StrictMode>,
  )
}

void Promise.all([
  window.aiOffice.getLanguage().catch(() => 'zh' as UiLanguage),
  window.aiOffice.getTheme().catch(() => 'system' as AppTheme),
])
  .then(([lang, theme]) => mountShell(lang, theme))
  .catch((err) => {
    console.error('[shell] preference bootstrap failed', err)
    try {
      mountShell('zh', 'system')
    } catch (fatal) {
      console.error('[shell] fatal mount error', fatal)
    }
  })
