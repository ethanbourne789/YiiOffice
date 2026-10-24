/**
 * Per-language titles for the manual's sidebar and article headings.
 *
 * The registry holds the structure — which topics exist, their group and order
 * — and this holds the words, one entry per UI language. They are separate
 * because they change for different reasons and on different schedules: a new
 * topic lands in the registry, a new language lands here, and a language with
 * no body yet still needs a title so the sidebar never shows an empty row.
 */

import type { HelpGroupId } from './help-registry'

/** The languages the manual has titles for; `@yiioffice/i18n`'s list, minus none. */
export const HELP_TITLE_LANGS = ['zh', 'en'] as const

export type HelpTitleLang = (typeof HELP_TITLE_LANGS)[number]

/** Sidebar group headings, per language. */
const GROUP_TITLES: Record<HelpGroupId, Record<HelpTitleLang, string>> = {
  start: {
    zh: '入门',
    en: 'Getting started',
  },
  apps: {
    zh: '应用',
    en: 'Applications',
  },
  ai: {
    zh: '助手',
    en: 'Assistant',
  },
  manage: {
    zh: '文件与设置',
    en: 'Files & settings',
  },
}

/** Article titles, per language, keyed by topic id. A language lands here when
 *  its bodies land in ./topics; until then the title falls back to English. */
const TOPIC_TITLES: Record<string, Record<HelpTitleLang, string>> = {
  'getting-started': {
    zh: '快速入门：界面与基本操作',
    en: 'Quick start: the interface and the basics',
  },
  'home-screen': {
    zh: '主屏（Home）：文件都在哪',
    en: 'The Home screen: where your files live',
  },
  'tabs-and-windows': {
    zh: '标签页与窗口管理',
    en: 'Tabs and window management',
  },
  shortcuts: {
    zh: '快捷键一览',
    en: 'Keyboard shortcuts',
  },
  docs: {
    zh: 'Docs：文字处理',
    en: 'Docs: word processing',
  },
  sheets: {
    zh: 'Sheets：电子表格',
    en: 'Sheets: spreadsheets',
  },
  slides: {
    zh: 'Slides：演示文稿',
    en: 'Slides: presentations',
  },
  pdf: {
    zh: 'PDF：阅读、注释与涂黑',
    en: 'PDF: reading, annotating and redacting',
  },
  markdown: {
    zh: 'Markdown 编辑器',
    en: 'The Markdown editor',
  },
  fonts: {
    zh: '字体：系统字体与可下载字体',
    en: 'Fonts: system faces and downloadable families',
  },
  'file-ops': {
    zh: '文件操作：重命名、删除、导出',
    en: 'File operations: rename, delete, export',
  },
  'settings-integrations': {
    zh: '设置、语言与主题',
    en: 'Settings, language, and theme',
  },
  install: {
    zh: '安装 YiiOffice',
    en: 'Installing YiiOffice',
  },
}

/** Sidebar group heading in the reader's language; English when unknown. */
export function groupTitle(id: HelpGroupId, lang: string): string {
  const row = GROUP_TITLES[id]
  return (row?.[lang as HelpTitleLang] ?? row?.en) as string
}

/** Article title in the reader's language; falls back to the topic id, which
 *  is never pretty, so a language added without its titles shows up as a gap
 *  rather than as a blank row. */
export function topicTitle(id: string, lang: string): string {
  const row = TOPIC_TITLES[id]
  return (row?.[lang as HelpTitleLang] ?? row?.en ?? id) as string
}
