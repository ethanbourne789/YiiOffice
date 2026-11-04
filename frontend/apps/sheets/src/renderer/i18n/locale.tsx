import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  createI18n,
  htmlDir,
  htmlLang,
  parseBridgeError,
  type Lang,
  type Params,
} from '@yiioffice/i18n'
import { strings } from './strings'

const translate = createI18n(strings)

export type StringKey = keyof typeof strings.zh
export type TFunc = (key: StringKey, params?: Params) => string

// mirror for non-React modules (edit-journal, lazy-plan, AI tools …);
// set before first render and on every language switch
let moduleLang: Lang = 'zh'
export const getLang = (): Lang => moduleLang
export const setModuleLang = (lang: Lang): void => {
  moduleLang = lang
}
/** module-level translator — components should prefer useI18n().t so they re-render on switch */
export const t: TFunc = (key, params) => translate(moduleLang, key, params)
export const tFor = (lang: Lang, key: StringKey, params?: Params): string =>
  translate(lang, key, params)

/**
 * Maps a backend error to localized copy. Backend failures carry a stable code
 * (`open_read_failed: …`); only the code is shown, never the raw detail. Unknown
 * input falls back to a generic line and is logged for diagnostics.
 */
export function bridgeErrorText(raw: unknown, fallback: StringKey = 'errGeneric'): string {
  const message = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : ''
  const { code } = parseBridgeError(raw)
  if (code) {
    const key = `err_${code}` as StringKey
    if (Object.prototype.hasOwnProperty.call(strings.zh, key)) return t(key)
  }
  if (message.trim() !== '') console.warn('[bridge] unmapped error', message)
  return t(fallback)
}

const AI_LANG_DIRECTIVES: Record<Lang, string> = {
  zh: '\n\n用与用户消息相同的语言回复；无法判断用户消息的语言时，用简体中文回复。',
  en: "\n\nReply in the same language as the user's message; if it cannot be determined, reply in English.",
}

/** appended to the agent system prompt: replies follow the user's message language, falling back to the UI language */
export function aiLangDirective(): string {
  return AI_LANG_DIRECTIVES[moduleLang]
}

/** BCP-47 locale per UI language, for date/number formatting */
export const DATE_LOCALES: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
}

const LocaleContext = createContext<Lang>('zh')

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial)
  useEffect(
    () =>
      window.desktopApi.onLanguageChanged((next) => {
        setModuleLang(next as any)
        document.documentElement.lang = htmlLang(next as any)
        document.documentElement.dir = htmlDir(next as any)
        setLang(next as any)
      }),
    [],
  )
  return <LocaleContext.Provider value={lang}>{children}</LocaleContext.Provider>
}

export interface I18n {
  lang: Lang
  t: TFunc
  /** BCP-47 locale for date/number formatting */
  dateLocale: string
}

export function useI18n(): I18n {
  const lang = useContext(LocaleContext)
  return {
    lang,
    t: (key, params) => translate(lang, key, params),
    dateLocale: DATE_LOCALES[lang],
  }
}
