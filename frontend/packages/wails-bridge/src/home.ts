import { invoke, on } from './transport'
import { isAppTheme, isUiLanguage, type AppTheme, type UiLanguage } from './types'

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

  // Settings
  onOpenSettings(handler: () => void): () => void

  // Recent files
  recents(offset?: number, limit?: number): Promise<any[]>
  removeRecent(path: string): Promise<void>

  // Starred files
  starred(): Promise<any[]>
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
  addFolderRoot(path: string, label: string): Promise<void>
  dropFolderRoots(paths: string[]): Promise<void>
  removeFolderRoot(path: string): Promise<void>
  listFolder(path: string): Promise<any[]>
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

export function createHomeApi(): HomeBridge {
  return {
    async getAppVersion() {
      const value = await invoke<unknown>('home:get-app-version')
      return typeof value === 'string' ? value : ''
    },
    async getTheme() {
      const value = await invoke<unknown>('home:get-theme')
      return isAppTheme(value) ? value : 'system'
    },
    async setTheme(theme) {
      if (!isAppTheme(theme)) throw new Error('Invalid theme.')
      await invoke('home:set-theme', theme)
    },
    async getLanguage() {
      const value = await invoke<unknown>('home:get-language')
      return isUiLanguage(value) ? value : 'zh'
    },
    async setLanguage(lang) {
      if (!isUiLanguage(lang)) throw new Error('Invalid language.')
      await invoke('home:set-language', lang)
    },
    onThemeChanged(handler) {
      return on('app:theme-changed', (data) => {
        if (isAppTheme(data)) handler(data)
      })
    },

    // Document theme
    async getDocumentTheme() {
      const value = await invoke<unknown>('home:get-document-theme')
      return typeof value === 'string' ? value : ''
    },
    async setDocumentTheme(theme) {
      await invoke('home:set-document-theme', theme)
    },

    // Auto save default
    async getAutoSaveDefault() {
      const value = await invoke<unknown>('home:get-auto-save-default')
      return value === true
    },
    async setAutoSaveDefault(enabled) {
      await invoke('home:set-auto-save-default', enabled)
    },

    // Default save dir
    async getDefaultSaveDir() {
      const value = await invoke<unknown>('home:get-default-save-dir')
      return typeof value === 'string' ? value : ''
    },

    // Settings
    onOpenSettings(handler) {
      return on('home:open-settings', () => handler())
    },

    // Recent files
    async recents(offset, limit) {
      const value = await invoke<unknown>('home:recents', offset, limit)
      return Array.isArray(value) ? value : []
    },
    async removeRecent(path) {
      await invoke('home:remove-recent', path)
    },

    // Starred files
    async starred() {
      const value = await invoke<unknown>('home:starred')
      return Array.isArray(value) ? value : []
    },
    async starredGroups() {
      const value = await invoke<unknown>('home:starred-groups')
      return Array.isArray(value) ? value : []
    },
    async setStarredGroup(path, group) {
      await invoke('home:set-starred-group', path, group)
    },
    async toggleStar(path) {
      const value = await invoke<unknown>('home:toggle-star', path)
      return value === true
    },
    async unstarPaths(paths) {
      await invoke('home:unstar-paths', paths)
    },
    async statPaths(paths) {
      const value = await invoke<unknown>('home:stat-paths', paths)
      return Array.isArray(value) ? value : []
    },

    // File operations
    async openPath(path) {
      await invoke('home:open-path', path)
    },
    async browse() {
      const value = await invoke<unknown>('home:browse')
      return Array.isArray(value) ? value : []
    },
    async revealPath(path) {
      await invoke('home:reveal-path', path)
    },
    async renameFile(path, newName) {
      const value = await invoke<unknown>('home:rename-file', path, newName)
      return typeof value === 'string' ? value : ''
    },
    async duplicateFile(path) {
      const value = await invoke<unknown>('home:duplicate-file', path)
      return typeof value === 'string' ? value : ''
    },
    async deleteFiles(paths) {
      const value = await invoke<unknown>('home:delete-files', paths)
      return Array.isArray(value) ? value : []
    },
    async openTrash() {
      await invoke('home:open-trash')
    },
    async newDoc() {
      await invoke('home:new-doc')
    },
    async newSheet() {
      await invoke('home:new-sheet')
    },
    async newSlide() {
      await invoke('home:new-slide')
    },
    async newMarkdown() {
      await invoke('home:new-markdown')
    },
    async newPdf() {
      await invoke('home:new-pdf')
    },

    // Folder operations
    async folderRoots() {
      const value = await invoke<unknown>('home:folder-roots')
      return Array.isArray(value) ? value : []
    },
    async addFolderRoot(path, label) {
      await invoke('home:folder-root-add', path, label)
    },
    async dropFolderRoots(paths) {
      await invoke('home:folder-root-drop', paths)
    },
    async removeFolderRoot(path) {
      await invoke('home:folder-root-remove', path)
    },
    async listFolder(path) {
      const value = await invoke<unknown>('home:folder-list', path)
      return Array.isArray(value) ? value : []
    },
    async createFolder(parentPath, name) {
      await invoke('home:folder-create', parentPath, name)
    },
    async renameFolder(path, newName) {
      await invoke('home:folder-rename', path, newName)
    },
    async movePaths(paths, destDir) {
      await invoke('home:move-paths', paths, destDir)
    },
    async deleteFolder(path) {
      await invoke('home:folder-delete', path)
    },
    onFolderChanged(handler) {
      return on('home:folder-changed', (data) => handler(data))
    },

    // Default app
    async getDefaultAppStatus() {
      return await invoke<unknown>('home:get-default-app-status')
    },
    async setDefaultApp() {
      await invoke('home:set-default-app')
    },

    // File search
    async searchFiles(query) {
      return await invoke<unknown>('home:search-files', query)
    },
  }
}
