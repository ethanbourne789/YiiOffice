#!/usr/bin/env node
// Single source of truth for the product version.
//
//   node tools/version.mjs check                 # CI / pre-package gate
//   node tools/version.mjs check-tag v0.13.0    # release workflow gate
//   node tools/version.mjs bump 0.14.0          # rewrite every declared slot
//
// VERSION is the only authoritative value. Slots below are deliberately
// narrow: package-lock.json contains hundreds of dependency versions, the
// site quotes WebView2/Wails versions and size figures, so a blind global
// search-and-replace would corrupt them. Each regex captures the product
// version in group 1 and nothing else.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')
const write = (rel, text) => writeFileSync(resolve(root, rel), text)
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const APP_NAMES = ['shell', 'docs', 'sheets', 'slides', 'pdf', 'markdown']

/** @type {Array<[string, RegExp]>} file -> regex whose group 1 is the version */
const slots = [
  ['Taskfile.yml', /^\s*VERSION:.*default "(\d+\.\d+\.\d+)"/gm],
  ['config.yml', /^\s*version:\s*"(\d+\.\d+\.\d+)"/gm],
  ['build/windows/info.json', /"(?:file_version|ProductVersion)":\s*"(\d+\.\d+\.\d+)"/g],
  ['build/windows/wails.exe.manifest', /name="com\.yiioffice\.app"\s+version="(\d+\.\d+\.\d+)"/g],
  ['build/windows/nsis/installer.nsi', /makensis -DAPP_VERSION=(\d+\.\d+\.\d+)/g],
  ['build/windows/nsis/installer.nsi', /^\s*!define APP_VERSION "(\d+\.\d+\.\d+)"/gm],
  ['docker/Dockerfile.server', /^ARG VERSION=(\d+\.\d+\.\d+)/gm],
  ['docker/Dockerfile.server', /\(default (\d+\.\d+\.\d+)\)/g],
  ['frontend/package.json', /^\s*"version":\s*"(\d+\.\d+\.\d+)"/gm],
  ...APP_NAMES.map((name) => [
    `frontend/apps/${name}/package.json`,
    /^\s*"version":\s*"(\d+\.\d+\.\d+)"/gm,
  ]),
  ['site/index.html', /(?:<small>|startcard__ver">)v(\d+\.\d+\.\d+)/g],
  ['site/index.html', /YiiOffice_(\d+\.\d+\.\d+)_setup\.exe/g],
  ['site/index.html', /data-base="true"[\s\S]*?<td>(\d+\.\d+\.\d+)<\/td>/g],
  ['site/en/index.html', /(?:<small>|startcard__ver">)v(\d+\.\d+\.\d+)/g],
  ['site/en/index.html', /YiiOffice_(\d+\.\d+\.\d+)_setup\.exe/g],
  ['site/en/index.html', /data-base="true"[\s\S]*?<td>(\d+\.\d+\.\d+)<\/td>/g],
  ['README.md', /\*\*YiiOffice\*\*\s*\|\s*(\d+\.\d+\.\d+)/g],
  ['README.md', /YiiOffice_(\d+\.\d+\.\d+)_setup\.exe/g],
  ['README.en.md', /\*\*YiiOffice\*\*\s*\|\s*(\d+\.\d+\.\d+)/g],
  ['README.en.md', /YiiOffice_(\d+\.\d+\.\d+)_setup\.exe/g],
]

const LOCK_FILE = 'frontend/package-lock.json'
const LOCK_KEYS = ['', ...APP_NAMES.map((name) => `apps/${name}`)]

function slotMatches(text, source) {
  const re = new RegExp(source.source, source.flags)
  const found = []
  let m
  while ((m = re.exec(text)) !== null) {
    found.push({ value: m[1], index: m.index, full: m[0] })
    if (m[0] === '') break // defensive: never loop forever on a zero-width match
  }
  return found
}

function lockVersions(text) {
  const lock = JSON.parse(text)
  const out = [{ key: 'version', value: lock.version }]
  for (const key of LOCK_KEYS) {
    const pkg = lock.packages?.[key]
    out.push({ key: `packages["${key}"].version`, value: pkg?.version })
  }
  return out
}

function check(version, { quiet = false } = {}) {
  const problems = []
  let count = 0

  for (const [file, source] of slots) {
    const matches = slotMatches(read(file), source)
    if (matches.length === 0) {
      problems.push(`${file}: version slot no longer matches (file layout changed?)`)
      continue
    }
    for (const match of matches) {
      count++
      if (match.value !== version) {
        problems.push(`${file}: found ${match.value}, expected ${version}`)
      }
    }
  }

  for (const entry of lockVersions(read(LOCK_FILE))) {
    count++
    if (entry.value !== version) {
      problems.push(`${LOCK_FILE}: ${entry.key} is ${entry.value}, expected ${version}`)
    }
  }

  if (!quiet) {
    if (problems.length > 0) {
      console.error(`Version check FAILED (${problems.length} problem(s), ${count} slots checked):`)
      for (const p of problems) console.error(`  - ${p}`)
      console.error(`  VERSION file says ${version}; run: node tools/version.mjs bump <new-version>`)
    } else {
      console.log(`Version check OK: ${version} across ${count} slots in ${new Set(slots.map((s) => s[0])).size + 1} files`)
    }
  }
  return problems
}

function replaceSlot(text, source, from, to) {
  const re = new RegExp(source.source, source.flags)
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] === from) {
      const start = m.index + m[0].indexOf(m[1])
      out += text.slice(last, start) + to
      last = start + m[1].length
    }
    if (m[0] === '') break
  }
  return out + text.slice(last)
}

function versionOrDie(raw, label) {
  const value = (raw || '').trim()
  if (!SEMVER.test(value)) {
    console.error(`${label}: "${raw}" is not a semver like 0.14.0`)
    process.exit(1)
  }
  return value
}

const [, , command, arg] = process.argv
const current = versionOrDie(read('VERSION'), 'VERSION file')

switch (command) {
  case 'check': {
    const problems = check(current)
    process.exit(problems.length > 0 ? 1 : 0)
    break
  }
  case 'check-tag': {
    const tag = (arg || '').trim()
    if (!/^v\d+\.\d+\.\d+/.test(tag) || tag !== `v${current}`) {
      console.error(`Tag ${tag || '(none)'} does not match VERSION (${current}); expected v${current}`)
      process.exit(1)
    }
    const problems = check(current, { quiet: true })
    if (problems.length > 0) {
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    console.log(`Tag ${arg} matches VERSION ${current}`)
    break
  }
  case 'bump': {
    const next = versionOrDie(arg, 'new version')
    const before = check(current, { quiet: true })
    if (before.length > 0) {
      console.error('Refusing to bump: repository versions are already inconsistent.')
      for (const p of before) console.error(`  - ${p}`)
      process.exit(1)
    }
    if (next === current) {
      console.error(`Already at ${current}`)
      process.exit(1)
    }

    const byFile = new Map()
    for (const [file, source] of slots) {
      if (!byFile.has(file)) byFile.set(file, read(file))
      byFile.set(file, replaceSlot(byFile.get(file), source, current, next))
    }
    for (const [file, text] of byFile) write(file, text)

    // npm ci cares about the root and every workspace version. Replace only
    // the literal product-version entries and assert the exact slot count.
    const lock = read(LOCK_FILE)
    const needle = `"version": "${current}"`
    const parts = lock.split(needle)
    if (parts.length - 1 !== LOCK_KEYS.length + 1) {
      console.error(`${LOCK_FILE}: expected ${LOCK_KEYS.length + 1} product versions, found ${parts.length - 1}`)
      process.exit(1)
    }
    write(LOCK_FILE, parts.join(`"version": "${next}"`))
    write('VERSION', `${next}\n`)

    const after = check(next)
    console.log(`Bumped ${current} -> ${next}`)
    process.exit(after.length > 0 ? 1 : 0)
    break
  }
  default:
    console.error('Usage: node tools/version.mjs check | check-tag <vX.Y.Z> | bump <X.Y.Z>')
    process.exit(1)
}
