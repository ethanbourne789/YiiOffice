import { appStrings } from './strings-app'
import { editorStrings } from './strings-editor'
import { ribbonStrings } from './strings-ribbon'
import { tableStrings } from './strings-table'

export const strings = {
  zh: {
    ...appStrings.zh,
    ...ribbonStrings.zh,
    ...tableStrings.zh,
    ...editorStrings.zh,
  },
  en: {
    ...appStrings.en,
    ...ribbonStrings.en,
    ...tableStrings.en,
    ...editorStrings.en,
  },
}
