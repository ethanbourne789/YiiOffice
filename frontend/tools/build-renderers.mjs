import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const apps = process.argv.slice(2)

if (apps.length === 0) {
  console.error('usage: node tools/build-renderers.mjs <app...>')
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
