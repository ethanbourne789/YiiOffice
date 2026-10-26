/// The shell's own view of the filesystem: which folders are roots, which files
/// it is allowed to touch (recents / stars / open tabs), the recursive folder
/// watchers, the full-text index, and the "new file lands in this folder"
/// bookkeeping. Everything here is per-process state; index.ts owns the
/// lifecycle that starts and stops it.

import { existsSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { app, webContents } from 'electron'

import { isInsideRoot, pathsUnder, rebasePath, uniqueNameIn, FolderWatcher } from './folder-tree'
import { readExtraRoots } from './folder-roots'
import { readAppSettings } from './app-settings'
import { APP_SETTINGS_PATH, tabManager } from './shell-state'
import {
  defaultSaveDir,
  readRecentFiles,
  readStarredFiles,
  replaceRecentFile,
  docsFileRenamed,
} from '../../../docs/src/main/docs-main'
import {
  readSlidesRecentFiles,
  replaceSlidesRecentFile,
  slidesFileRenamed,
} from '../../../slides/src/main/slides-main'
import { sheetsFileRenamed } from '../../../sheets/src/main/sheets-main'
import { markdownFileRenamed } from '../../../markdown/src/main/markdown-main'
import { pdfFileRenamed } from '../../../pdf/src/main/pdf-main'
import {
  detachedFilePaths,
  detachedRenameFile,
} from './detached-windows'
import type { FileTargetSources } from './file-targets'
import { HOME_CHANNELS } from '../shared/home-api'
import type { FileSearchSettings, NewFileOpts } from '../shared/home-api'
import extractWorkerPath from './file-index/extract-worker?modulePath'
import { FileIndexer } from './file-index/indexer'
import { FileIndexStore } from './file-index/store'
import { normalizeFileSearchSettings, SearchReranker } from './file-index/rerank'

// ---- folder roots ----

/** folders the user added to the home tree beside the default save folder */
export function extraFolderRoots(): string[] {
  return readExtraRoots(readAppSettings(APP_SETTINGS_PATH()), defaultSaveDir())
}

export function folderRootPaths(): string[] {
  return [defaultSaveDir(), ...extraFolderRoots()]
}

export function insideAnyRoot(path: string): boolean {
  return folderRootPaths().some((root) => isInsideRoot(root, path))
}

export function isAnyRoot(path: string): boolean {
  const key = resolve(path)
  return folderRootPaths().some((root) => resolve(root) === key)
}

// ---- "new file lands here" bookkeeping ----

const pendingNewFileDir = new Map<string, { dir: string; setAt: number }>()
/** folder bound to a freshly created editor tab, keyed by its webContents id; consumed by the first save */
const pendingDirByWc = new Map<number, { dir: string; setAt: number }>()
/** a pending folder only applies to a file created within this window after the click */
const PENDING_DIR_TTL_MS = 30 * 60 * 1000

export function rememberPendingDir(kind: string, opts?: NewFileOpts): void {
  const dir = opts?.dir
  if (!dir || resolve(dir) === resolve(defaultSaveDir()) || !insideAnyRoot(dir)) {
    pendingNewFileDir.delete(kind)
    return
  }
  pendingNewFileDir.set(kind, { dir, setAt: Date.now() })
}

/** the folder remembered for this kind, consumed; null when none, expired or gone */
export function takePendingDir(kind: string): { dir: string; setAt: number } | null {
  const pending = pendingNewFileDir.get(kind)
  pendingNewFileDir.delete(kind)
  if (!pending) return null
  if (Date.now() - pending.setAt > PENDING_DIR_TTL_MS) return null
  return existsSync(pending.dir) ? pending : null
}

/** where a shell-created blank file (sheet, pdf) lands: the remembered folder, else the root */
export function newFileDir(kind: string): string {
  return takePendingDir(kind)?.dir ?? defaultSaveDir()
}

/** hand the remembered folder to the tab that was just opened for it */
export function bindPendingDir(kind: string, tabId: string | undefined): void {
  const pending = takePendingDir(kind)
  const wc = tabId ? tabManager?.webContentsForTab(tabId) : undefined
  if (pending && wc) pendingDirByWc.set(wc.id, pending)
}

/**
 * A tab's file first hit disk (silent first save, Save As, or an open): if a
 * folder is bound to that tab and the file is a fresh one in the root, move
 * it there. A pre-existing file opened in the tab never qualifies: its birth
 * time (or, where the filesystem reports none, its mtime) predates the click.
 */
export function applyPendingDir(wcId: number, filePath: string): string {
  const pending = pendingDirByWc.get(wcId)
  if (!pending) return filePath
  if (Date.now() - pending.setAt > PENDING_DIR_TTL_MS) {
    pendingDirByWc.delete(wcId)
    return filePath
  }
  if (resolve(dirname(filePath)) !== resolve(defaultSaveDir())) return filePath
  try {
    const stat = statSync(filePath)
    const born = stat.birthtimeMs || stat.mtimeMs
    if (born < pending.setAt - 2000) return filePath
  } catch {
    return filePath
  }
  pendingDirByWc.delete(wcId)
  if (!existsSync(pending.dir)) return filePath
  // a clash with an existing name takes the "(2)" suffix rather than staying in the root
  const target = join(pending.dir, uniqueNameIn(pending.dir, basename(filePath)))
  try {
    renameSync(filePath, target)
  } catch (err) {
    console.warn('[shell] move new file into folder failed:', err)
    return filePath
  }
  afterFileMoved(filePath, target)
  return target
}

/**
 * Everything that keys on a file path follows a rename/move: recents, stars,
 * the slides start-screen list and any
 * open tab (which re-grants the new path and refreshes its title).
 */
export function afterFileMoved(oldPath: string, newPath: string): void {
  replaceRecentFile(oldPath, newPath)
  if (/\.pptx$/i.test(newPath)) void replaceSlidesRecentFile(oldPath, newPath)
  const affected = tabManager?.renameTabFile(oldPath, newPath) ?? []
  const detachedAffected = detachedRenameFile(oldPath, newPath)
  if (detachedAffected) affected.push(detachedAffected)
  for (const t of affected) {
    if (t.kind === 'slides') slidesFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'docs') docsFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'sheets') sheetsFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'markdown') markdownFileRenamed(t.webContents, oldPath, newPath)
    else if (t.kind === 'pdf') pdfFileRenamed(t.webContents, oldPath, newPath)
  }
}

export function trackedFilesUnder(dir: string): string[] {
  return pathsUnder(dir, [
    ...readRecentFiles(),
    ...readStarredFiles(),
    ...readSlidesRecentFiles(),
    ...(tabManager?.openFilePaths() ?? []),
    ...detachedFilePaths(),
  ])
}

export function statMaybeFile(path: string): { isFile: () => boolean } | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

export function fileTargetSources(): FileTargetSources {
  return {
    insideAnyRoot: (p) => insideAnyRoot(p),
    trackedPaths: [
      ...readRecentFiles(),
      ...readStarredFiles(),
      ...readSlidesRecentFiles(),
      ...(tabManager?.openFilePaths() ?? []),
      ...detachedFilePaths(),
    ],
  }
}

/** a folder moved/renamed: re-key every tracked file that lived under it */
export function afterFolderMoved(oldDir: string, newDir: string, filesBefore: readonly string[]): void {
  for (const file of filesBefore) afterFileMoved(file, rebasePath(file, oldDir, newDir))
}

const folderWatchers = new Map<string, FolderWatcher>()

/** exported as a live binding: index.ts reads it, nothing outside this module assigns it */
export let fileIndexStore: FileIndexStore | null = null
/** likewise; a search / open / folder change all just call refresh() on it */
export let fileIndexer: FileIndexer | null = null
let searchReranker: SearchReranker | null = null

export function readFileSearchSettings(): FileSearchSettings {
  return normalizeFileSearchSettings(readAppSettings(APP_SETTINGS_PATH()).fileSearch)
}

/** the search index lives in userData and follows the save folder plus recents/starred */
export function ensureFileIndexer(): FileIndexer | null {
  if (fileIndexer) return fileIndexer
  try {
    fileIndexStore = new FileIndexStore(join(app.getPath('userData'), 'file-index.db'))
  } catch (e) {
    console.warn('[file-index] unavailable:', e instanceof Error ? e.message : e)
    return null
  }
  fileIndexer = new FileIndexer(fileIndexStore, extractWorkerPath, {
    roots: () => folderRootPaths().filter((root) => existsSync(root)),
    extraPaths: () => [...readRecentFiles(), ...readStarredFiles()],
  })
  return fileIndexer
}

export const SEARCH_EXT_FAMILY: Record<string, readonly string[]> = {
  docx: ['docx', 'doc'],
  xlsx: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'],
  pptx: ['pptx', 'ppt'],
  md: ['md', 'markdown', 'txt', 'json'],
}

/** one recursive watcher per tree root; follows the save-folder setting and the added folders */
export function ensureFolderWatchers(): void {
  const wanted = new Set(folderRootPaths().filter((root) => existsSync(root)))
  for (const [root, watcher] of folderWatchers) {
    if (wanted.has(root) && watcher.active) continue
    watcher.close()
    folderWatchers.delete(root)
  }
  for (const root of wanted) {
    if (folderWatchers.has(root)) continue
    const watcher = new FolderWatcher(root, (dirs) => {
      fileIndexer?.refresh()
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) wc.send(HOME_CHANNELS.folderChanged, dirs)
      }
    })
    folderWatchers.set(root, watcher)
  }
}

/** the reranker is built on the first rerank request and reused for the session */
export function ensureSearchReranker(): SearchReranker | null {
  if (!fileIndexStore) return null
  searchReranker ??= new SearchReranker(fileIndexStore)
  return searchReranker
}

/** close the index and every watcher; called once, from will-quit */
export function shutdownFolders(): void {
  fileIndexer?.stop()
  fileIndexStore?.close()
  for (const watcher of folderWatchers.values()) watcher.close()
}

/** a file the shell just opened may have changed on disk: let the index catch up */
export function refreshFileIndex(): void {
  fileIndexer?.refresh()
}
