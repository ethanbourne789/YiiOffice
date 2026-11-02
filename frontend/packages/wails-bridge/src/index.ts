import type { WailsRuntime } from './transport'
import { createHomeApi } from './home-bridge'
import { createTabsApi } from './tabs-bridge'
import { createWindowControlsApi } from './window-bridge'
import { on } from './transport'
import { shellOpenExternal } from './shell-bridge'

// Official Wails V3 runtime. In production Wails serves the same code at
// /wails/runtime.js, packaged here as the @wailsio/runtime npm module. Wails never
// injects a public `window.wails`, but the legacy Electron-compatible transport reads
// one, so expose the official runtime's named exports there.
import * as runtimeModule from '@wailsio/runtime'
// The official runtime's event API is eventemitter-style and types differently from
// the legacy transport's narrow model, but Events.On / Events.Off are
// compatible at runtime. Cast to bridge the typing difference.
;(window as unknown as { wails?: WailsRuntime }).wails ??= runtimeModule as unknown as WailsRuntime
import { createDesktopApi, createMarkdownApi } from './editor-api'
import { createSlidesDesktopApi } from './slides-bridge'
import type { HomeBridge } from './home-bridge'
import type { TabsBridge } from './tabs-bridge'
import type { DesktopApi, MarkdownApi } from './editor-api'
import type { SlidesDesktopApi } from './slides-bridge'
import type { WindowControlsApi } from './window-bridge'

export { on, runtime } from './transport'
export type { HomeBridge } from './home-bridge'
export type { TabsBridge, TabSummary } from './tabs-bridge'
export type { AppTheme, UiLanguage } from './types'
export {
  createDesktopApi,
  createMarkdownApi,
  shellReadLocalImage,
  shellOpenExternal,
} from './editor-api'
export type { DesktopApi, MarkdownApi } from './editor-api'
export { createSlidesDesktopApi, registerEditHandlers } from './slides-bridge'
export type { SlidesDesktopApi } from './slides-bridge'
export { currentTabId, currentTabPath, setCurrentTabDirty } from './tabs-bridge'
export { createWindowControlsApi, readMaximised } from './window-bridge'
export type { WindowControlsApi } from './window-bridge'
export {
  exportPdfFile,
  exportHtmlFile,
  renderPdfBase64,
  mergePdfParts,
  pickExportFolder,
  takeTempPdf,
  writeBase64File,
  pickSavePath,
  listPrinters,
} from './export-bridge'
export type { ExportResult, ExportFolder, PrinterInfo } from './export-bridge'

/**
 * Globals published for the Electron-compatible renderers.
 *
 * Each app declares the `Window` members it consumes in its own `env.d.ts`/module
 * (docs' DesktopApi, sheets' DesktopApi, slides' SlidesApi subset, shell's HomeApi, …),
 * so the bridge does not declare them globally: a second, differently typed
 * declaration collides with those (TS2717 "subsequent property declarations must have
 * the same type") and wins the merge, degrading every call site to `unknown`.
 * The bridge therefore publishes and reads them through this narrow view.
 * `pdfApi`/`desktopApi` are installed by their own apps, not here.
 */
interface BridgedGlobals {
  aiOffice: HomeBridge
  aiOfficeTabs: TabsBridge
  windowControls: WindowControlsApi
  desktop: HomeBridge & DesktopApi
  markdownApi: MarkdownApi
  slidesDesktop: SlidesDesktopApi
}

/** Read-only view of the globals the bridge owns. */
function bridgedGlobals(): Partial<BridgedGlobals> {
  // The cast is unavoidable: every app augments `Window` with its own surface.
  return window as unknown as Partial<BridgedGlobals>
}

/** Publishes the globals; `Object.assign` keeps the write typed without declaring `Window` members. */
function publishBridgeGlobals(globals: Partial<BridgedGlobals>): void {
  Object.assign(window, globals)
}

const EXTERNAL_ATTR = 'data-wails-external'

/**
 * Routes every external navigation attempt through Go so the shell can validate
 * the URL and open the system browser instead of navigating the WebView.
 */
export function installExternalLinkGuard(): void {
  window.open = (url?: string | URL): Window | null => {
    const raw = typeof url === 'string' ? url : url?.toString() ?? ''
    void shellOpenExternal(raw).catch(() => undefined)
    return null
  }

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      const isExternal = /^https?:/i.test(href) && (anchor.getAttribute('target') === '_blank' || anchor.hasAttribute(EXTERNAL_ATTR))
      if (!isExternal) return
      event.preventDefault()
      void shellOpenExternal(href).catch(() => undefined)
    },
    true,
  )
}

/**
 * Opens files dropped onto the window as tabs. Wails raises this event when
 * `EnableFileDrop` is set on the window; unsupported extensions are ignored.
 */
export function installDropOpenBridge(): void {
  const home = bridgedGlobals().aiOffice
  if (!home?.openPath) return
  try {
    on('common:WindowFilesDropped', (data) => {
      const filenames = (data as { filenames?: unknown } | null)?.filenames
      if (!Array.isArray(filenames)) return
      for (const name of filenames) {
        if (typeof name === 'string' && name) void home.openPath?.(name).catch(() => undefined)
      }
    })
  } catch {
    // The Wails runtime is absent (unit tests, plain browser): no drop events.
  }
}

/**
 * Installs the Electron-compatible globals exactly once. Called from every
 * renderer entry before React mounts.
 */
export function installBridge(): void {
  if (bridgedGlobals().aiOffice) return
  const home = createHomeApi()
  publishBridgeGlobals({
    aiOffice: home,
    desktop: {
      ...home,
      ...createDesktopApi(),
    },
    aiOfficeTabs: createTabsApi(),
    windowControls: createWindowControlsApi(),
    markdownApi: createMarkdownApi(),
    slidesDesktop: createSlidesDesktopApi(),
  })
  installExternalLinkGuard()
  installDropOpenBridge()
}
