import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve generated Wails bindings exactly like the renderer Vite builds
// (vite.shared.ts aliases @bindings → frontend/bindings).
const bindingsRoot = fileURLToPath(new URL('../../bindings', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@bindings': bindingsRoot,
    },
  },
  test: { environment: 'jsdom', globals: true },
})
