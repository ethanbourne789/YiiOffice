import { pruneUniverHyphenation, rendererConfig } from '../../vite.shared'

const baseConfig = rendererConfig({ app: 'sheets', port: 5174 })

export default {
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins || []),
    // Univer's docs engine lazily imports a hyphenation pattern chunk per
    // language; the sheets renderer never hyphenates cell text.
    pruneUniverHyphenation(['en-us']),
  ],
}
