import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createI18n, htmlDir, htmlLang, type Lang, type Params } from '@yiioffice/i18n'
import { strings } from './strings'

const translate = createI18n(strings)

export type StringKey = keyof typeof strings.zh
export type TFunc = (key: StringKey, params?: Params) => string

/** Appended to the AI system prompt: reply in the user's message language, falling back to the UI language when undetectable (same wording as docs/slides) */
const AI_LANG_DIRECTIVES: Record<Lang, string> = {
  zh: '\n\n用与用户消息相同的语言回复；无法判断用户消息的语言时，用简体中文回复。',
  en: "\n\nReply in the same language as the user's message; if it cannot be determined, reply in English.",
}

export function aiLangDirective(lang: Lang): string {
  return AI_LANG_DIRECTIVES[lang]
}

const LocaleContext = createContext<Lang>('zh')

/** Module-level current language: for code outliving render closures (AgentLoop events etc.), kept in sync with the Provider */
let moduleLang: Lang = 'zh'

export function t(key: StringKey, params?: Params): string {
  return translate(moduleLang, key, params)
}

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial)
  moduleLang = lang
  useEffect(
    () =>
      window.pdfApi.onLanguageChanged((next) => {
        document.documentElement.lang = htmlLang(next)
        document.documentElement.dir = htmlDir(next)
        setLang(next)
      }),
    [],
  )
  return <LocaleContext.Provider value={lang}>{children}</LocaleContext.Provider>
}

export function useI18n(): { lang: Lang; t: TFunc } {
  const lang = useContext(LocaleContext)
  return { lang, t: (key, params) => translate(lang, key, params) }
}
