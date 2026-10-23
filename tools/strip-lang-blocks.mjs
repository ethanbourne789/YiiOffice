#!/usr/bin/env node
/**
 * Strip retired-language entries from TypeScript sources.
 *
 *   node tools/strip-lang-blocks.mjs [--dry-run] <file> [...]
 *
 * Pass 1 finds "language maps": object literals whose direct child keys are a
 * majority of retired language codes. Pass 2 deletes, inside those maps only,
 * the retired entries — block entries take their whole range down to the
 * same-indent `}`, single-line entries go alone, and zh/en entries are never
 * touched. Import/export statements whose relative specifier ends in a retired
 * code (`import { ja } from './app/ja'`) are dropped as well.
 *
 * Two deliberate properties:
 *
 * - The majority test (`retired >= 2 && retired * 2 >= total`) is what keeps
 *   coincidences safe: `id` is both Indonesian's code and an English word, so
 *   `id: String(w.id)` inside a menu object is never classified as a language
 *   map. It also deliberately does not require zh/en to be present, because
 *   counts.ts has only cs/ar and univer-locales.ts has no en.
 * - Only relative specifiers (`./`, `../`) are stripped from imports, so a
 *   bare package path like `date-fns/locale/fr` can never be deleted.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RETIRED = new Set([
  'ar',
  'cs',
  'de',
  'es',
  'fr',
  'he',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'pl',
  'pt',
  'ru',
  'th',
  'vi',
  'zh-TW',
])

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const files = args.filter((a) => a !== '--dry-run')
if (files.length === 0) {
  console.error('usage: node tools/strip-lang-blocks.mjs [--dry-run] <file> [...]')
  process.exit(1)
}

/** the key of a line: `ja: …`, `'zh-TW': …`, or a shorthand `ja` / `ja,` */
function keyOf(line) {
  const t = line.trim()
  const explicit = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(t)
  if (explicit) return explicit[1] ?? explicit[2] ?? explicit[3]
  const shorthand = /^([A-Za-z_$][\w$]*)\s*,?$/.exec(t)
  return shorthand ? shorthand[1] : null
}

const indentOf = (line) => line.length - line.trimStart().length
const isComment = (t) => t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')
const isCloser = (t) => /^[}\])]/.test(t)
const opensBlock = (t) => /\{\s*$/.test(t)

/**
 * The line that closes the block opened at `from` (whose members sit at
 * `indent`). A closer deeper than `indent` belongs to an inner block; a closer
 * shallower, or a sibling key before any close, means the shape is not the one
 * this script knows how to cut — return null and let typecheck report it.
 */
function closingLine(lines, from, indent) {
  for (let j = from + 1; j < lines.length; j++) {
    const t = lines[j].trim()
    if (!t || isComment(t)) continue
    const ind = indentOf(lines[j])
    if (ind < indent) return null
    if (ind === indent) return isCloser(t) ? j : null
    // ind > indent: still inside the block, keep going
  }
  return null
}

/** Pass 1: collect language maps — { start, end, childIndent } */
function pass1(lines) {
  const root = { indent: -1, start: -1, keys: [], childIndent: null }
  const stack = [root]
  const maps = []
  const closeFrame = (endLine) => {
    const frame = stack.pop()
    if (frame.start < 0) return
    const retired = frame.keys.filter((k) => RETIRED.has(k)).length
    if (frame.childIndent !== null && retired >= 2 && retired * 2 >= frame.keys.length) {
      maps.push({ start: frame.start, end: endLine, childIndent: frame.childIndent })
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const t = raw.trim()
    if (!t || isComment(t)) continue
    const indent = indentOf(raw)
    if (isCloser(t)) {
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) closeFrame(i)
      continue
    }
    const key = keyOf(t)
    if (key !== null) {
      const top = stack[stack.length - 1]
      top.keys.push(key)
      if (top.childIndent === null) top.childIndent = indent
    }
    if (opensBlock(t) || /\[\s*$/.test(t)) {
      stack.push({ indent, start: i, keys: [], childIndent: null })
    }
  }
  while (stack.length > 1) closeFrame(lines.length - 1)
  return maps
}

/** Pass 2: inside classified maps, mark retired entries for deletion */
function pass2(lines, maps) {
  const kill = new Set()
  for (const map of maps) {
    for (let i = map.start + 1; i <= map.end; i++) {
      const raw = lines[i]
      const t = raw.trim()
      if (!t || isComment(t)) continue
      if (indentOf(raw) !== map.childIndent) continue
      if (isCloser(t)) continue
      const key = keyOf(t)
      if (key === null) continue
      if (!RETIRED.has(key)) {
        // kept (zh/en or anything else): jump over its block so the interior
        // is never scanned
        if (opensBlock(t)) {
          const close = closingLine(lines, i, map.childIndent)
          if (close !== null) i = close
        }
        continue
      }
      let last = i
      if (opensBlock(t)) {
        const close = closingLine(lines, i, map.childIndent)
        if (close === null) {
          console.warn(`  skip line ${i + 1}: no closing brace found for ${key}`)
          continue
        }
        last = close
      }
      let first = i
      while (first - 1 > map.start && lines[first - 1].trim() === '') first--
      for (let j = first; j <= last; j++) kill.add(j)
      i = last
    }
  }
  return kill
}

/** Import/export statements whose relative specifier ends in a retired code */
function importKill(lines) {
  const kill = new Set()
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:import|export)\s+(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"];?$/.exec(lines[i].trim())
    if (!m) continue
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const base = spec
      .split('/')
      .pop()
      .replace(/\.(ts|tsx|js|mjs|cjs)$/, '')
    if (RETIRED.has(base)) kill.add(i)
  }
  return kill
}

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)
  const maps = pass1(lines)
  const kill = pass2(lines, maps)
  for (const j of importKill(lines)) kill.add(j)
  const suffix = maps.length === 1 ? 'language map' : 'language maps'
  const label = `${String(kill.size).padStart(4)} lines  ${file} (${maps.length} ${suffix})`
  if (kill.size === 0) {
    console.log(`   0 lines  ${file} (no retired entries)`)
    continue
  }
  if (dryRun) {
    console.log(`${label} — dry-run, nothing written`)
    continue
  }
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(file, lines.filter((_, i) => !kill.has(i)).join(eol))
  console.log(label)
}
