import { test as base } from '@playwright/test'

/**
 * Custom Playwright fixture that injects Wails bridge mocks into every
 * browser context before any page script runs.
 *
 * Without this, the app's main.tsx calls window.aiOffice.getLanguage() and
 * .getTheme() which go through generated Wails bindings ($Call.ByID). These
 * hang forever in a plain browser because there's no Go backend.
 *
 * By pre-setting window.aiOffice before the page loads, installBridge() in
 * wails-bridge/index.ts returns early on its first line:
 *   "if (window.aiOffice) return"
 */
export const test = base.extend<{
  userDataDir: string
}>({
  // Inject mocks into the context before ANY page load
  context: async ({ context }, use) => {
    // Pre-set window.aiOffice so installBridge() returns early and the app
    // renders instead of hanging on $Call.ByID binding calls.
    await context.addInitScript(() => {
      /* ---- aiOffice (HomeBridge) ---- */
      ;(window as any).aiOffice = {
        getAppVersion: () => Promise.resolve('0.13.0-e2e'),
        getTheme: () => Promise.resolve('light'),
        setTheme: () => Promise.resolve(),
        getLanguage: () => Promise.resolve('en'),
        setLanguage: () => Promise.resolve(),
        getDocumentTheme: () => Promise.resolve('light'),
        setDocumentTheme: () => Promise.resolve(),
        getAutoSaveDefault: () => Promise.resolve(true),
        setAutoSaveDefault: () => Promise.resolve(),
        getDefaultSaveDir: () => Promise.resolve('/tmp'),
        pickDefaultSaveDir: () => Promise.resolve(null),
        onThemeChanged: (h: () => void) => { void h; return () => {} },
        onOpenSettings: (h: () => void) => { void h; return () => {} },
        onFolderChanged: (h: () => void) => { void h; return () => {} },
        // Recents / starred
        recents: () => Promise.resolve([]),
        removeRecent: () => Promise.resolve(),
        starred: () => Promise.resolve([]),
        starredGroups: () => Promise.resolve([]),
        setStarredGroup: () => Promise.resolve(),
        toggleStar: () => Promise.resolve(false),
        unstarPaths: () => Promise.resolve(),
        statPaths: () => Promise.resolve([]),
        // File ops
        openPath: () => Promise.resolve(),
        browse: () => Promise.resolve([]),
        revealPath: () => Promise.resolve(),
        renameFile: (_p: string, n: string) => Promise.resolve(n),
        duplicateFile: () => Promise.resolve(''),
        deleteFiles: () => Promise.resolve([]),
        openTrash: () => Promise.resolve(),
        newDoc: () => Promise.resolve(),
        newSheet: () => Promise.resolve(),
        newSlide: () => Promise.resolve(),
        newMarkdown: () => Promise.resolve(),
        newPdf: () => Promise.resolve(),
        // Folder ops
        folderRoots: () => Promise.resolve([]),
        addFolderRoot: () => Promise.resolve(null),
        dropFolderRoots: () => Promise.resolve([]),
        removeFolderRoot: () => Promise.resolve(),
        listFolder: () => Promise.resolve({ dir: '', folders: [], files: [], missing: true }),
        pathForFile: (f: File) => (f as any).path || '',
        createFolder: () => Promise.resolve(),
        renameFolder: () => Promise.resolve(),
        movePaths: () => Promise.resolve(),
        deleteFolder: () => Promise.resolve(),
        // Default app
        getDefaultAppStatus: () => Promise.resolve({}),
        setDefaultApp: () => Promise.resolve(),
        // Search
        searchFiles: () => Promise.resolve({ total: 0, files: [], folders: [] }),
      }

      /* ---- aiOfficeTabs (TabsBridge) ---- */
      ;(window as any).aiOfficeTabs = {
        list: () => Promise.resolve([]),
        activate: () => Promise.resolve(),
        close: () => Promise.resolve(),
        reorder: () => Promise.resolve(),
        onChanged: (h: () => void) => { void h; return () => {} },
        setDirty: () => Promise.resolve(),
        dirtyTabs: () => Promise.resolve([]),
        showMenu: () => Promise.resolve([]),
        showNewMenu: () => Promise.resolve([]),
        showTabMenu: () => Promise.resolve([]),
        showAppMenu: () => Promise.resolve([]),
        detach: () => Promise.resolve(),
        tearOff: () => Promise.resolve(),
        dock: () => Promise.resolve(),
      }

      /* ---- desktop ---- */
      ;(window as any).desktop = {
        ...(window as any).aiOffice,
        exportPdfFile: () => Promise.resolve(),
        exportHtmlFile: () => Promise.resolve(),
        renderPdfBase64: () => Promise.resolve(''),
        pickSavePath: () => Promise.resolve(null),
        listPrinters: () => Promise.resolve([]),
      }

      /* ---- markdownApi ---- */
      ;(window as any).markdownApi = {
        exportPdfFile: () => Promise.resolve(),
        exportHtmlFile: () => Promise.resolve(),
        pickSavePath: () => Promise.resolve(null),
      }

      /* ---- slidesDesktop ---- */
      ;(window as any).slidesDesktop = {
        exportPdfFile: () => Promise.resolve(),
        exportHtmlFile: () => Promise.resolve(),
        pickSavePath: () => Promise.resolve(null),
        listPrinters: () => Promise.resolve([]),
      }

      /* ---- desktopApi (legacy compat) ---- */
      ;(window as any).desktopApi = {}

      /* ---- pdfApi (legacy compat) ---- */
      ;(window as any).pdfApi = {}
    })

    await use(context)
  },

  userDataDir: async ({}, use) => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-'))
    await use(dir)
    // cleanup
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  },
})

export { expect } from '@playwright/test'
