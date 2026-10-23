import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @yiioffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail. Bundle those;
    // externalize everything else (Electron, zod, node builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@yiioffice/docx-engine',
          '@yiioffice/file-parse',
          '@yiioffice/electron-utils',
          '@yiioffice/i18n',
          '@yiioffice/pptx-render',
          '@yiioffice/xlsx-gateway',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at
    // runtime, so the drop-open bridge must be bundled, not externalized.
    plugins: [externalizeDepsPlugin({ exclude: ['@yiioffice/electron-utils'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
