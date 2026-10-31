import { test as base } from '@playwright/test'

/**
 * Custom Playwright fixture for YiiOffice E2E tests.
 *
 * E2E runs against the shell Vite dev server (port 5178). The generated
 * bindings are present (from `wails3 generate bindings`) but there is no
 * Go backend. This fixture injects minimal startup stubs so the app
 * initialises without hanging — `getLanguage()`, `getTheme()`, and
 * `onThemeChanged()` — while leaving all other bridge calls as real
 * generated bindings that will resolve/reject naturally.
 *
 * For a full real-backend E2E (wails3 dev server, port 9245) see the
 * official guide: https://v3.wails.io/guides/e2e-testing/
 */
export const test = base.extend<{
  userDataDir: string
}>({
  // Inject minimal startup stubs before any page script runs.
  page: async ({ page, context }, use) => {
    await context.addInitScript(() => {
      // Minimal bridge so the shell bootstraps without hanging.
      // These are the exact calls in main.tsx that block first paint.
      const stubs = {
        getLanguage: async () => {
          const lang = (window as any).__E2E_ENV?.YIIOFFICE_LANG ?? 'en'
          if (lang.startsWith('zh-')) return 'zh'
          return lang || 'en'
        },
        getTheme: async () => 'light',
        setTheme: async () => {},
        onThemeChanged: () => () => {},
        getDocumentTheme: async () => 'light',
        setDocumentTheme: async () => {},
        getAutoSaveDefault: async () => true,
        setAutoSaveDefault: async () => {},
        getDefaultSaveDir: async () => '/tmp',
        pickDefaultSaveDir: async () => null,
        setLanguage: async () => {},
        onOpenSettings: () => () => {},
        onFolderChanged: () => () => {},
      }

      // Recents / starred — empty but properly shaped
      const emptyList = { entries: [], total: 0, totalAll: 0 }
      Object.assign(stubs, {
        recents: async () => ({ ...emptyList }),
        starred: async () => ({ ...emptyList }),
      })

      // File ops — no-op resolutions
      const noop = async () => {}
      Object.assign(stubs, {
        openPath: noop,
        browse: noop,
        revealPath: noop,
        renameFile: noop,
        duplicateFile: noop,
        deleteFiles: noop,
        openTrash: noop,
        newDoc: async () => '',
        newSheet: async () => '',
        newSlide: async () => '',
        newMarkdown: async () => '',
        newPdf: async () => '',
      })

      // Folder ops
      Object.assign(stubs, {
        folderRoots: async () => [],
        addFolderRoot: noop,
        dropFolderRoots: () => [],
        removeFolderRoot: noop,
        listFolder: async () => [],
        pathForFile: async () => null,
        createFolder: noop,
        renameFolder: noop,
        movePaths: noop,
        deleteFolder: noop,
      })

      // Search
      Object.assign(stubs, {
        searchFiles: async () => ({ total: 0, files: [], folders: [] }),
      })

      // Default app
      Object.assign(stubs, {
        getDefaultAppStatus: async () => ({}),
        setDefaultApp: noop,
      })

      ;(window as any).aiOffice = stubs

      // Tabs bridge — list returns empty, everything else is a noop
      ;(window as any).aiOfficeTabs = {
        list: async () => [],
        activate: noop,
        close: noop,
        reorder: noop,
        onChanged: () => () => {},
        setDirty: noop,
        dirtyTabs: async () => [],
        showMenu: noop,
        showNewMenu: noop,
        showTabMenu: noop,
        showAppMenu: noop,
        detach: noop,
        tearOff: noop,
        dock: noop,
      }

      // Window controls
      ;(window as any).windowControls = {
        minimise: noop,
        toggleMaximise: async () => false,
        isMaximised: async () => false,
        close: noop,
        onMaximisedChange: () => () => {},
      }

      // Desktop bridge (extends aiOffice)
      ;(window as any).desktop = {
        ...stubs,
        exportPdfFile: async () => '',
        exportHtmlFile: async () => '',
        renderPdfBase64: async () => '',
        pickSavePath: async () => null,
        listPrinters: async () => [],
      }

      // Markdown / slides / legacy APIs
      ;(window as any).markdownApi = {
        exportPdfFile: async () => '',
        exportHtmlFile: async () => '',
        pickSavePath: async () => null,
      }
      ;(window as any).slidesDesktop = {
        exportPdfFile: async () => '',
        exportHtmlFile: async () => '',
        pickSavePath: async () => null,
        listPrinters: async () => [],
      }
      ;(window as any).desktopApi = {}
      ;(window as any).pdfApi = {}
    })

    await use(page)
  },

  // Per-test temporary user-data directory with automatic cleanup.
  userDataDir: async ({}, use) => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-'))
    await use(dir)
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  },
})

export { expect } from '@playwright/test'
