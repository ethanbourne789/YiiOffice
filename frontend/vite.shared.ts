import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

/** Absolute path to the generated Wails bindings (frontend/bindings). */
const bindingsRoot = resolve(__dirname, 'bindings')

export interface RendererConfigOptions {
  app: string
  port: number
}

/** Shared renderer build settings: relative asset URLs so /docs/ can be served under any host prefix. */
export function rendererConfig({ app, port }: RendererConfigOptions): UserConfig {
  return defineConfig({
    root: 'src/renderer',
    base: './',
    plugins: [react()],
    resolve: {
      alias: {
        '@bindings': bindingsRoot,
      },
    },
    server: { port, strictPort: true },
    build: {
      outDir: `../../../../dist/${app}`,
      emptyOutDir: true,
      target: 'chrome120',
      sourcemap: false,
    },
  })
}