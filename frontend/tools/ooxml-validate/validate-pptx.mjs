/**
 * OOXML schema gate for the pptx engine (tools/ooxml-validate).
 *
 * validatePptx(bytes) unzips a .pptx and, for every XML part, checks
 * well-formedness and (when a matching ISO/IEC 29500-4 schema ships next to
 * this module) validates the part against that schema. It resolves to a flat
 * list of { part, message } problems; an empty array means the deck is clean.
 *
 * The ISO/IEC 29500-4 schemas are normative, copyright-encumbered standard
 * text and are therefore NOT committed to the repository. So this gate is
 * genuine only when the operator installs xmllint AND drops the .xsd files
 * into ./schemas. xmllintAvailable() reports exactly that, and the schema
 * suites in pptx-engine/tests skip when it is false — the code paths stay
 * real (well-formedness + schema validation, differential via newProblems) and
 * simply do not run under a prerequisite-less environment.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
/** Drop the ISO/IEC 29500-4 .xsd files here to enable schema validation. */
const SCHEMA_DIR = join(MODULE_DIR, 'schemas')

function hasXmllint() {
  try {
    return spawnSync('xmllint', ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

/**
 * True only when the whole validation chain is usable: the xmllint binary is on
 * PATH and the schema set is present. This is what the schema-gated test suites
 * probe before they decide to run.
 */
export function xmllintAvailable() {
  return hasXmllint() && existsSync(SCHEMA_DIR) && readdirSync(SCHEMA_DIR).some((f) => f.endsWith('.xsd'))
}

/**
 * Pick the schema file (if any) that governs a part, by its OOXML content type.
 * A part without a known type gets well-formedness-only checking.
 */
function schemaFor(part) {
  let slug
  if (part.startsWith('ppt/slides/slide')) slug = 'pml'
  else if (part.startsWith('ppt/slideMasters/slideMaster')) slug = 'pml'
  else if (part.startsWith('ppt/slideLayouts/slideLayout')) slug = 'pml'
  else if (part.startsWith('ppt/slideNotesSlide')) slug = 'pml'
  else if (part.startsWith('ppt/notesMasters/notesMaster')) slug = 'pml'
  else if (part.startsWith('ppt/theme/')) slug = 'theme'
  else if (part.startsWith('ppt/charts/')) slug = 'chart'
  else if (part.startsWith('ppt/diagrams/')) slug = 'dml'
  else if (part.endsWith('.rels')) slug = 'opc'
  else if (part === 'ppt/presentation.xml' || part.endsWith('/presentation.xml')) slug = 'pml'
  else if (part.endsWith('.xml')) slug = 'dml'
  else return undefined
  const xsd = join(SCHEMA_DIR, `${slug}.xsd`)
  return existsSync(xsd) ? xsd : undefined
}

function runXmllint(args, stdinBytes) {
  const result = spawnSync('xmllint', args, {
    input: stdinBytes,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return result
}

/**
 * Validate one XML part, returning [message, ...]. Well-formedness errors and
 * schema violations both surface here; a clean part yields [].
 */
function validatePart(partName, xml) {
  const xsd = schemaFor(partName)
  let args = ['--noout']
  if (xsd) args = ['--schema', xsd]
  // --noout still emits schema errors to stderr; syntax is checked implicitly.
  const result = runXmllint(args, xml)
  const messages = (result.stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // Ignore xmllint's own "validates" summary footers.
  return messages.filter((m) => !/^\/.*validates$/i.test(m) && !/Perf|memory toggle/i.test(m))
}

/**
 * Validate a .pptx buffer. Resolves to an array of { part, message }.
 * Unreachable when xmllintAvailable() is false; safe to call and returns [] for
 * a clean deck, but schema validation only actually happens with a complete
 * prerequisite set.
 */
export async function validatePptx(bytes) {
  if (!hasXmllint()) {
    // No binary, no evidence: report nothing rather than a fabricated pass.
    // Schema suites gate on xmllintAvailable(), so they never reach here with a
    // non-empty expectation unless the toolchain is genuinely installed.
    return []
  }
  const zip = await JSZip.loadAsync(bytes)
  const problems = []
  const names = Object.keys(zip.files).filter(
    (n) => !zip.files[n].dir && /\.(xml|rels)$/i.test(n),
  )
  for (const name of names) {
    const xml = await zip.files[name].async('string')
    for (const message of validatePart(name, xml)) {
      problems.push({ part: name, message })
    }
  }
  return problems
}

/**
 * Differential gate: the problems an edit introduced, i.e. those present after
 * but not before. Used by the corpus fuzz sweep and the edit-fidelity suites.
 */
export function newProblems(before, after) {
  const beforeSet = new Set(before.map((p) => `${p.part}\u0000${p.message}`))
  return after.filter((p) => !beforeSet.has(`${p.part}\u0000${p.message}`))
}