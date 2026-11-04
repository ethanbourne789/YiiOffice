import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// When no app is named, build every app under frontend/apps. Every renderer
// outputs to frontend/dist/<app>, which the Go binary embeds ; a partial build
// would drop the unbuilt editors from the packaged app.
const apps =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readdirSync(join(root, 'apps'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)

if (apps.length === 0) {
  console.error('usage: node tools/build-renderers.mjs [<app...>]')
  process.exit(1)
}

/** True when this run rebuilt every renderer, so the shared pool can be rebuilt from scratch. */
const fullBuild = apps.length === readdirSync(join(root, 'apps'), { withFileTypes: true }).length

for (const app of apps) {
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: join(root, 'apps', app),
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html'])

dedupeSharedAssets(fullBuild)

/**
 * Collapses byte-identical assets that several renderers used to bundle into a
 * single served copy.
 *
 * Each app is its own Vite project and output directory, so a shared source
 * file (the Carlito faces in `packages/ui`, the pdf.js worker) was re-emitted
 * into every app that imports it — three Carlito sets and two pdf.js workers,
 * ~7 MB of duplicate bytes in `frontend/dist`.
 *
 * The Go asset server mounts apps under `/<name>/` (internal/assets/server.go),
 * so the one URL every renderer can reach without app-specific prefixes is
 * `/shell/shared/…`; the canonical copy lives under `dist/shell/` and the
 * per-app copies plus their references are replaced by it. Files are matched by
 * content hash, so a hashed filename that differs between apps is left alone.
 */
function dedupeSharedAssets(clearPool) {
  const distDir = join(root, 'dist')
  if (!existsSync(distDir)) return
  const poolDir = join(distDir, 'shell', 'shared')
  const poolUrl = '/shell/shared'
  if (clearPool) rmSync(poolDir, { recursive: true, force: true })

  const shareable = [
    { group: 'fonts', test: (name) => /^Carlito-.+\.ttf$/i.test(name) },
    { group: 'pdf', test: (name) => /^pdf\.worker\.min-.+\.(mjs|js)$/.test(name) },
    // The dynamically imported pdf.js library chunk; verified self-contained
    // (no relative imports), so relocating it does not strand subresources.
    { group: 'pdf', test: (name) => /^pdf-[0-9A-Za-z_]+\.js$/.test(name) },
  ]
  const groupOf = (name) => shareable.find((rule) => rule.test(name))?.group

  const candidates = new Map()
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const appDir = join(distDir, entry.name)
    for (const file of walkFiles(appDir)) {
      if (file.startsWith(`${poolDir}${sep}`)) continue
      const name = basename(file)
      const group = groupOf(name)
      if (group === undefined) continue
      const group0 = candidates.get(name) ?? { group, copies: [] }
      group0.copies.push({
        file,
        hash: createHash('sha256').update(readFileSync(file)).digest('hex'),
      })
      candidates.set(name, group0)
    }
  }

  const shared = []
  let savedBytes = 0
  for (const [name, { group, copies }] of candidates) {
    if (new Set(copies.map((c) => c.hash)).size > 1) {
      console.warn(`  ! ${name}: same name, different bytes across apps — left duplicated`)
      continue
    }
    const target = join(poolDir, group, name)
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target)) {
      if (copyHash(target) !== copies[0].hash) {
        console.warn(`  ! ${name}: shared copy differs from the fresh build — left duplicated`)
        continue
      }
      for (const copy of copies) savedBytes += removeFile(copy.file)
    } else {
      const [first, ...rest] = copies
      renameSync(first.file, target)
      for (const copy of rest) savedBytes += removeFile(copy.file)
    }
    shared.push({ name, url: `${poolUrl}/${group}/${name}` })
  }

  if (shared.length > 0) rewriteReferences(distDir, shared)
  if (savedBytes > 0) {
    console.log(`  shared assets: ${shared.length} files, ${(savedBytes / (1 << 20)).toFixed(2)} MB de-duplicated`)
  }
}

function copyHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function removeFile(file) {
  const size = existsSync(file) ? statSync(file).size : 0
  rmSync(file, { force: true })
  return size
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(full)
    else yield full
  }
}

/**
 * Points every emitted reference at the shared URL. Vite writes these as
 * app-relative (`./<hashed name>`, resolved against the chunk or stylesheet, or
 * `new URL(\`<name>\`, import.meta.url)`), so both spellings are rewritten and
 * the absolute `/shell/shared/…` path resolves identically from any app depth.
 */
function rewriteReferences(distDir, shared) {
  const replacements = shared.flatMap(({ name, url }) => [
    [`./${name}`, url],
    [`\`${name}\``, `\`${url}\``],
    [`"${name}"`, `"${url}"`],
  ])
  for (const file of walkFiles(distDir)) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    let next = text
    for (const [from, to] of replacements) next = next.split(from).join(to)
    if (next !== text) writeFileSync(file, next)
  }
}
