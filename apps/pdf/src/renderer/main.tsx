import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@yiioffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
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

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

void (async () => {
  const [lang, theme] = await Promise.all([
    window.pdfApi.getLanguage().catch(() => 'zh' as const),
    window.pdfApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.pdfApi.onThemeChanged(applyTheme)
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
