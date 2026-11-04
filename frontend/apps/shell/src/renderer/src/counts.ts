import type { Lang, Params } from '@yiioffice/i18n'
import type { RecentPage } from '../../shared/home-api'
import type { StringKey } from './locale'

/**
 * Sidebar counters describe the whole collection, never the filtered slice:
 * picking "表格" narrows the list and the heading, not how many recent files
 * the user has.
 */
export function visiblePageCount(page: Pick<RecentPage, 'totalAll'>): number {
  return page.totalAll
}

type ExtraCategory = Exclude<Intl.LDMLPluralRule, 'one' | 'other'>

// forms beyond one/other, only for locales whose CLDR categories need
// distinct wording; the dictionaries keep the shared one/other pair
const FILE_COUNT_FORMS: Partial<Record<Lang, Partial<Record<ExtraCategory, string>>>> = {}

const rulesCache = new Map<Lang, Intl.PluralRules>()

export function fileCountLabel(
  count: number,
  lang: Lang,
  t: (key: StringKey, params?: Params) => string,
): string {
  let rules = rulesCache.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(lang)
    rulesCache.set(lang, rules)
  }
  const category = rules.select(count)
  const extra =
    category === 'one' || category === 'other' ? undefined : FILE_COUNT_FORMS[lang]?.[category]
  if (extra) return extra.replace('{n}', String(count))
  return t(category === 'one' ? 'fileCountOne' : 'fileCount', { n: count })
}
