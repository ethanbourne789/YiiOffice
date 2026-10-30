import { appStrings } from './strings-app'
import { paneStrings } from './strings-panes'
import { ribbonStrings } from './strings-ribbon'

export const strings = {
  zh: { ...appStrings.zh, ...ribbonStrings.zh, ...paneStrings.zh },
  en: { ...appStrings.en, ...ribbonStrings.en, ...paneStrings.en },
}
