import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, nativeTheme, session } from 'electron'
import { tabStripOverlay } from './title-bar-overlay'
import { contextMenuLabels, installContextMenu, installNavigationGuard, HEADLESS_EXIT, formatHeadlessEnvelope, headlessExitCode, parseHeadlessExportArgv, setHeadlessMode, type HeadlessArgvParse, setUpdateCheckInvoker, installRendererProtocol, registerRendererScheme } from '@yiioffice/electron-utils'
import { OPEN_DOCUMENTS_FILE, clearOpenDocuments, publishOpenDocuments } from './open-documents'
import { applyPendingDir, ensureFileIndexer, shutdownFolders } from './shell-folders'
import { newSheetTab, openDocumentPath, openGeneratedDocument, registerDroppedFilesIpc } from './shell-routing'
import { applyMenuFor, installBackToHomeItems, installDockMenu } from './shell-menus'
import { registerHomeIpc } from './shell-home-ipc'
import { broadcastChromePressed, registerTabsIpc } from './shell-tabs-ipc'
import { currentLang, tm } from './shell-i18n'
import { currentTheme, currentUpdateChannel, ensureTabManager, refreshTitleBarOverlay, revealShellWindow, takeLastDockIndex, setShellWindow, setShellWindowFactory, setTabManager, shellWindow, tabManager } from './shell-state'


import { collectLaunchPaths } from './launch-paths'

import { configureDocsRuntime, recordRecentFile, replaceRecentFile, registerDocsIpc, exportDocsHeadless, setDocsMenuGate, setDocsShellHooks, setDocsHostWindowHook, setDocsShellWindow, setDocsFileSavedHook, setDocsFileOpenedHook } from '../../../docs/src/main/docs-main'
import { configureSheetsRuntime, exportSheetsPdfHeadless, markSheetsShuttingDown, pendingUnsavedNewRecoveries, setSheetsCloseTabHook, setSheetsHostWindowHook, setSheetsShellWindow, setSheetsWorkbookOpenedHook, startSheetsCaptureServer, stopSheetsSidecar } from '../../../sheets/src/main/sheets-main'
import { configureSlidesRuntime, exportSlidesPdfHeadless, setSlidesCloseTabHook, setSlidesOpenedHook, setSlidesHostWindowHook, setSlidesShellWindow, setSlidesShowBleed } from '../../../slides/src/main/slides-main'
import { configurePdfRuntime, setPdfRenamedHook, setPdfRedactionSavedHook } from '../../../pdf/src/main/pdf-main'
import { configureMarkdownRuntime, exportMarkdownPdfHeadless, setMarkdownDocxExportedHook, setMarkdownFileSavedHook } from '../../../markdown/src/main/markdown-main'


import { TABS_CHANNELS } from '../shared/tabs-api'
import { startRendererWatchdog } from './renderer-watchdog'
import { runHeadlessExport, type HeadlessExporters } from './headless-export'
import { TabManager } from './tab-manager'
import { installShellCloseGuard } from './window-close-guard'
import { detachedFilePaths, detachedSetFileFor, detachedWindowForWebContents, dockBandFor, focusedDetachedKind, setDetachedChangedListener, setDockHost } from './detached-windows'
import { checkForUpdatesNow, initAutoUpdater } from './updater'

/**
 * YiiOffice unified shell: ONE Electron app, ONE BrowserWindow, hosting the
 * docs and sheets modules as WebContentsView tabs behind a WPS-style tab
 * strip. The shell owns the lifecycle — single-instance lock, file-
 * association routing by extension, and per-active-tab menu switching.
 * Renderers load from each module's build output (apps/docs/out,
 * apps/sheets/out), so build those before running the shell.
 */

// ANY unpacked run (`npm run shell`, `npm run dev`, `npx electron .`) must not
// share the installed app's userData or single-instance lock — otherwise a dev
// run silently quits and forwards its argv to the running installed YiiOffice.
// YIIOFFICE_USER_DATA: test drivers point this at a scratch dir so an
// automated instance can run alongside the dev instance (separate lock).
if (!app.isPackaged)
  app.setPath(
    'userData',
    process.env.YIIOFFICE_USER_DATA ?? join(app.getPath('appData'), 'YiiOffice Dev'),
  )

/**
 * `--headless-export <file> --to <format> --out <path> [--json]`: one document, no
 * window, one stdout line, then exit. Parsed at module scope so the dock icon
 * is gone before the app can bounce it and so every editor module sees the
 * headless flag before it registers anything.
 */
const headlessArgv = parseHeadlessExportArgv(process.argv)
if (headlessArgv.kind !== 'none') {
  setHeadlessMode(true)
  app.dock?.hide()
}

// The product rename from "AI Office" to YiiOffice changed the userData path; migrate old user data once
if (app.isPackaged) {
  const oldDir = join(app.getPath('appData'), 'AI Office')
  const newDir = app.getPath('userData')
  const newEmpty = !existsSync(newDir) || readdirSync(newDir).length === 0
  if (newEmpty && existsSync(oldDir)) cpSync(oldDir, newDir, { recursive: true })
}

// module build outputs: packaged builds carry them as extraResources
// (resources/modules/*, resources/native/*); dev/unpacked resolves them
// relative to apps/shell in the monorepo layout.
const SIDECAR_EXE = process.platform === 'win32' ? 'xlsx-sidecar.exe' : 'xlsx-sidecar'
const APPS_ROOT = join(app.getAppPath(), '..')
const DOCS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'docs')
  : join(APPS_ROOT, 'docs', 'out')
const SHEETS_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'sheets')
  : join(APPS_ROOT, 'sheets', 'out')
const SLIDES_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'slides')
  : join(APPS_ROOT, 'slides', 'out')
const PDF_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'pdf')
  : join(APPS_ROOT, 'pdf', 'out')
const MARKDOWN_OUT = app.isPackaged
  ? join(process.resourcesPath, 'modules', 'markdown')
  : join(APPS_ROOT, 'markdown', 'out')
const SIDECAR_BIN = app.isPackaged
  ? join(process.resourcesPath, 'native', SIDECAR_EXE)
  : join(APPS_ROOT, 'sheets', 'native', 'xlsx-engine', 'target', 'release', SIDECAR_EXE)

configureDocsRuntime({
  preloadPath: join(DOCS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.DOCS_RENDERER_URL,
  rendererFile: join(DOCS_OUT, 'renderer', 'index.html'),
})
configureSheetsRuntime({
  preloadPath: join(SHEETS_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.SHEETS_RENDERER_URL,
  rendererFile: join(SHEETS_OUT, 'renderer', 'index.html'),
  sidecarPath: SIDECAR_BIN,
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
configureSlidesRuntime({
  preloadPath: join(SLIDES_OUT, 'preload', 'index.js'),
  rendererDevUrl: process.env.SLIDES_RENDERER_URL,
  rendererFilePath: join(SLIDES_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
configurePdfRuntime({
  preloadPath: join(PDF_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.PDF_RENDERER_URL,
  rendererFile: join(PDF_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
configureMarkdownRuntime({
  preloadPath: join(MARKDOWN_OUT, 'preload', 'index.js'),
  rendererUrl: process.env.MARKDOWN_RENDERER_URL,
  rendererFile: join(MARKDOWN_OUT, 'renderer', 'index.html'),
  openGeneratedPath: (path) => openGeneratedDocument(path),
})
// ---- UI language ----
// Persisted in userData/app-settings.json so the editor modules can read the
// same file when they pick up i18n later. YIIOFFICE_LANG overrides for tests.

const OPEN_DOCUMENTS_PATH = () => join(app.getPath('userData'), OPEN_DOCUMENTS_FILE)
/** only the instance holding the single-instance lock may write or remove the registry */
let ownsOpenDocumentsRegistry = false
const publishOpenDocumentsIfOwner = (paths: readonly string[]) => {
  if (ownsOpenDocumentsRegistry) publishOpenDocuments(OPEN_DOCUMENTS_PATH(), paths)
}

/** every open file: the shell's tabs plus the detached editor windows */
function publishAllOpenDocuments(): void {
  publishOpenDocumentsIfOwner([...(tabManager?.openFilePaths() ?? []), ...detachedFilePaths()])
}
setDetachedChangedListener(publishAllOpenDocuments)

// ---- the shell window + its tab manager (recreated if the user closes it on macOS) ----

function createShellWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 550,
    title: 'YiiOffice',
    // vibrancy: editor modules punch translucent regions (e.g. the slides
    // thumbnail pane) through to the desktop
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, vibrancy: 'sidebar' as const }
      : {
          // the tab strip is the title bar, as on macOS; the application menu
          // stays registered for its accelerators and opens from the strip's
          // menu button (Alt still reveals the native bar where one exists)
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: tabStripOverlay(nativeTheme.shouldUseDarkColors),
          autoHideMenuBar: true,
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  setShellWindow(win)
  nativeTheme.on('updated', refreshTitleBarOverlay)
  win.once('closed', () => nativeTheme.off('updated', refreshTitleBarOverlay))
  // dragging the window by the tab strip's blank (draggable) area produces no
  // DOM event anywhere — will-move is the only signal to dismiss popovers
  win.on('will-move', () => broadcastChromePressed())
  // A detached editor window claims the process-global menu/active-editor targets
  // while focused; take them back when the shell window regains focus. Keyboard
  // focus must land back on the active tab's view too — regaining window focus
  // gives it to the chrome webContents, leaving typing dead in the document.
  win.on('focus', () => {
    tabManager?.refreshActiveTargets()
    tabManager?.focusActiveView()
  })

  const manager = new TabManager(
    win,
    () => {
      win.webContents.send(TABS_CHANNELS.changed, manager.list())
      publishOpenDocumentsIfOwner([...manager.openFilePaths(), ...detachedFilePaths()])
    },
    applyMenuFor,
    // no extension: these tabs have no file on disk yet; the title becomes the
    // real filename (the localized untitled default + .docx etc.) once the first save lands
    (kind) =>
      kind === 'help'
        ? tm('menuUserGuide')
        : kind === 'docs'
          ? tm('untitledDoc')
          : kind === 'slides'
            ? tm('untitledDeck')
            : kind === 'markdown'
              ? tm('untitledMarkdown')
              : tm('untitledSheet'),
  )
  setTabManager(manager)

  // Docking: a detached window dragged over this window's tab strip hands its
  // document back. The strip reports the insertion slot for each preview
  // (lastDockIndex); the slot is consumed by the dock that follows.
  setDockHost({
    band: () => dockBandFor(win),
    preview: (x) => {
      if (!win.isDestroyed())
        win.webContents.send(TABS_CHANNELS.dockPreview, x === null ? null : { x })
    },
    dock: (tab) => {
      const index = takeLastDockIndex()
      if (!win.isDestroyed()) win.webContents.send(TABS_CHANNELS.dockPreview, null)
      manager.attachTab(tab, index)
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    },
  })

  // pushRecent-triggered docs menu rebuilds must not clobber the active tab's
  // menu; a focused detached docs window owns the menu just like an active tab
  setDocsMenuGate(
    () =>
      focusedDetachedKind() === 'docs' || manager.list().some((t) => t.active && t.kind === 'docs'),
  )

  setDocsShellWindow(win)
  setSheetsShellWindow(win)
  setDocsHostWindowHook((wc) => detachedWindowForWebContents(wc.id))
  setSheetsHostWindowHook((wc) => detachedWindowForWebContents(wc.id))
  setSlidesShellWindow(win)
  setSlidesHostWindowHook((wc) => detachedWindowForWebContents(wc.id))
  setSlidesShowBleed((wc, on) => manager.setContentBleed(wc, on))
  // A detached docs/sheets window can outlive the shell window; its hooks must
  // then reach the live tab manager (recreating the shell), never this closure's.
  setDocsShellHooks({
    openTab: (openPath, options) => ensureTabManager().openDocsTab(openPath, options),
    listTabs: () =>
      (tabManager?.list() ?? [])
        .filter((t) => t.kind === 'docs')
        .map((t) => ({ id: t.id, title: t.title, focused: t.active })),
    focusTab: (id) => tabManager?.activateTab(id),
    // ⌘W in a detached docs window closes that window (its own close guard runs)
    closeActiveTab: () => {
      const focused = BrowserWindow.getFocusedWindow()
      if (focused && focused !== win) focused.close()
      else tabManager?.closeActiveTab()
    },
    openGeneratedPath: (path) => openGeneratedDocument(path),
  })
  setSheetsCloseTabHook(() => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) focused.close()
    else tabManager?.closeActiveTab()
  })
  // ⌘W targets the focused window: in a detached slides editor window it closes
  // that window (running its own close guard), not the shell's active tab
  setSlidesCloseTabHook(() => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) focused.close()
    else manager.closeActiveTab()
  })
  // When ⌘O opens a file inside a tab, sync the tab title/path (used for de-dup by path) and record it as recent.
  // The first save / save-as fires this too, so applyPendingDir also runs here.
  setSheetsWorkbookOpenedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
  })
  setSlidesOpenedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingDir(wc.id, path)
  })
  // docs' save-as / silent first save lands on a new path → sync the tab title too
  setDocsFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
    return applyPendingDir(wc.id, path)
  })
  // ⌘O / open-path inside a docs tab: sync the tab title immediately, same
  // contract as the sheets/slides opened hooks (a plain save to the original
  // path never renames the tab, so the open must — r115)
  setDocsFileOpenedHook((wcId, path) => {
    manager.setTabFileFor(wcId, path)
    detachedSetFileFor(wcId, path)
    recordRecentFile(path)
    applyPendingDir(wcId, path)
  })
  // markdown untitled first save / Save As lands on a new path
  setMarkdownFileSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingDir(wc.id, path)
  })
  // A redacted copy becomes this tab's document; the source still exists.
  setPdfRedactionSavedHook((wc, path) => {
    manager.setTabFileFor(wc.id, path)
    detachedSetFileFor(wc.id, path)
    recordRecentFile(path)
    applyPendingDir(wc.id, path)
  })
  // pdf content-derived auto-rename: the file moved on disk, follow it everywhere
  setPdfRenamedHook((wc, oldPath, newPath) => {
    manager.setTabFileFor(wc.id, newPath)
    detachedSetFileFor(wc.id, newPath)
    replaceRecentFile(oldPath, newPath)
  })
  // markdown "convert & open in Docs" → route the fresh .docx to a docs tab
  setMarkdownDocxExportedHook((path) => {
    openDocumentPath(path)
  })

  // Closing the whole window walks every dirty sheets/pdf/slides/docs tab through
  // the same save/don't-save/cancel prompt; any cancel aborts the close. An
  // all-clean close is left untouched, so ⌘Q keeps quitting the app.
  installShellCloseGuard(win, manager)

  // 'closed', not 'close': the guard above cancels the close to run its save
  // prompts, and every 'close' listener still runs after preventDefault(), so
  // tearing down here would drop the tab manager while the window is alive.
  win.on('closed', () => {
    if (shellWindow === win) setShellWindow(null)
    if (tabManager === manager) {
      setTabManager(null)
      setDockHost(null)
      publishAllOpenDocuments()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// shell-state cannot import this file; hand it the window factory it needs for
// ensureTabManager (a detached editor window may outlive the shell window).
setShellWindowFactory(createShellWindow)

async function installMainProcessProxy(): Promise<void> {
  let proxyUrl = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ].find((v) => v && /^https?:\/\//.test(v))
  if (!proxyUrl) {
    try {
      // PAC/rule proxies answer per-host: probe the host the login flow, the
      // Genspark LLM proxy and the gsk CLI actually target
      const resolved = await session.defaultSession.resolveProxy('https://www.genspark.ai/')
      const m = /PROXY\s+([^;\s]+)/.exec(resolved)
      if (m) proxyUrl = `http://${m[1]}`
    } catch {
      /* no system proxy */
    }
  }
  if (!proxyUrl) return
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
    // strip user:pass credentials before logging
    console.log('[proxy] main-process fetch via', proxyUrl.replace(/\/\/[^@/]*@/, '//***@'))
  } catch (e) {
    console.warn('[proxy] failed to set ProxyAgent:', e)
  }
}

// ---- lifecycle (the shell is the only owner) ----

let pendingLaunchPaths = collectLaunchPaths(process.argv)

// show() does not un-minimize, and on macOS ⌘W destroys the shell window while the
// app keeps running — either way a file opened from Finder would land out of sight.
function openLaunchPaths(paths: readonly string[]): void {
  let opened = false
  for (const filePath of paths) opened = openDocumentPath(filePath) || opened
  if (!opened) tabManager?.openHomeTab()
}

// On macOS a file opened from Finder is not in argv; it arrives via the open-file event (before ready).
// If another instance already holds the lock, this process exits, and the path must ride along in
// the lock request's additionalData to the surviving instance — so the lock request is deferred
// until ready, after the path is known.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!app.isReady()) {
    if (!pendingLaunchPaths.includes(filePath)) pendingLaunchPaths.push(filePath)
    return
  }
  revealShellWindow()
  openLaunchPaths([filePath])
})

app.on('second-instance', (_event, argv, _cwd, additionalData) => {
  const paths = collectLaunchPaths(argv, additionalData)
  revealShellWindow()
  openLaunchPaths(paths)
})

installNavigationGuard(app)
installContextMenu(app, () => contextMenuLabels(currentLang()))
registerDocsIpc()
registerHomeIpc()

registerTabsIpc()
registerDroppedFilesIpc()

/** Dev-only pid marker for the takeover below; scoped to userData like the lock itself. */
const devPidFile = () => join(app.getPath('userData'), 'dev-instance.pid')

/** Hidden-window exporters, one per editor module (HEADLESS_TARGETS says which formats each takes). */
const headlessExporters: HeadlessExporters = {
  docs: exportDocsHeadless,
  sheets: (input, outPath) => exportSheetsPdfHeadless(input, outPath),
  slides: (input, outPath) => exportSlidesPdfHeadless(input, outPath),
  markdown: (input, outPath) => exportMarkdownPdfHeadless(input, outPath),
}

/**
 * The whole `--headless-export` run: no shell window, no menus, no updater,
 * no single-instance lock (a GUI instance may well be running). Prints
 * exactly one line and exits with the yiioffice convention (0/1/2/3).
 */
async function runHeadlessExportEntry(
  parsed: Exclude<HeadlessArgvParse, { kind: 'none' }>,
): Promise<void> {
  const outcome =
    parsed.kind === 'error'
      ? ({ ok: false, code: HEADLESS_EXIT.badArgs, message: parsed.message } as const)
      : await runHeadlessExport(parsed.request, headlessExporters)
  const json = parsed.kind === 'error' ? parsed.json : parsed.request.json
  stopSheetsSidecar()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy()
  // Writing to a pipe can finish asynchronously, and app.exit() would cut the
  // envelope off mid-line; wait for the flush (but never longer than 2s).
  const line = formatHeadlessEnvelope(outcome, json) + '\n'
  await new Promise<void>((resolve) => {
    const bail = setTimeout(resolve, 2000)
    process.stdout.write(line, () => {
      clearTimeout(bail)
      resolve()
    })
  })
  // app.quit() always exits 0; the yiioffice envelope needs the real code, and
  // every teardown this run owns has already happened.
  app.exit(headlessExitCode(outcome))
}

// Custom scheme registration must happen before app ready.
registerRendererScheme()

app.whenReady().then(async () => {
  // Electron defaults to granting every permission request (media,
  // clipboard-read, notifications, …) to whatever the page asks for. A
  // document body can embed content that triggers these; allow only what the
  // editors actually use and deny the rest.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set(['clipboard-read', 'clipboard-write', 'fullscreen', 'display-capture'])
    callback(allowed.has(permission))
  })
  // first scan waits for the windows to come up; later ones follow folder changes
  setTimeout(() => ensureFileIndexer()?.refresh(), 4000)
  installRendererProtocol({
    docs: join(DOCS_OUT, 'renderer'),
    sheets: join(SHEETS_OUT, 'renderer'),
    slides: join(SLIDES_OUT, 'renderer'),
    pdf: join(PDF_OUT, 'renderer'),
    markdown: join(MARKDOWN_OUT, 'renderer'),
    // the manual shares the shell's own renderer bundle (help mode)
    help: join(__dirname, '../renderer'),
  })
  if (headlessArgv.kind !== 'none') {
    await runHeadlessExportEntry(headlessArgv)
    return
  }
  const lockData = () =>
    pendingLaunchPaths.length > 0
      ? { launchPath: pendingLaunchPaths[0], launchPaths: pendingLaunchPaths }
      : {}
  let hasLock = app.requestSingleInstanceLock(lockData())
  if (!hasLock && !app.isPackaged) {
    // Dev watch restart: electron-vite SIGTERMs the previous instance and spawns this
    // one immediately. Chromium turns that SIGTERM into a graceful quit (Node's
    // process.on('SIGTERM') never fires in the main process), and the quit can wedge
    // in the close-confirmation flow — the zombie then keeps the single-instance lock,
    // this instance quits, and electron-vite's on-close handler exits with it, killing
    // the renderer dev server (blank shell window until a manual dev restart).
    // The previous instance is doomed either way: kill it and take over the lock.
    try {
      const oldPid = Number(readFileSync(devPidFile(), 'utf-8').trim())
      if (Number.isFinite(oldPid) && oldPid > 0 && oldPid !== process.pid) {
        // pid-recycling guard: only kill if that pid is still an Electron process
        const cmd = execSync(`ps -o command= -p ${oldPid}`).toString()
        if (cmd.includes('Electron')) process.kill(oldPid, 'SIGKILL')
      }
    } catch {
      // no previous instance recorded / already gone (ps exits non-zero)
    }
    for (let i = 0; i < 20 && !hasLock; i++) {
      await new Promise((r) => setTimeout(r, 150))
      hasLock = app.requestSingleInstanceLock(lockData())
    }
  }
  if (!hasLock) {
    app.quit()
    return
  }
  // a registry left by a crashed instance must not block yiioffice writes
  ownsOpenDocumentsRegistry = true
  publishOpenDocuments(OPEN_DOCUMENTS_PATH(), [])
  if (!app.isPackaged) {
    try {
      writeFileSync(devPidFile(), String(process.pid))
    } catch {
      // best-effort: without the marker the next restart just retries the lock
    }
  }

  void installMainProcessProxy()
  app.setAccessibilitySupportEnabled(true)
  // Settle the shared uiLang from saved settings BEFORE any tab renderer can
  // ask 'app:get-language': the editor handlers return the i18n module's
  // mutable lang, whose 'zh' default otherwise wins the race for whichever
  // tab loads first (e.g. sheets booting in Chinese while docs shows English).
  currentLang()
  // native menus/dialogs/scrollbars follow the persisted theme from first paint
  nativeTheme.themeSource = currentTheme()
    // off the startup path: a symlink / registry write nobody is waiting for
  startSheetsCaptureServer()
  createShellWindow()
  // deferred to ready: labels need currentLang(), which reads app.getLocale()
  installBackToHomeItems()
  installDockMenu()
  setUpdateCheckInvoker(() => void checkForUpdatesNow())
  initAutoUpdater(() => shellWindow, currentUpdateChannel())
  // resource watchdog: a renderer that stays hot for minutes gets diagnostics
  // recorded and the user an offer to close the document (headless exports
  // are short-lived and unattended)
  if (headlessArgv.kind === 'none') {
    startRendererWatchdog({
      describe: (wc) => tabManager?.describeWebContents(wc.id) ?? null,
      parentWindow: (wc) => BrowserWindow.fromWebContents(wc) ?? shellWindow,
      closeDocument: async (wc) => {
        const id = tabManager?.tabIdForWebContents(wc.id)
        if (id && tabManager) await tabManager.closeTab(id)
        else BrowserWindow.fromWebContents(wc)?.close()
      },
      t: (key, params) => tm(key, params),
    })
  }

  openLaunchPaths(pendingLaunchPaths)
  pendingLaunchPaths = []
  for (const recoverAs of pendingUnsavedNewRecoveries()) void newSheetTab(recoverAs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createShellWindow()
  })
}).catch((error: unknown) => {
  // An unhandled rejection here used to die silently: no window, no dialog,
  // exit code 0 — a half-started app the user can't diagnose. Log it and exit
  // non-zero so the failure is visible to scripts and crash reporters.
  console.error('[shell] startup failed:', error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  // A headless export destroys its hidden window between documents; only
  // runHeadlessExportEntry decides when that run is over.
  if (headlessArgv.kind !== 'none') return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // No close prompt may fall through to "Save" during shutdown
  markSheetsShuttingDown()
  stopSheetsSidecar()
})

// after every window has closed, so the shell window's own 'closed' republish cannot revive the file
app.on('will-quit', () => {
  shutdownFolders()
  // a second instance that lost the lock quits too; it must not delete the running editor's list
  if (ownsOpenDocumentsRegistry) clearOpenDocuments(OPEN_DOCUMENTS_PATH())
})
