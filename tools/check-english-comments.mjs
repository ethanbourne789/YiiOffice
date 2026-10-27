#!/usr/bin/env node
// English-only guard for TypeScript comments: no Chinese may appear in a `//`,
// `/* */` or JSDoc comment of a tracked .ts/.tsx file. Catch the violation in
// the change that introduces it.
//
// ## Why prose is out of scope
//
// The documents are Chinese on purpose: README.md is the source of truth and
// docs/i18n/README.en.md mirrors it, so a scan over them reported the
// documentation for being documentation and buried the comments that actually
// needed fixing. docs/** is skipped outright, and non-TypeScript sources
// (tools/*.mjs, the Rust sidecar, the font scripts) are left to review - widen
// CODE below if a Chinese comment ever slips through one of them.
//
// Functional CJK string literals are still fine (i18n resources, test
// fixtures, zh-UI matchers): only comment text is extracted and tested.
//
// ## The one exception
//
// A comment can need CJK as its subject rather than as prose - a function whose
// whole contract is "render these numerals" cannot describe itself in English
// alone, and quoting the string a status message shows is more useful than
// paraphrasing it. Such a comment block carries `cjk-example` on any of its
// lines; the marker is the claim that the CJK is the subject, and it is
// reviewed like any other claim.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HAN = /[\u3400-\u9fff]/
const CODE = /\.(ts|tsx)$/
const SKIP = /^docs\//
const ALLOWED = 'cjk-example'

const git = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
if (git.status !== 0) {
  console.error(git.stderr)
  process.exit(git.status ?? 1)
}
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()

/** The comment text on a line, or undefined when the line is not a comment. */
function commentText(line) {
  return (
    line.match(/(?:^|[^:'"])\/\/(.*)$/) ?? line.match(/^\s*\*(.*)$/) ?? line.match(/\/\*(.*)$/)
  )?.[1]
}

const violations = []
for (const file of git.stdout.trim().split('\n')) {
  if (!CODE.test(file) || SKIP.test(file)) continue
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  // One decision per comment block: `//` runs and JSDoc bodies are judged
  // together, so a single marker covers the paragraph it belongs to.
  let block = []
  const flush = () => {
    if (!block.some((entry) => entry.line.includes(ALLOWED))) {
      for (const entry of block) {
        if (HAN.test(entry.text)) violations.push(`  ${file}:${entry.index + 1}: ${entry.line.trim()}`)
      }
    }
    block = []
  }
  lines.forEach((line, index) => {
    const text = commentText(line)
    if (text === undefined) return flush()
    block.push({ line, text, index })
  })
  flush()
}

if (violations.length > 0) {
  console.error(
    `Chinese text found in TypeScript comments:\n${violations.join('\n')}\n` +
      'Comments must be English-only. Move CJK text into a string literal, ' +
      'rewrite the comment in English, or - when the CJK is the subject rather ' +
      `than untranslated prose - say so with \`${ALLOWED}\` on the block.`,
  )
  process.exit(1)
}
console.log('check-english-comments: OK')
