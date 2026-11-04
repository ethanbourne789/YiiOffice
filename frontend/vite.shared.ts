import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

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

/**
 * Drops Univer's per-language hyphenation pattern chunks from the bundle.
 *
 * @univerjs/engine-render ships one lazily imported chunk per TeX pattern
 * language (86 files, ~4.9 MB in the sheets output). Those patterns belong to
 * its *docs* layout engine and are only consulted when a paragraph opts into
 * autohyphenation; the sheets renderer never hyphenates cell text (Excel has
 * no such feature), so every chunk was dead weight.
 *
 * Only the loader map is pruned: `PATTERN_LOADERS[lang]` missing is the module's
 * own "unsupported language" path (`_loadPattern` returns without importing),
 * so a locale outside `keep` behaves exactly as an unsupported one did before —
 * no request is made and nothing 404s. `en-us` is inlined in the module (it is
 * not a chunk) and is the one pattern the layout engine preloads, so keeping it
 * costs nothing.
 */
export function pruneUniverHyphenation(keep: readonly string[]): Plugin {
  const keepSet = new Set(keep)
  const marker = /const PATTERN_LOADERS = \{[^}]*\};/
  const head = 'const PATTERN_LOADERS = {'
  return {
    name: 'yiioffice:prune-univer-hyphenation',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]engine-render[\\/]lib[\\/]es[\\/]index\.js$/.test(id.split('?')[0])) return null
      const match = marker.exec(code)
      if (!match) throw new Error(`prune-univer-hyphenation: PATTERN_LOADERS not found in ${id}`)
      const body = match[0].slice(head.length, -'};'.length)
      const kept = body
        .split('\n')
        .filter((line) => {
          const key = /^\s*\["([^"]+)"\]/.exec(line)
          return key === null || keepSet.has(key[1])
        })
        .join('\n')
      return (
        code.slice(0, match.index) +
        head +
        kept +
        '};' +
        code.slice(match.index + match[0].length)
      )
    },
  }
}