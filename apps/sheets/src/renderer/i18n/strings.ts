import { appStrings } from './strings-app'
import { dialogStrings } from './strings-dialogs'

export const strings = {
  zh: { ...appStrings.zh, ...dialogStrings.zh },
  en: { ...appStrings.en, ...dialogStrings.en },
}
