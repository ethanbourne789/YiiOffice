import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@yiioffice/i18n'
import { App } from './App'
import { LocaleProvider, setModuleLang } from './i18n/locale'
import type { DocTheme, UiTheme } from '../shared/ipc'
import '@yiioffice/ui/tokens.css'
import '@yiioffice/ui/screentip.css'
import '@yiioffice/ui/color-picker.css'
import '@yiioffice/ui/dropdown.css'
import '@yiioffice/ui/ribbon-collapse.css'
import '@yiioffice/ui/markdown.css'
import '@yiioffice/ui/image-viewer.css'
import './styles.css'
import './fonts/fonts.css'
import { installScreenTips } from '@yiioffice/ui'
import { setAltChunkHtmlConverter } from '@yiioffice/docx-engine'

installScreenTips()
if (window.desktop?.convertAltChunkHtml) {
  setAltChunkHtmlConverter((html) => window.desktop.convertAltChunkHtml(html))
}

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

function applyDocumentTheme(theme: DocTheme): void {
  // data-doc-theme drives the canvas/paper (yiioffice#1811); absent means 'follow' the UI theme
  if (theme === 'follow') document.documentElement.removeAttribute('data-doc-theme')
  else document.documentElement.setAttribute('data-doc-theme', theme)
}

async function bootstrap(): Promise<void> {
  let lang: Lang = 'zh'
  let theme: UiTheme = 'system'
  let docTheme: DocTheme = 'follow'
  try {
    // per-promise catch: standalone runs have no app:get-theme handler, and
    // that rejection must not drop a resolved language
    ;[lang, theme, docTheme] = await Promise.all([
      window.desktop.getLanguage().then((l) => (l === 'zh' || l === 'en' ? l : 'zh')).catch(() => 'zh' as const),
      window.desktop.getTheme().catch(() => 'system' as const),
      window.desktop.getDocumentTheme?.().catch(() => 'follow' as const),
    ])
  } catch {
    /* dev renderer without the preload bridge */
  }
  setModuleLang(lang)
  document.documentElement.lang = htmlLang(lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  applyDocumentTheme(docTheme ?? 'follow')
  window.desktop?.onThemeChanged(applyTheme)
  window.desktop?.onDocumentThemeChanged?.(applyDocumentTheme)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
}

void bootstrap()
