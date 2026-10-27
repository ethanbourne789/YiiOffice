/// Process-wide shell singletons and the settings caches built on top of them.
///
/// The main process is one long-lived object graph: a single BrowserWindow, a
/// single TabManager, and the persisted preferences every menu and IPC handler
/// reads. Keeping them here (instead of in index.ts) is what lets the IPC,
/// menu, PDF-export and i18n modules be separate files without importing each
/// other — each one imports this module and nothing in it imports them back.

import { BrowserWindow, nativeTheme } from 'electron'
import type { WebContents } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'

import { tabStripOverlay } from './title-bar-overlay'

import type { AutoSaveDefault, DocTheme, UiTheme } from '../shared/home-api'
import type { TabKind } from '../shared/tabs-api'
import { readAppSettings } from './app-settings'
import {
  detachedWindowForWebContents,
  focusedDetachedTab,
  isDetachedEditorWindow,
} from './detached-windows'
import type { TabManager } from './tab-manager'

/** The one settings file the shell reads and writes; editor modules read it too. */
export const APP_SETTINGS_PATH = () => join(app.getPath('userData'), 'app-settings.json')

/**
 * The shell window. Null on macOS after ⌘W (the app keeps running and
 * re-creates it on the next open), and null for a headless export run.
 */
export let shellWindow: BrowserWindow | null = null
/** The shell's tab manager, paired 1:1 with `shellWindow`. */
export let tabManager: TabManager | null = null

export function setShellWindow(win: BrowserWindow | null): void {
  shellWindow = win
}

export function setTabManager(manager: TabManager | null): void {
  tabManager = manager
}

/**
 * index.ts installs its window factory here at startup. It is a factory rather
 * than an import so this module stays below index.ts in the dependency order:
 * every other main-process module needs `ensureTabManager`, only the entry
 * point can build a window.
 */
let createShellWindow: (() => void) | null = null

export function setShellWindowFactory(factory: () => void): void {
  createShellWindow = factory
}

/** the shell's tab manager, recreating the shell window when a detached editor outlived it */
export function ensureTabManager(): TabManager {
  if (!tabManager) createShellWindow?.()
  if (!tabManager) throw new Error('the shell window could not be created')
  return tabManager
}

/** bring the shell window to the front (or recreate it), the way a second-instance launch would */
export function revealShellWindow(): void {
  if (!shellWindow) createShellWindow?.()
  if (shellWindow?.isMinimized()) shellWindow.restore()
  shellWindow?.show()
  shellWindow?.focus()
}

// ---- settings caches: one read per launch, then memoized ----

let cachedTheme: UiTheme | null = null

export function currentTheme(): UiTheme {
  if (cachedTheme) return cachedTheme
  const saved = readAppSettings(APP_SETTINGS_PATH()).theme
  cachedTheme = saved === 'light' || saved === 'dark' ? saved : 'system'
  return cachedTheme
}

export function setCachedTheme(theme: UiTheme): void {
  cachedTheme = theme
}

let cachedDocTheme: DocTheme | null = null

export function currentDocTheme(): DocTheme {
  if (cachedDocTheme) return cachedDocTheme
  const saved = readAppSettings(APP_SETTINGS_PATH()).documentTheme
  cachedDocTheme = saved === 'light' || saved === 'dark' ? saved : 'follow'
  return cachedDocTheme
}

export function setCachedDocTheme(theme: DocTheme): void {
  cachedDocTheme = theme
}

let cachedAutoSaveDefault: AutoSaveDefault | null = null

export function currentAutoSaveDefault(): AutoSaveDefault {
  if (cachedAutoSaveDefault) return cachedAutoSaveDefault
  const saved = readAppSettings(APP_SETTINGS_PATH())
  const updatedAt = saved.autoSaveDefaultUpdatedAt
  cachedAutoSaveDefault = {
    on: saved.autoSaveDefault === true,
    updatedAt: typeof updatedAt === 'number' && updatedAt > 0 ? updatedAt : 0,
  }
  return cachedAutoSaveDefault
}

export function setCachedAutoSaveDefault(value: AutoSaveDefault): void {
  cachedAutoSaveDefault = value
}

// ---- menu-command targets ----

export interface EditorTarget {
  id: string
  webContents: WebContents
  filePath?: string
}

/**
 * Menu-command target for the editors whose menus resolve through the shell
 * (pdf / markdown): the focused detached window of that kind first, else the
 * shell's active tab of that kind.
 */
export function activeEditorTarget(
  kind: TabKind,
  fromTabs: () => EditorTarget | undefined,
): EditorTarget | undefined {
  const detachedTab = focusedDetachedTab()
  if (detachedTab?.kind === kind) return detachedTab
  return fromTabs()
}

export function activePdfTarget(): EditorTarget | undefined {
  return activeEditorTarget('pdf', () => tabManager?.activePdfTab())
}

export function activeMarkdownTarget(): EditorTarget | undefined {
  return activeEditorTarget('markdown', () => tabManager?.activeMarkdownTab())
}

/** the window a pdf command's dialogs and progress belong to: the detached
 *  editor hosting the tab when there is one, else the shell */
export function pdfHostWindow(tab: { webContents: WebContents } | undefined): BrowserWindow | null {
  if (!tab) return null
  return detachedWindowForWebContents(tab.webContents.id) ?? shellWindow
}

/** ⌘W / File > Close targets the focused window: a detached editor closes
 *  itself (its own unsaved-changes guard runs), otherwise the shell's active tab
 *  — the same rule the docs / sheets / slides close hooks follow */
export function closeFocusedEditor(): void {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && focused !== shellWindow && isDetachedEditorWindow(focused)) focused.close()
  else tabManager?.closeActiveTab()
}

/** Windows 11 title-bar colors follow the system theme; re-apply on every change */
export function refreshTitleBarOverlay(): void {
  if (process.platform === 'darwin' || !shellWindow || shellWindow.isDestroyed()) return
  shellWindow.setTitleBarOverlay(tabStripOverlay(nativeTheme.shouldUseDarkColors))
}

/** insertion slot the shell strip reported for the current dock preview */
let lastDockIndex: number | undefined

export function setLastDockIndex(index: number | undefined): void {
  lastDockIndex = index
}

/** consume the slot: the dock that follows forgets it */
export function takeLastDockIndex(): number | undefined {
  const index = lastDockIndex
  lastDockIndex = undefined
  return index
}
