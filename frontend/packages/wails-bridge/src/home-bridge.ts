import { on } from './transport'
import { isAppTheme, isUiLanguage, type AppTheme, type UiLanguage } from './types'
import {
  AddFolderRoot,
  Browse,
  CreateFolder,
  DeleteFiles,
  DeleteFolder,
  DropFolderRoots,
  DuplicateFile,
  FolderRoots,
  GetAppVersion,
  GetAutoSaveDefault,
  GetDefaultAppStatus,
  GetDefaultSaveDir,
  GetDocumentTheme,
  GetLanguage,
  GetTheme,
  ListFolder,
  MovePaths,
  NewDocument,
  NewMarkdown,
  NewPdf,
  NewSheet,
  NewSlide,
  OpenPath,
  OpenTrash,
  PickDefaultSaveDir,
  Recents,
  RemoveFolderRoot,
  RemoveRecent,
  RenameFile,
  RenameFolder,
  RevealPath,
  SearchFiles,
  SetAutoSaveDefault,
  SetDefaultApp,
  SetDocumentTheme,
  SetLanguage,
  SetStarredGroup,
  SetTheme,
  Starred,
  StarredGroups,
  StatPaths,
  ToggleStar,
  UnstarPaths,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/homeservice'
import { FileSearchQuery } from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/models'

/** A row of the home lists (mirrors host.DocumentEntry on the Go side). */
export interface RecentEntry {
  path: string
  name: string
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
  group?: string
  missing?: boolean
}

/** Paged query for the home lists. */
export interface RecentQuery {
  offset?: number
  limit?: number
  /** sidebar filter key ('docx' | 'xlsx' | 'pptx' | 'pdf' | 'md'); omit for all */
  ext?: string
  /** starred() only: restrict to one starred group */
  group?: string
}

export interface RecentPage {
  entries: RecentEntry[]
  /** rows matching the ext/group filter */
  total: number
  /** rows ignoring the filters (drives the sidebar counters) */
  totalAll: number
}

/**
 * Sidebar filter key → the extensions it stands for. Mirrors the shell's
 * FILTER_FAMILY and the Go side's resolveExtFamily: the host caps and pages the
 * list, the bridge scopes it to the family the filter pill asked for.
 */
const FILTER_FAMILY: Record<string, readonly string[]> = {
  docx: ['docx', 'doc'],
  xlsx: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'],
  pptx: ['pptx', 'ppt'],
  pdf: ['pdf'],
  md: ['md', 'markdown'],
  markdown: ['md', 'markdown'],
}

const HOME_LIST_CAP = 200

/**
 * Extensions host.RouteByExt can route to an editor. The open dialog filters to
 * the same set, so a pick outside it can only come from a hand-typed filename.
 */
const ROUTABLE_EXTS = new Set([
  'docx',
  'doc',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'tsv',
  'pptx',
  'ppt',
  'pdf',
  'md',
  'markdown',
])

function isRoutable(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return ROUTABLE_EXTS.has(path.slice(dot + 1).toLowerCase())
}

function familyOf(ext: string | undefined): readonly string[] | null {
  if (!ext || ext === 'all') return null
  return FILTER_FAMILY[ext] ?? [ext.toLowerCase()]
}

/**
 * Pages the full list the way the Electron main process did: the ext/group
 * filters and the totals are applied here because HomeService.Recents only
 * knows offset/limit.
 */
function pageOf(all: RecentEntry[], query: RecentQuery): RecentPage {
  const family = familyOf(query.ext)
  const scopedExt = family ? all.filter((e) => family.includes((e.ext || '').toLowerCase())) : all
  const grouped = query.group
    ? scopedExt.filter((e) => (e.group ?? '') === query.group)
    : scopedExt
  const offset = Math.max(0, query.offset ?? 0)
  const limit = query.limit ?? 50
  return {
    entries: limit === 0 ? [] : grouped.slice(offset, offset + limit),
    total: grouped.length,
    totalAll: all.length,
  }
}

/** Normalizes the legacy `(offset, limit)` call shape to a query object. */
function toQuery(query?: RecentQuery | number, limit?: number): RecentQuery {
  if (typeof query === 'number') return { offset: query, limit: limit ?? 50 }
  return query ?? {}
}

function asEntries(value: unknown): RecentEntry[] {
  return Array.isArray(value) ? (value as RecentEntry[]) : []
}


/** Subset of the Electron HomeApi required by the shell home screen in Phase 1. */
export interface HomeBridge {
  getAppVersion(): Promise<string>
  getTheme(): Promise<AppTheme>
  setTheme(theme: AppTheme): Promise<void>
  getLanguage(): Promise<UiLanguage>
  setLanguage(lang: UiLanguage): Promise<void>
  onThemeChanged(handler: (theme: AppTheme) => void): () => void

  // Document theme
  getDocumentTheme(): Promise<string>
  setDocumentTheme(theme: string): Promise<void>

  // Auto save default
  getAutoSaveDefault(): Promise<boolean>
  setAutoSaveDefault(enabled: boolean): Promise<void>

  // Default save dir
  getDefaultSaveDir(): Promise<string>
  pickDefaultSaveDir(): Promise<string | null>

  // Settings
  onOpenSettings(handler: () => void): () => void

  // Recent files
  recents(query?: RecentQuery | number, limit?: number): Promise<RecentPage>
  removeRecent(path: string): Promise<void>

  // Starred files
  starred(query?: RecentQuery): Promise<RecentPage>
  starredGroups(): Promise<string[]>
  setStarredGroup(path: string, group: string): Promise<void>
  toggleStar(path: string): Promise<boolean>
  unstarPaths(paths: string[]): Promise<void>
  statPaths(paths: string[]): Promise<any[]>

  // File operations
  openPath(path: string): Promise<void>
  browse(): Promise<string[]>
  revealPath(path: string): Promise<void>
  renameFile(path: string, newName: string): Promise<string>
  duplicateFile(path: string): Promise<string>
  deleteFiles(paths: string[]): Promise<string[]>
  openTrash(): Promise<void>
  newDoc(): Promise<void>
  newSheet(): Promise<void>
  newSlide(): Promise<void>
  newMarkdown(): Promise<void>
  newPdf(): Promise<void>

  // Folder operations
  folderRoots(): Promise<any[]>
  addFolderRoot(): Promise<any | null>
  dropFolderRoots(paths: string[]): Promise<any[]>
  removeFolderRoot(path: string): Promise<void>
  listFolder(path: string): Promise<any>
  pathForFile(file: File): string
  createFolder(parentPath: string, name: string): Promise<void>
  renameFolder(path: string, newName: string): Promise<void>
  movePaths(paths: string[], destDir: string): Promise<void>
  deleteFolder(path: string): Promise<void>
  onFolderChanged(handler: (data: any) => void): () => void

  // Default app
  getDefaultAppStatus(): Promise<any>
  setDefaultApp(): Promise<void>

  // File search
  searchFiles(query: { q: string; ext?: string; offset?: number; limit?: number }): Promise<any>
}

/** Wraps the official Wails V3 generated HomeService bindings behind the legacy
 *  HomeBridge surface, keeping the migration transparent to renderers. */
export function createHomeApi(): HomeBridge {
  return {
    async getAppVersion() {
      const value = await GetAppVersion()
      return typeof value === 'string' ? value : ''
    },
    async getTheme() {
      const value = await GetTheme()
      return isAppTheme(value) ? value : 'system'
    },
    async setTheme(theme) {
      if (!isAppTheme(theme)) throw new Error('Invalid theme.')
      await SetTheme(theme)
    },
    async getLanguage() {
      const value = await GetLanguage()
      return isUiLanguage(value) ? value : 'zh'
    },
    async setLanguage(lang) {
      if (!isUiLanguage(lang)) throw new Error('Invalid language.')
      await SetLanguage(lang)
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (isAppTheme(data)) handler(data)
      })
    },

    // Document theme
    async getDocumentTheme() {
      const value = await GetDocumentTheme()
      return typeof value === 'string' ? value : ''
    },
    async setDocumentTheme(theme) {
      await SetDocumentTheme(theme)
    },

    // Auto save default
    async getAutoSaveDefault() {
      return GetAutoSaveDefault()
    },
    async setAutoSaveDefault(enabled) {
      await SetAutoSaveDefault(enabled)
    },

    // Default save dir
    async getDefaultSaveDir() {
      const value = await GetDefaultSaveDir()
      return typeof value === 'string' ? value : ''
    },
    async pickDefaultSaveDir() {
      try {
        const dir = await PickDefaultSaveDir()
        return dir ? dir : null
      } catch {
        return null
      }
    },

    // Settings
    onOpenSettings(handler) {
      return on('home:open-settings', () => handler())
    },

    // Recent files
    //
    // The renderers pass the Electron-shaped query object
    // (`{offset, limit, ext}`) and expect `{entries, total, totalAll}` back.
    // HomeService.Recents only pages by offset/limit, so the filter and the
    // counters are resolved here from the full list.
    async recents(query, limit) {
      const q = toQuery(query, limit)
      const all = asEntries(await Recents(0, HOME_LIST_CAP))
      return pageOf(all, q)
    },
    async removeRecent(path) {
      await RemoveRecent(path)
    },

    // Starred files
    async starred(query) {
      const all = asEntries(await Starred())
      return pageOf(all, query ?? {})
    },
    async starredGroups() {
      const value = await StarredGroups()
      return Array.isArray(value) ? value : []
    },
    async setStarredGroup(path, group) {
      await SetStarredGroup(path, group)
    },
    async toggleStar(path) {
      return ToggleStar(path)
    },
    async unstarPaths(paths) {
      await UnstarPaths(paths)
    },
    async statPaths(paths) {
      const value = await StatPaths(paths)
      return Array.isArray(value) ? value : []
    },

    // File operations
    async openPath(path) {
      await OpenPath(path)
    },
    async browse() {
      const value = await Browse()
      const paths = Array.isArray(value)
        ? (value as unknown[]).filter((p): p is string => typeof p === 'string' && p !== '')
        : []
      // Browse() only runs the native picker; routing the picks is this
      // bridge's job (HomeApi: "file picker ... then routes"). Returning the
      // paths without opening them made the home "open local file" card look
      // dead: the dialog closed and no tab ever appeared.
      for (const path of paths) {
        if (!isRoutable(path)) continue
        try {
          await OpenPath(path)
        } catch {
          // A vanished/unreadable file must not abort the rest of the picks.
        }
      }
      return paths
    },
    async revealPath(path) {
      await RevealPath(path)
    },
    async renameFile(path, newName) {
      const value = await RenameFile(path, newName)
      return typeof value === 'string' ? value : ''
    },
    async duplicateFile(path) {
      const value = await DuplicateFile(path)
      return typeof value === 'string' ? value : ''
    },
    async deleteFiles(paths) {
      const value = await DeleteFiles(paths)
      return Array.isArray(value) ? value : []
    },
    async openTrash() {
      await OpenTrash()
    },
    async newDoc() {
      await NewDocument()
    },
    async newSheet() {
      await NewSheet()
    },
    async newSlide() {
      await NewSlide()
    },
    async newMarkdown() {
      await NewMarkdown()
    },
    async newPdf() {
      await NewPdf()
    },

    // Folder operations
    async folderRoots() {
      const value = await FolderRoots()
      return Array.isArray(value) ? value : []
    },
    async addFolderRoot() {
      try {
        return (await AddFolderRoot()) ?? null
      } catch {
        return null
      }
    },
    async dropFolderRoots(paths) {
      const value = await DropFolderRoots(paths)
      return Array.isArray(value) ? value : []
    },
    async removeFolderRoot(path) {
      await RemoveFolderRoot(path)
    },
    pathForFile(file) {
      // WebView2 does not expose OS paths on File objects: Wails delivers
      // dropped files itself through the window drop event, so the folder
      // panel's HTML5 drop path only works when the browser surfaces one.
      const candidate = (file as File & { path?: string }).path
      return typeof candidate === 'string' ? candidate : ''
    },
    async listFolder(path) {
      const value = await ListFolder(path)
      return value ?? { dir: path, folders: [], files: [], missing: true }
    },
    async createFolder(parentPath, name) {
      await CreateFolder(parentPath, name)
    },
    async renameFolder(path, newName) {
      await RenameFolder(path, newName)
    },
    async movePaths(paths, destDir) {
      await MovePaths(paths, destDir)
    },
    async deleteFolder(path) {
      await DeleteFolder(path)
    },
    onFolderChanged(handler) {
      return on('home:folder-changed', (data) => handler(data))
    },

    // Default app
    async getDefaultAppStatus() {
      return await GetDefaultAppStatus()
    },
    async setDefaultApp() {
      await SetDefaultApp()
    },

    // File search
    async searchFiles(query) {
      return await SearchFiles(new FileSearchQuery(query))
    },
  }
}