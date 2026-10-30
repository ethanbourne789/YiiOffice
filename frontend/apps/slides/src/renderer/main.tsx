import { installBridge, createSlidesDesktopApi } from '@yiioffice/wails-bridge'
installBridge()
// Merge slides-specific methods into window.desktop for slides renderer
window.desktop = {
  ...window.desktop,
  ...createSlidesDesktopApi(),
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@yiioffice/i18n'
import { App } from './App'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import '@yiioffice/ui/tokens.css'
import '@yiioffice/ui/screentip.css'
import '@yiioffice/ui/color-picker.css'
import '@yiioffice/ui/dropdown.css'
import '@yiioffice/ui/ribbon-collapse.css'
import '@yiioffice/ui/markdown.css'
import './styles.css'
import { installScreenTips } from '@yiioffice/ui'

installScreenTips()

// Canvas fillText never triggers @font-face downloads, so the bundled document fonts
// (Carlito ↔ Calibri) must be loaded explicitly or Konva silently draws the fallback face.
for (const variant of ['', 'bold ', 'italic ', 'italic bold ']) {
  document.fonts?.load?.(`${variant}16px Carlito`).catch(() => {})
  document.fonts?.load?.(`${variant}16px 'Carlito GO'`).catch(() => {})
}

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme] = await Promise.all([
      window.desktop.getLanguage().then((l) => l as Lang).catch(() => 'zh' as const),
      window.desktop.getTheme().catch(() => 'system' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.desktop?.onThemeChanged(applyTheme)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LocaleProvider initial={lang}>
        <App />
      </LocaleProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
