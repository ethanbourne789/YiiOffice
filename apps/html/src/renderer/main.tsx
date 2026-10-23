import { createRoot } from 'react-dom/client'
import { htmlDir, htmlLang, type Lang } from '@yiioffice/i18n'
import App from './App'
import { PresentView } from './PresentView'
import { LocaleProvider } from './i18n/locale'
import type { UiTheme } from '../shared/ipc'
import { installScreenTips } from '@yiioffice/ui'
import '@yiioffice/ui/tokens.css'
import '@yiioffice/ui/screentip.css'
import '@yiioffice/ui/dropdown.css'
import '@yiioffice/ui/find-panel.css'
import '@yiioffice/ui/color-picker.css'
import '@yiioffice/ui/ribbon-collapse.css'
import '@yiioffice/ui/image-dialogs.css'
import './styles.css'

function applyTheme(theme: UiTheme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

installScreenTips()

void (async () => {
  const [lang, theme] = await Promise.all([
    window.htmlApi.getLanguage().catch(() => 'zh' as const),
    window.htmlApi.getTheme().catch(() => 'system' as const),
  ])
  document.documentElement.lang = htmlLang(lang as Lang)
  document.documentElement.dir = htmlDir(lang)
  applyTheme(theme)
  window.htmlApi.onThemeChanged(applyTheme)
  // a present tab/window (opened by Present → New tab) renders only its owner's preview
  const params = new URLSearchParams(location.search)
  const present = params.has('present')
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      {present ? <PresentView title={params.get('title') ?? ''} /> : <App />}
    </LocaleProvider>,
  )
})()
