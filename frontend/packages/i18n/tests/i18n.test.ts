import { describe, expect, it } from 'vitest'
import {
  createI18n,
  format,
  htmlDir,
  htmlLang,
  isLang,
  isRtlLang,
  LANGS,
  macShortcutsToWin,
  normalizeLang,
  type Lang,
  type Params,
} from '../src/index'

describe('normalizeLang', () => {
  it('maps zh variants to zh', () => {
    expect(normalizeLang('zh')).toBe('zh')
    expect(normalizeLang('zh-CN')).toBe('zh')
    expect(normalizeLang('zh-Hans-CN')).toBe('zh')
  })

  it('maps traditional-script zh variants to zh', () => {
    expect(normalizeLang('zh-TW')).toBe('zh')
    expect(normalizeLang('ZH-TW')).toBe('zh')
    expect(normalizeLang('zh-Hant')).toBe('zh')
    expect(normalizeLang('zh-Hant-TW')).toBe('zh')
    expect(normalizeLang('zh-HK')).toBe('zh')
    expect(normalizeLang('zh-MO')).toBe('zh')
  })

  it('maps retired languages to en', () => {
    expect(normalizeLang('ja')).toBe('en')
    expect(normalizeLang('ja-JP')).toBe('en')
    expect(normalizeLang('ko-KR')).toBe('en')
    expect(normalizeLang('fr-CA')).toBe('en')
    expect(normalizeLang('de-DE')).toBe('en')
    expect(normalizeLang('th-TH')).toBe('en')
    expect(normalizeLang('id-ID')).toBe('en')
    expect(normalizeLang('in-ID')).toBe('en')
    expect(normalizeLang('pt-BR')).toBe('en')
    expect(normalizeLang('iw-IL')).toBe('en')
    expect(normalizeLang('he-IL')).toBe('en')
  })

  it('maps everything else (and missing) to en', () => {
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang('en_US')).toBe('en')
    expect(normalizeLang('sv-SE')).toBe('en')
    expect(normalizeLang('')).toBe('en')
    expect(normalizeLang(undefined)).toBe('en')
    expect(normalizeLang(null)).toBe('en')
  })

  it('requires a BCP-47 boundary after the language code', () => {
    expect(normalizeLang('deleted')).toBe('en')
    expect(normalizeLang('french')).toBe('en')
    expect(normalizeLang('thread')).toBe('en')
    expect(normalizeLang('zho')).toBe('en')
    expect(normalizeLang('zh')).toBe('zh')
    expect(normalizeLang('zh-CN')).toBe('zh')
    expect(normalizeLang('zh_CN')).toBe('zh')
  })
})

describe('isLang', () => {
  it('accepts only supported languages', () => {
    expect(isLang('zh')).toBe(true)
    expect(isLang('en')).toBe(true)
    expect(isLang('zh-CN')).toBe(false)
    expect(isLang('ja')).toBe(false)
    expect(isLang('zh-TW')).toBe(false)
    expect(isLang(42)).toBe(false)
  })
})

describe('htmlLang', () => {
  it('maps every supported language to a BCP-47 tag', () => {
    expect(htmlLang('zh')).toBe('zh-CN')
    expect(htmlLang('en')).toBe('en-US')
  })
})

describe('format', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(format('已选 {n} 项', { n: 3 })).toBe('已选 3 项')
    expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}')
    expect(format('no params')).toBe('no params')
  })

  it('leaves the placeholder in place for a nullish param value', () => {
    // hasOwn is true for a key explicitly set to undefined/null, and
    // String(undefined) is the literal text "undefined"
    expect(format('Deleted {n} files', { n: undefined } as unknown as Params)).toBe(
      'Deleted {n} files',
    )
    expect(format('Deleted {n} files', { n: null } as unknown as Params)).toBe('Deleted {n} files')
  })

  it('does not leak prototype properties into placeholders', () => {
    expect(format('{toString}', {})).toBe('{toString}')
    expect(format('{constructor} and {valueOf}', {})).toBe('{constructor} and {valueOf}')
    expect(format('{n}', { n: 1 })).toBe('1')
  })
})

describe('macShortcutsToWin', () => {
  it('rewrites single-modifier chords', () => {
    expect(macShortcutsToWin('剪切 (⌘X)')).toBe('剪切 (Ctrl+X)')
    expect(macShortcutsToWin('Save (⌘S).')).toBe('Save (Ctrl+S).')
    expect(macShortcutsToWin('⌘1')).toBe('Ctrl+1')
  })

  it('rewrites multi-modifier chords in Ctrl, Alt, Shift order', () => {
    expect(macShortcutsToWin('⇧⌘G')).toBe('Ctrl+Shift+G')
    expect(macShortcutsToWin('⌘⇧V')).toBe('Ctrl+Shift+V')
    expect(macShortcutsToWin('⌥⌘I')).toBe('Ctrl+Alt+I')
    expect(macShortcutsToWin('⌥⇧⌘Z')).toBe('Ctrl+Alt+Shift+Z')
  })

  it('dedupes command and control into one Ctrl', () => {
    expect(macShortcutsToWin('⌃⌘F')).toBe('Ctrl+F')
  })

  it('handles function keys, arrows and named keys', () => {
    expect(macShortcutsToWin('⇧F5')).toBe('Shift+F5')
    expect(macShortcutsToWin('⌘⇧↑')).toBe('Ctrl+Shift+↑')
    expect(macShortcutsToWin('⌘⇧⌫')).toBe('Ctrl+Shift+Backspace')
    expect(macShortcutsToWin('⌫')).toBe('Backspace')
    expect(macShortcutsToWin('⌦')).toBe('Delete')
    expect(macShortcutsToWin('⏎')).toBe('Enter')
    expect(macShortcutsToWin('↩')).toBe('Enter')
    expect(macShortcutsToWin('␣')).toBe('Space')
  })

  it('keeps the Ctrl side of dual-platform listings', () => {
    expect(macShortcutsToWin('⌘/Ctrl+Enter 发送')).toBe('Ctrl+Enter 发送')
    expect(macShortcutsToWin('⌘/Strg+Eingabetaste')).toBe('Strg+Eingabetaste')
  })

  it('rewrites modifier+word combos and bare modifiers', () => {
    expect(macShortcutsToWin('⌘+Click to follow')).toBe('Ctrl+Click to follow')
    expect(macShortcutsToWin('按住 ⌘ 并单击')).toBe('按住 Ctrl 并单击')
  })

  it('keeps a chord embedded before non-Latin text intact', () => {
    expect(macShortcutsToWin('⌘S로 저장')).toBe('Ctrl+S로 저장')
  })

  it('leaves strings without Mac symbols untouched', () => {
    const plain = 'Ctrl+S saves the file'
    expect(macShortcutsToWin(plain)).toBe(plain)
    expect(macShortcutsToWin('文件')).toBe('文件')
  })
})

describe('shortcut rewrite order', () => {
  it('rewrites the template before interpolation so values keep their glyphs', () => {
    const template = 'Saved {name} (⌘S)'
    const params = { name: 'Plan ⇧Final.xlsx' }
    expect(format(macShortcutsToWin(template), params)).toBe('Saved Plan ⇧Final.xlsx (Ctrl+S)')
    expect(macShortcutsToWin(format(template, params))).toBe('Saved Plan Shift+Final.xlsx (Ctrl+S)')
  })
})

describe('createI18n', () => {
  const t = createI18n({
    zh: { hello: '你好 {name}', plain: '文件' },
    en: { hello: 'Hello {name}', plain: 'Files' },
  })

  it('translates per language with interpolation', () => {
    expect(t('zh', 'hello', { name: '世界' })).toBe('你好 世界')
    expect(t('en', 'hello', { name: 'world' })).toBe('Hello world')
    expect(t('zh', 'plain')).toBe('文件')
    expect(t('en', 'plain')).toBe('Files')
  })

  it('falls back en -> zh -> key for a missing entry', () => {
    const partial = createI18n({
      zh: { a: 'zh-a', b: 'zh-b' },
      en: { a: 'en-a' },
    } as unknown as Parameters<typeof createI18n>[0])
    expect(partial('en', 'a')).toBe('en-a')
    expect(partial('en', 'b')).toBe('zh-b') // en predates the key: zh carries it
    expect(partial('zh', 'a')).toBe('zh-a')
    expect(partial('zh', 'c')).toBe('c') // missing everywhere: the key itself
    // a language no dictionary ships degrades instead of throwing
    expect(partial('xx' as unknown as Lang, 'a')).toBe('en-a')
  })
})

describe('isRtlLang', () => {
  it('returns false for every value: no RTL language ships', () => {
    expect(isRtlLang('ar')).toBe(false)
    expect(isRtlLang('he')).toBe(false)
    expect(isRtlLang('zh')).toBe(false)
    expect(isRtlLang('en')).toBe(false)
    expect(isRtlLang('fa')).toBe(false) // not in LANGS today
    expect(isRtlLang(undefined)).toBe(false)
    expect(isRtlLang('')).toBe(false)
  })
})

describe('htmlDir', () => {
  it('agrees with isRtlLang on every shipped language', () => {
    // the two functions exist so bootstraps write `dir` in one place; if they
    // ever disagree, a language silently lays out the wrong way in one app
    for (const lang of LANGS) expect(htmlDir(lang)).toBe(isRtlLang(lang) ? 'rtl' : 'ltr')
  })

  it('maps every language to ltr now', () => {
    expect(htmlDir('ar')).toBe('ltr')
    expect(htmlDir('he')).toBe('ltr')
    for (const lang of ['en', 'zh', 'ZH', 'HE']) {
      expect(htmlDir(lang)).toBe('ltr')
    }
    expect(htmlDir(undefined)).toBe('ltr')
    expect(htmlDir(null)).toBe('ltr')
    expect(htmlDir('')).toBe('ltr')
  })
})
