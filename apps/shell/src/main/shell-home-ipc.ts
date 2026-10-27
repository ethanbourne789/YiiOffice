/// The home / launcher IPC surface: recents, starred files, search, the
/// folder tree and every file action the home page can trigger. Registered
/// once at startup by index.ts.

import { handleFromShell } from './ipc-guard'
import { spawn } from 'node:child_process'
import { existsSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, shell, webContents } from 'electron'

import {
  DEFAULT_SAVE_DIR_KEY,
  isUsableSaveDir,
  showOpenDialogWithMemory,
} from '@yiioffice/electron-utils'
import { isLang, type Lang } from '@yiioffice/i18n'
import type {
  AutoSaveDefault,
  DocTheme,
  FileSearchPage,
  FileSearchQuery,
  FileSearchRerank,
  FileSearchSettings,
  FolderListing,
  FolderRoot,
  MoveConflictPolicy,
  MoveResult,
  NewFileOpts,
  RecentEntry,
  RecentPage,
  RenameResult,
  UiTheme,
} from '../shared/home-api'
import { HOME_CHANNELS } from '../shared/home-api'
import { atomicCopyFile } from './atomic-write'
import { renameStaysInApp } from './app-routing'
import { writeAppSetting, writeAppSettings } from './app-settings'
import { createDefaultAppService, execFileRunner } from './default-app'
import { handleDroppedFiles } from './dropped-files'
import { showErrorDialog } from './error-dialog'
import { isMoveSource, isUserVisibleFile } from './file-targets'
import { normalizeFileSearchSettings, probeDecision } from './file-index/rerank'
import { emptySearchPage, unavailableSearchPage } from './file-index/search-page'
import {
  FOLDER_ROOTS_KEY,
  describeExtraRoot,
  withExtraRoot,
  withoutExtraRoot,
} from './folder-roots'
import {
  createFolder,
  describeRoot,
  listFolder,
  movePathsInto,
  renameFolder,
  type FolderErrors,
} from './folder-tree'
import {
  capStatPaths,
  matchesExtFamily,
  normalizeRecentQuery,
  pageRecentPaths,
  statPathEntries,
} from './recent-files'
import { isValidRawRenameName, isSameFile } from './rename-validation'
import {
  afterFileMoved,
  afterFolderMoved,
  ensureFileIndexer,
  ensureFolderWatchers,
  ensureSearchReranker,
  extraFolderRoots,
  fileIndexer,
  fileIndexStore,
  fileIndexUnavailable,
  fileTargetSources,
  insideAnyRoot,
  isAnyRoot,
  readFileSearchSettings,  refreshFileIndex,
  rememberPendingDir,
  SEARCH_EXT_FAMILY,
  statMaybeFile,
  trackedFilesUnder,
} from './shell-folders'
import { currentLang, persistLang, tm } from './shell-i18n'
import { buildHomeMenu, installBackToHomeItems, installDockMenu } from './shell-menus'
import {
  droppedFilesDeps,
  newDocTab,
  newMarkdownTab,
  newPdfTab,
  newSheetTab,
  newSlideTab,
  openDocumentPath,
  OPEN_DIALOG_EXTENSIONS,
} from './shell-routing'
import {
  APP_SETTINGS_PATH,
  currentAutoSaveDefault,
  currentDocTheme,
  currentTheme,
  refreshTitleBarOverlay,
  setCachedAutoSaveDefault,
  setCachedDocTheme,
  setCachedTheme,
  shellWindow,
} from './shell-state'
import {
  defaultSaveDir,
  readRecentFiles,
  readStarredFiles,
  readStarredGroupMap,
  readStarredGroups,
  recordRecentFile,
  removeRecentFiles,
  removeStarredFiles,
  setStarredGroup,
  toggleStarredFile,
} from '../../../docs/src/main/docs-main'

// ---- home IPC ----

function statEntries(paths: string[]): RecentEntry[] {
  return statPathEntries(paths, new Set(readStarredFiles()))
}

function registerHomeIpc(): void {
  handleFromShell(HOME_CHANNELS.getAppVersion, (): string => app.getVersion())

  handleFromShell(HOME_CHANNELS.recents, (_event, query: unknown): RecentPage =>
    pageRecentPaths(readRecentFiles(), query, new Set(readStarredFiles())),
  )

  handleFromShell(HOME_CHANNELS.searchFiles, (_event, raw: unknown): FileSearchPage => {
    const query = (raw && typeof raw === 'object' ? raw : {}) as Partial<FileSearchQuery>
    const indexer = ensureFileIndexer()
    if (!indexer || !fileIndexStore) {
      // the index could not be opened: say so, otherwise the UI shows an empty
      // list and the user reads it as "no files match"
      const reason = fileIndexUnavailable()
      return reason ? unavailableSearchPage(reason) : emptySearchPage()
    }
    // an open search box is the moment a stale index shows; rescan at most once a minute
    indexer.refreshIfStale(60_000)
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : ''
    const filter = typeof query.ext === 'string' ? query.ext : ''
    const exts = filter && filter !== 'all' ? (SEARCH_EXT_FAMILY[filter] ?? [filter]) : undefined
    const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset!)) : 0
    const limit = Number.isFinite(query.limit) ? Math.max(0, Math.floor(query.limit!)) : 50
    const starred = new Set(readStarredFiles())
    const result = q ? fileIndexStore.search(q, { exts, offset, limit }) : { hits: [], total: 0 }
    return {
      hits: result.hits.map((h) => ({ ...h, starred: starred.has(h.path) })),
      total: result.total,
      index: indexer.progress(),
    }
  })

  handleFromShell(
    HOME_CHANNELS.rerankSearch,
    async (_event, raw: unknown): Promise<FileSearchRerank | null> => {
      const settings = readFileSearchSettings()
      if (!settings.rerank) return null
      const query = (raw && typeof raw === 'object' ? raw : {}) as { q?: unknown; paths?: unknown }
      const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : ''
      const paths = Array.isArray(query.paths)
        ? query.paths.filter((p): p is string => typeof p === 'string').slice(0, 20)
        : []
      const reranker = ensureSearchReranker()
      if (!q || paths.length < 2 || !reranker) return null
      return reranker.rerank(q, paths, settings)
    },
  )

  handleFromShell(HOME_CHANNELS.getFileSearchSettings, (): FileSearchSettings =>
    readFileSearchSettings(),
  )

  handleFromShell(
    HOME_CHANNELS.setFileSearchSettings,
    (_event, patch: unknown): FileSearchSettings => {
      const current = readFileSearchSettings()
      const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<FileSearchSettings>
      const next = normalizeFileSearchSettings({
        ...current,
        ...p,
        keys: { ...current.keys, ...(p.keys ?? {}) },
      })
      writeAppSetting(APP_SETTINGS_PATH(), 'fileSearch', next)
      return next
    },
  )

  handleFromShell(HOME_CHANNELS.testFileSearchRerank, (_event, input: unknown) =>
    probeDecision(normalizeFileSearchSettings(input)),
  )

  // Starred files sort by mtime, which requires stat-ing them all first; they are hand-picked and few, so this is fine
  handleFromShell(HOME_CHANNELS.starred, (_event, query: unknown): RecentPage => {
    const { offset, limit, ext } = normalizeRecentQuery(query)
    // the Starred view's group pills scope the whole query (totals included)
    const raw = (query && typeof query === 'object' ? query : {}) as { group?: unknown }
    const group = typeof raw.group === 'string' && raw.group ? raw.group : undefined
    const groupOf = readStarredGroupMap()
    const paths = readStarredFiles()
    const scoped = group ? paths.filter((p) => groupOf.get(p) === group) : paths
    const all = statEntries(scoped)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((entry) => {
        const g = groupOf.get(entry.path)
        return g ? { ...entry, group: g } : entry
      })
    const filtered = ext ? all.filter((entry) => matchesExtFamily(entry.ext, ext)) : all
    return {
      entries: limit === 0 ? [] : filtered.slice(offset, offset + limit),
      total: filtered.length,
      totalAll: all.length,
    }
  })

  handleFromShell(HOME_CHANNELS.starredGroups, (): string[] => readStarredGroups())

  handleFromShell(HOME_CHANNELS.setStarredGroup, (_event, paths: unknown, group: unknown) => {
    // a star is a way INTO the file actions (delete/move rename from a tracked
    // path), so it may only be set on files the shell can already see
    const allowed = stringPaths(paths).filter((p) => isUserVisibleFile(p, fileTargetSources()))
    setStarredGroup(allowed, typeof group === 'string' && group ? group : null)
  })

  handleFromShell(HOME_CHANNELS.statPaths, (_event, paths: unknown): RecentEntry[] =>
    statEntries(capStatPaths(stringPaths(paths))),
  )

  handleFromShell(HOME_CHANNELS.toggleStar, (_event, path: unknown) => {
    // same gate as deleteFiles/renameFile: starring an invisible path would
    // make it a tracked target and unlock those actions on an arbitrary file
    if (typeof path === 'string' && isUserVisibleFile(path, fileTargetSources())) {
      toggleStarredFile(path)
    }
  })

  handleFromShell(HOME_CHANNELS.openPath, (_event, path: unknown) => {
    if (typeof path !== 'string' || !path || path.length > 4096) return
    openDocumentPath(path)
    refreshFileIndex()
  })

  handleFromShell(HOME_CHANNELS.browse, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? shellWindow
    if (!win) return
    const result = await showOpenDialogWithMemory(dialog, win, {
      title: tm('dlgOpenTitle'),
      filters: [
        { name: tm('filterSupported'), extensions: OPEN_DIALOG_EXTENSIONS },
        { name: tm('filterWord'), extensions: ['docx', 'doc'] },
        { name: tm('filterExcel'), extensions: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'] },
        { name: tm('filterPpt'), extensions: ['pptx', 'ppt'] },
        { name: tm('filterPdf'), extensions: ['pdf'] },
        { name: tm('filterMarkdown'), extensions: ['md', 'markdown', 'txt', 'json'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (!result.canceled) for (const path of result.filePaths) openDocumentPath(path)
  })

  handleFromShell(HOME_CHANNELS.newDoc, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('doc', opts)
    newDocTab()
  })

  handleFromShell(HOME_CHANNELS.newSheet, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('sheet', opts)
    void newSheetTab()
  })

  handleFromShell(HOME_CHANNELS.newSlide, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('slide', opts)
    newSlideTab()
  })

  handleFromShell(HOME_CHANNELS.newMarkdown, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('markdown', opts)
    newMarkdownTab()
  })

  handleFromShell(HOME_CHANNELS.newPdf, (_event, opts?: NewFileOpts) => {
    rememberPendingDir('pdf', opts)
    void newPdfTab()
  })

  handleFromShell(HOME_CHANNELS.removeRecent, (_event, paths: unknown) => {
    const list = stringPaths(paths)
    removeRecentFiles(list)
    // an unavailable entry's star must go with it, or the Starred view keeps
    // a dead dimmed row the recents list no longer shows
    removeStarredFiles(list.filter((p) => !existsSync(p)))
  })

  // Bulk unstar from the Starred view: every row there is a favorite, so the
  // selection action is "unstar", not "remove from recents" — removeRecent
  // keeps existing files' stars on purpose, which made the Starred view's
  // bulk removal a no-op for anything still on disk
  handleFromShell(HOME_CHANNELS.unstarPaths, (_event, paths: unknown) => {
    removeStarredFiles(stringPaths(paths))
  })

  handleFromShell(HOME_CHANNELS.revealPath, (_event, path: unknown) => {
    if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
  })

  handleFromShell(
    HOME_CHANNELS.renameFile,
    (_event, path: unknown, newName: unknown): RenameResult => {
      if (typeof path !== 'string' || typeof newName !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      // Validate the raw name before trimming: trimming first would
      // silently turn "report " into "report" and make the
      // trailing-space gate in isValidRenameName unreachable. Reject
      // with the localized gate instead of renaming to a different
      // name than requested.
      if (!isValidRawRenameName(newName)) return { ok: false, error: tm('errBadName') }
      if (!renameStaysInApp(path, newName.trim()))
        return { ok: false, error: tm('errBadExtension') }
      if (!isUserVisibleFile(path, fileTargetSources()))
        return { ok: false, error: tm('errBadArgs') }
      const name = newName.trim()
      if (!existsSync(path)) return { ok: false, error: tm('errMissing') }
      const target = join(dirname(path), name)
      if (target === path) return { ok: true, path }
      // A case-only rename (Report.pdf -> report.pdf) hits the source itself on
      // case-insensitive filesystems; only a genuinely different file blocks.
      if (existsSync(target) && !isSameFile(path, target)) {
        return { ok: false, error: tm('errExists') }
      }
      try {
        renameSync(path, target)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : tm('errRenameFailed') }
      }
      afterFileMoved(path, target)
      return { ok: true, path: target }
    },
  )

  handleFromShell(HOME_CHANNELS.duplicateFile, async (_event, path: unknown) => {
    if (typeof path !== 'string' || !existsSync(path)) return
    if (!isUserVisibleFile(path, fileTargetSources())) return
    const ext = extname(path)
    const base = basename(path, ext)
    const dir = dirname(path)
    for (let i = 1; ; i++) {
      const target = join(dir, `${base} ${tm('copySuffix')}${i === 1 ? '' : ` ${i}`}${ext}`)
      if (existsSync(target)) continue
      try {
        await atomicCopyFile(path, target)
      } catch (err) {
        showErrorDialog(shellWindow, tm('errDuplicateFailed'), err)
        return
      }
      recordRecentFile(target)
      return
    }
  })

  handleFromShell(HOME_CHANNELS.deleteFiles, async (_event, paths: unknown) => {
    const targets = fileTargetSources()
    // a missing path still passes so the ghost recent/star entry gets cleaned up
    const list = stringPaths(paths).filter(
      (p) => isUserVisibleFile(p, targets) && statMaybeFile(p)?.isFile() !== false,
    )
    for (const p of list) {
      try {
        await shell.trashItem(p)
      } catch {
        // file already gone or trash unavailable; still drop it from the list
      }
    }
    removeRecentFiles(list)
    // the files were deliberately destroyed — stars must not survive as ghosts
    removeStarredFiles(list)
  })

  handleFromShell(HOME_CHANNELS.openTrash, () => {
    if (process.platform === 'darwin') {
      void shell.openPath(join(app.getPath('home'), '.Trash'))
    } else if (process.platform === 'win32') {
      spawn('explorer.exe', ['shell:RecycleBin'], { detached: true }).unref()
    } else {
      void shell.openPath(join(app.getPath('home'), '.local', 'share', 'Trash', 'files'))
    }
  })

  handleFromShell(HOME_CHANNELS.getLanguage, (): Lang => currentLang())

  handleFromShell(HOME_CHANNELS.setLanguage, (_event, lang: unknown) => {
    if (!isLang(lang) || lang === currentLang()) return
    persistLang(lang)
    // the switcher lives on the home page, so the home menu is the active one
    buildHomeMenu()
    installDockMenu()
    installBackToHomeItems()
    for (const wc of webContents.getAllWebContents()) wc.send('app:language-changed', lang)
  })

  handleFromShell(HOME_CHANNELS.getTheme, (): UiTheme => currentTheme())
  // editor tabs ask via the app-wide channel (symmetric with app:get-language)
  handleFromShell('app:get-theme', (): UiTheme => currentTheme())

  handleFromShell(HOME_CHANNELS.setTheme, (_event, theme: unknown) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return
    if (theme === currentTheme()) return
    setCachedTheme(theme)
    writeAppSetting(APP_SETTINGS_PATH(), 'theme', theme)
    nativeTheme.themeSource = theme
    refreshTitleBarOverlay()
    for (const wc of webContents.getAllWebContents()) wc.send('app:theme-changed', theme)
  })

  handleFromShell(HOME_CHANNELS.getDocumentTheme, (): DocTheme => currentDocTheme())
  // editor tabs ask via the app-wide channel (symmetric with app:get-theme)
  handleFromShell('app:get-document-theme', (): DocTheme => currentDocTheme())

  handleFromShell(HOME_CHANNELS.setDocumentTheme, (_event, theme: unknown) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'follow') return
    if (theme === currentDocTheme()) return
    setCachedDocTheme(theme)
    writeAppSetting(APP_SETTINGS_PATH(), 'documentTheme', theme)
    // the native theme is untouched — only the editors' canvas/paper follows this
    for (const wc of webContents.getAllWebContents()) wc.send('app:document-theme-changed', theme)
  })

  handleFromShell(HOME_CHANNELS.getAutoSaveDefault, (): AutoSaveDefault => currentAutoSaveDefault())
  handleFromShell('app:get-auto-save-default', (): AutoSaveDefault => currentAutoSaveDefault())

  handleFromShell(HOME_CHANNELS.setAutoSaveDefault, (_event, on: unknown) => {
    if (typeof on !== 'boolean') return
    if (on === currentAutoSaveDefault().on) return
    const next: AutoSaveDefault = { on, updatedAt: Date.now() }
    setCachedAutoSaveDefault(next)
    writeAppSettings(APP_SETTINGS_PATH(), {
      autoSaveDefault: next.on,
      autoSaveDefaultUpdatedAt: next.updatedAt,
    })
    for (const wc of webContents.getAllWebContents()) wc.send('app:auto-save-default-changed', next)
  })

  

  // effective folder where new/untitled files land; the editor mains resolve
  // the same setting themselves (configuredDefaultSaveDir via docs' defaultSaveDir)
  // ── folder tree over the default save folder ──
  const folderErrors = (): FolderErrors => ({
    badArgs: tm('errBadArgs'),
    badName: tm('errBadName'),
    missing: tm('errMissing'),
    exists: tm('errExists'),
    failed: tm('errRenameFailed'),
  })
  const insideRoot = (path: unknown): path is string =>
    typeof path === 'string' && insideAnyRoot(path)
  const isRoot = (path: string) => isAnyRoot(path)

  handleFromShell(HOME_CHANNELS.folderRoots, (): FolderRoot[] => {
    // describeRoot creates a missing save folder, so its watcher has something to attach to
    const roots = [describeRoot(defaultSaveDir()), ...extraFolderRoots().map(describeExtraRoot)]
    ensureFolderWatchers()
    return roots
  })

  // an added folder joins the tree where it is: nothing on disk is created, copied or moved
  const addFolderRoot = (path: string): FolderRoot | null => {
    const extras = withExtraRoot(extraFolderRoots(), defaultSaveDir(), path)
    if (!extras) return null
    writeAppSetting(APP_SETTINGS_PATH(), FOLDER_ROOTS_KEY, extras)
    ensureFolderWatchers()
    refreshFileIndex()
    return describeExtraRoot(path)
  }

  handleFromShell(HOME_CHANNELS.addFolderRoot, async (): Promise<FolderRoot | null> => {
    const result = await showOpenDialogWithMemory(dialog, shellWindow, {
      title: tm('dlgAddFolderRoot'),
      properties: ['openDirectory'],
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!describeExtraRoot(picked).readable) {
      showErrorDialog(shellWindow, tm('errFolderRootUnusable'), picked)
      return null
    }
    return addFolderRoot(picked)
  })

  handleFromShell(HOME_CHANNELS.dropFolderRoots, (_event, paths: unknown): FolderRoot[] => {
    const added: FolderRoot[] = []
    const files: string[] = []
    for (const path of stringPaths(paths)) {
      if (!describeExtraRoot(path).readable) {
        files.push(path)
        continue
      }
      const root = addFolderRoot(path)
      if (root) added.push(root)
    }
    if (files.length > 0) handleDroppedFiles(files, droppedFilesDeps())
    return added
  })

  handleFromShell(HOME_CHANNELS.removeFolderRoot, (_event, path: unknown) => {
    if (typeof path !== 'string') return
    const extras = withoutExtraRoot(extraFolderRoots(), path)
    writeAppSetting(APP_SETTINGS_PATH(), FOLDER_ROOTS_KEY, extras)
    ensureFolderWatchers()
    fileIndexer?.refresh()
  })

  handleFromShell(HOME_CHANNELS.listFolder, (_event, dir: unknown): FolderListing => {
    if (!insideRoot(dir)) return { dir: String(dir), folders: [], files: [] }
    return listFolder(dir, new Set(readStarredFiles()))
  })

  handleFromShell(
    HOME_CHANNELS.createFolder,
    (_event, parent: unknown, name: unknown): RenameResult => {
      if (!insideRoot(parent) || typeof name !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      return createFolder(parent, name, folderErrors())
    },
  )

  handleFromShell(
    HOME_CHANNELS.renameFolder,
    (_event, dir: unknown, newName: unknown): RenameResult => {
      if (!insideRoot(dir) || isRoot(dir) || typeof newName !== 'string')
        return { ok: false, error: tm('errBadArgs') }
      const filesBefore = trackedFilesUnder(dir)
      const result = renameFolder(dir, newName, folderErrors())
      if (result.ok && result.path && result.path !== dir) {
        afterFolderMoved(dir, result.path, filesBefore)
      }
      return result
    },
  )

  handleFromShell(
    HOME_CHANNELS.movePaths,
    async (_event, paths: unknown, targetDir: unknown, policy: unknown): Promise<MoveResult> => {
      const list = stringPaths(paths)
      if (!insideRoot(targetDir)) {
        const error = tm('errBadArgs')
        return { moved: [], conflicts: [], failed: list.map((path) => ({ path, error })) }
      }
      const conflictPolicy: MoveConflictPolicy =
        policy === 'replace' || policy === 'keepBoth' || policy === 'skip' ? policy : 'ask'
      const isDir = (p: string) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      }
      // files may come from anywhere the UI can show (the Recent list); folders only from inside the tree, never a root itself
      const moveSources = { ...fileTargetSources(), isDirectory: isDir, isAnyRoot }
      const sources = list.filter((p) => isMoveSource(p, moveSources))
      const dirFiles = new Map(sources.filter(isDir).map((p) => [p, trackedFilesUnder(p)]))
      // 'replace' must not destroy data: the displaced target goes to the trash,
      // and everything keyed on its path (recents, stars, chat history) leaves
      // with it so the incoming file does not inherit another document's record
      const displaced: string[] = []
      const result = movePathsInto(sources, targetDir, conflictPolicy, folderErrors(), {
        replaceExisting: (path) => {
          const parked = join(dirname(path), `.yiioffice-replaced-${Date.now()}-${basename(path)}`)
          const files = isDir(path) ? trackedFilesUnder(path) : [path]
          renameSync(path, parked)
          return {
            commit: () => {
              displaced.push(parked)
              removeRecentFiles(files)
              removeStarredFiles(files)
            },
            rollback: () => renameSync(parked, path),
          }
        },
      })
      for (const parked of displaced) {
        try {
          await shell.trashItem(parked)
        } catch (error) {
          // 'replace' must never destroy data: if the Recycle Bin is
          // unavailable, leave the parked copy on disk (unique
          // `.yiioffice-replaced-*` name, still recoverable) and surface the
          // failure instead of falling back to an irreversible rmSync.
          result.failed.push({
            path: parked,
            error: error instanceof Error ? error.message : tm('errReplaceTrashFailed'),
          })
        }
      }
      for (const { from, to } of result.moved) {
        const files = dirFiles.get(from)
        if (files) afterFolderMoved(from, to, files)
        else afterFileMoved(from, to)
      }
      return result
    },
  )

  handleFromShell(HOME_CHANNELS.deleteFolder, async (_event, dir: unknown) => {
    if (!insideRoot(dir) || isRoot(dir)) return
    const files = trackedFilesUnder(dir)
    try {
      await shell.trashItem(dir)
    } catch {
      return
    }
    removeRecentFiles(files)
    removeStarredFiles(files)
  })

  handleFromShell(HOME_CHANNELS.getDefaultSaveDir, (): string => defaultSaveDir())

  const defaultApp = createDefaultAppService({
    platform: process.platform,
    packaged: app.isPackaged,
    exePath: app.getPath('exe'),
    run: execFileRunner,
    openExternal: (url) => shell.openExternal(url),
  })
  handleFromShell(HOME_CHANNELS.getDefaultAppStatus, () => defaultApp.status())
  handleFromShell(HOME_CHANNELS.setDefaultApp, () => defaultApp.set())

  handleFromShell(HOME_CHANNELS.pickDefaultSaveDir, async (): Promise<string | null> => {
    const result = await showOpenDialogWithMemory(dialog, shellWindow, {
      title: tm('dlgPickSaveDir'),
      defaultPath: defaultSaveDir(),
      properties: ['openDirectory', 'createDirectory'],
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!isUsableSaveDir(picked)) {
      showErrorDialog(shellWindow, tm('errSaveDirUnusable'), picked)
      return null
    }
    writeAppSetting(APP_SETTINGS_PATH(), DEFAULT_SAVE_DIR_KEY, picked)
    ensureFolderWatchers()
    return picked
  })
}

function stringPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
}

export { registerHomeIpc }
