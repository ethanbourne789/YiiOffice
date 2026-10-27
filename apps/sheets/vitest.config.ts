import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // the sidecar round-trips spawn a native process and write real files;
    // 5s is not enough once the whole repo runs in parallel
    testTimeout: 20000,
  },
})
