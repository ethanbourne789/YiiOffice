import { defineConfig } from 'vitest/config'

/**
 * Root test orchestrator.
 *
 * Every workspace keeps its own `vitest.config.ts` (aliases, jsdom vs node
 * environment, timeouts). This file only lists them so one `vitest run` covers
 * the whole repo:
 *
 *   - the previous `npm run test -w a && npm run test -w b && ...` chain
 *     short-circuited on the first failing package, so a red `electron-utils`
 *     meant the other 17 workspaces never ran at all;
 *   - chaining also forced a strictly serial run (~7 min wall clock).
 *
 * Vitest's `projects` runs every listed config in one process, keeps the
 * per-project settings intact, and reports failures from all of them.
 *
 * Note: in a multi-project run `process.cwd()` stays the directory Vitest was
 * started from, so tests must not resolve repo files relative to the cwd.
 */
export default defineConfig({
  test: {
    // The suite spawns native sidecar processes and writes real files, so the
    // default "one worker per core" oversubscribes the machine and the
    // I/O-bound cases start timing out. 8 workers keeps the CPU saturated
    // without starving them.
    maxWorkers: 8,
    projects: [
      'apps/docs/vitest.config.ts',
      'apps/markdown/vitest.config.ts',
      'apps/pdf/vitest.config.ts',
      'apps/sheets/vitest.config.ts',
      'apps/shell/vitest.config.ts',
      'apps/slides/vitest.config.ts',
      'packages/docx-engine/vitest.config.ts',
      'packages/electron-utils/vitest.config.ts',
      'packages/file-parse/vitest.config.ts',
      'packages/font-metrics/vitest.config.ts',
      'packages/html2docx/vitest.config.ts',
      'packages/i18n/vitest.config.ts',
      'packages/pdf2docx/vitest.config.ts',
      'packages/pptx-engine/vitest.config.ts',
      'packages/pptx-ops/vitest.config.ts',
      'packages/pptx-render/vitest.config.ts',
      'packages/ui/vitest.config.ts',
      'packages/xlsx-gateway/vitest.config.ts',
      'packages/zip-gate/vitest.config.ts',
    ],
  },
})
