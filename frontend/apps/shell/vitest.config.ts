import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vitest.config.ts does not inherit vite.config.ts, so mirror its `@bindings`
  // alias: the renderer reaches wails-bridge (close-save), which imports the
  // generated bindings.
  resolve: {
    alias: {
      '@bindings': resolve(__dirname, '../../bindings'),
    },
  },
  test: {
    // Shell keeps its renderer one level deeper than the other apps.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
})
