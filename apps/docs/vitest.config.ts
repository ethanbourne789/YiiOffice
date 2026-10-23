import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@yiioffice/docx-engine/lazy-media': local('../../packages/docx-engine/src/lazy-media.ts'),
      '@yiioffice/docx-engine': local('../../packages/docx-engine/src/index.ts'),
      '@yiioffice/font-metrics': local('../../packages/font-metrics/src/index.ts'),
      // subpath before the bare name: string aliases are prefix replacements
      '@yiioffice/electron-utils/headless-export': local(
        '../../packages/electron-utils/src/headless-export.ts',
      ),
      '@yiioffice/electron-utils/atomic-write': local(
        '../../packages/electron-utils/src/atomic-write.ts',
      ),
      '@yiioffice/electron-utils/safe-external-url': local(
        '../../packages/electron-utils/src/safe-external-url.ts',
      ),
      '@yiioffice/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@yiioffice/i18n': local('../../packages/i18n/src/index.ts'),
      '@yiioffice/ui': local('../../packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
