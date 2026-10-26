import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Runtime wasm assets live in node_modules during dev/tests but the packaged app
 * ships no node_modules (everything is bundled) — electron-builder copies them
 * into Resources/wasm instead (see apps/shell/electron-builder.cjs extraResources).
 */
const packagedPath = (fileName: string) => join(process.resourcesPath, 'wasm', fileName)

const req = () => createRequire(import.meta.url)

export function pdfiumWasmPath(): string {
  try {
    return req().resolve('@embedpdf/pdfium/pdfium.wasm')
  } catch {
    return packagedPath('pdfium.wasm')
  }
}

export function hbSubsetWasmPath(): string {
  try {
    // harfbuzzjs 1.x seals subpaths except ./dist/*.wasm — resolve through the exports map
    return req().resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')
  } catch {
    return packagedPath('hb-subset.wasm')
  }
}
