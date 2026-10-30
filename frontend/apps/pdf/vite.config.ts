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
    viteStaticCopy({
      targets: [
        { src: pdfjsDir('cmaps'), dest: 'cmaps' },
        { src: pdfjsDir('standard_fonts'), dest: 'standard_fonts' },
        { src: normalizePath(join(pdfjsRoot, 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')), dest: '' },
      ],
    }),
  ],
}
