import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'

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

for (const app of apps) {
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: join(root, 'apps', app),
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
