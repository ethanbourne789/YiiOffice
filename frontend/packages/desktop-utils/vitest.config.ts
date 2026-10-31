import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // the default 5s is not enough once the whole repo runs in parallel
    testTimeout: 20000,
    environment: 'node',
  },
})
