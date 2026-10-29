export type UiLanguage = 'zh' | 'en'
export type AppTheme = 'light' | 'dark' | 'system'

export const UI_LANGUAGES: readonly UiLanguage[] = ['zh', 'en']
export const APP_THEMES: readonly AppTheme[] = ['light', 'dark', 'system']

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme)
}
