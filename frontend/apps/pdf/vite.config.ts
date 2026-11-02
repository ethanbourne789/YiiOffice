import { rendererConfig } from '../../vite.shared'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { normalizePath } from 'vite'

const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(dirname(require.resolve('pdfjs-dist/package.json')))
const pdfjsDir = (sub) => normalizePath(join(pdfjsRoot, 'pdfjs-dist', sub))

const baseConfig = rendererConfig({ app: 'pdf', port: 5176 })

export default {
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins || []),
    // view-config.ts resolves these against `${document.baseURI}pdfjs/`
    // (/pdf/pdfjs/cmaps/ in a packaged build), so the copies must land under
    // `pdfjs/` of the renderer output rather than at the bundle root — at the
    // root they 404'd and CJK text fell back to missing glyphs, while the wasm
    // image codecs (JBIG2/JPX) never loaded at all.
    // The worker is not copied here: main.tsx imports it with `?url` so Vite
    // emits it as a hashed, base-relative asset.
    viteStaticCopy({
      targets: [
        // Glob the *contents*: copying the bare absolute directory keeps the
        // whole node_modules path (`pdfjs/node_modules/pdfjs-dist/cmaps`),
        // which is not the URL the renderer asks for.
        { src: `${pdfjsDir('cmaps')}/*`, dest: 'pdfjs/cmaps' },
        { src: `${pdfjsDir('standard_fonts')}/*`, dest: 'pdfjs/standard_fonts' },
        { src: `${pdfjsDir('wasm')}/*`, dest: 'pdfjs/wasm' },
      ],
    }),
  ],
}
