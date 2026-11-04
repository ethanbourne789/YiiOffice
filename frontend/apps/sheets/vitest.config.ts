import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vitest.config.ts does not inherit vite.config.ts, so mirror its
  // `@bindings` alias: the renderer's locale module now reaches wails-bridge.
  resolve: {
    alias: {
      '@bindings': resolve(__dirname, '../../bindings'),
    },
  },
  test: {
    include: ['src/renderer/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
})
