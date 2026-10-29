import { invoke, on } from './transport'
import { isAppTheme, isUiLanguage, type AppTheme, type UiLanguage } from './types'

/** Subset of the Electron HomeApi required by the shell home screen in Phase 1. */
export interface HomeBridge {
  getAppVersion(): Promise<string>
  getTheme(): Promise<AppTheme>
  setTheme(theme: AppTheme): Promise<void>
  getLanguage(): Promise<UiLanguage>
  setLanguage(lang: UiLanguage): Promise<void>
  onThemeChanged(handler: (theme: AppTheme) => void): () => void
}

export function createHomeApi(): HomeBridge {
  return {
    async getAppVersion() {
      const value = await invoke<unknown>('home:get-app-version')
      return typeof value === 'string' ? value : ''
    },
    async getTheme() {
      const value = await invoke<unknown>('home:get-theme')
      return isAppTheme(value) ? value : 'system'
    },
    async setTheme(theme) {
      if (!isAppTheme(theme)) throw new Error('Invalid theme.')
      await invoke('home:set-theme', theme)
    },
    async getLanguage() {
      const value = await invoke<unknown>('home:get-language')
      return isUiLanguage(value) ? value : 'zh'
    },
    async setLanguage(lang) {
      if (!isUiLanguage(lang)) throw new Error('Invalid language.')
      await invoke('home:set-language', lang)
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (isAppTheme(data)) handler(data)
      })
    },
  }
}
