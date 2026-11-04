import { createContext, useContext, useMemo, useState } from 'react'
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

interface LocaleValue {
  lang: Lang
  setLang: (lang: Lang) => void
}

const LocaleContext = createContext<LocaleValue>({ lang: 'zh', setLang: () => {} })

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  const value = useMemo<LocaleValue>(
    () => ({
      lang,
      setLang: (next) => {
        // the main process rejects when app-settings.json is unwritable; a language
        // committed here first would survive only until the next launch
        window.aiOffice.setLanguage(next).then(
          () => {
            setLangState(next)
            document.documentElement.lang = htmlLang(next)
            document.documentElement.dir = htmlDir(next)
          },
          (err: unknown) => console.warn('language not saved', err),
        )
      },
    }),
    [lang],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunc
  /** BCP-47 locale for date/number formatting */
  dateLocale: string
}

/**
 * Maps a backend error to localized copy. Backend failures carry a stable code
 * (`open_read_failed: …`); only the code is shown, never the raw detail. Unknown
 * input falls back to a generic line and is logged for diagnostics.
 */
export function bridgeErrorText(raw: unknown, t: TFunc, fallback: StringKey = 'errGeneric'): string {
  const message = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : ''
  const { code } = parseBridgeError(raw)
  if (code) {
    const key = `err_${code}` as StringKey
    if (Object.prototype.hasOwnProperty.call(strings.zh, key)) return t(key)
  }
  if (message.trim() !== '') console.warn('[bridge] unmapped error', message)
  return t(fallback)
}

/** BCP-47 locale per UI language, for date/number formatting */
const DATE_LOCALES: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
}

export function useI18n(): I18n {
  const { lang, setLang } = useContext(LocaleContext)
  return {
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
    dateLocale: DATE_LOCALES[lang],
  }
}
