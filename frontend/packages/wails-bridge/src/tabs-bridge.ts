import { on } from './transport'
import {
  Activate,
  Close,
  Detach,
  Dock,
  List,
  Reorder,
  SetDirty,
  GetDirtyTabs,
  ShowAppMenu,
  ShowNewMenu,
  ShowTabMenu,
  ShowTabStripMenu,
  TearOff,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/tabservice'

export interface TabSummary {
  id: string
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'home'
  title: string
  path?: string
  active: boolean
  dirty?: boolean
}

/** Tab id the shell appended to this renderer's URL (`?tabId=...`). */
export function currentTabId(): string {
  if (typeof location === 'undefined') return ''
  return new URLSearchParams(location.search).get('tabId') ?? ''
}

/**
 * File path this renderer was opened with, or null for an untitled document.
 * Resolved through the tab host so no extra per-view state is needed.
 */
export async function currentTabPath(): Promise<string | null> {
  const id = currentTabId()
  if (!id) return null
  const tabs = await List()
  if (!Array.isArray(tabs)) return null
  const match = (tabs as TabSummary[]).find((tab) => tab.id === id)
  return match?.path && match.path.length > 0 ? match.path : null
}

/**
 * Reports this renderer's unsaved-changes state to the shell tab, so the window
 * close guard can ask before quitting. No-ops outside an iframe host (dev mode).
 */
export function setCurrentTabDirty(dirty: boolean): void {
  const id = currentTabId()
  if (!id) return
  void SetDirty(id, dirty).catch(() => undefined)
}

export interface TabsBridge {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  reorder(from: number, to: number): Promise<void>
  onChanged(handler: (tabs: TabSummary[]) => void): () => void
  /** Reports unsaved changes so the window close guard can ask before quitting. */
  setDirty(id: string, dirty: boolean): Promise<void>
  dirtyTabs(): Promise<TabSummary[]>

  // Menu
  showMenu(): Promise<any[]>
  showNewMenu(): Promise<any[]>
  showTabMenu(tabId: string): Promise<any[]>
  showAppMenu(): Promise<any[]>

  // Detach / tear-off
  detach(id: string): Promise<void>
  tearOff(id: string): Promise<void>
  dock(windowName: string): Promise<void>
}

/** Wraps the official Wails V3 generated TabService bindings behind the legacy
 *  TabsBridge surface, keeping the migration transparent to renderers. */
export function createTabsApi(): TabsBridge {
  return {
    async list() {
      const value = await List()
      return Array.isArray(value) ? (value as TabSummary[]) : []
    },
    async activate(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await Activate(id)
    },
    async close(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await Close(id)
    },
    async reorder(from, to) {
      if (typeof from !== 'number' || typeof to !== 'number') throw new Error('Invalid indices.')
      await Reorder(from, to)
    },
    onChanged(handler) {
      return on('tabs:changed', (data) => {
        if (Array.isArray(data)) handler(data as TabSummary[])
      })
    },
    async setDirty(id, dirty) {
      if (typeof id !== 'string' || !id) return
      await SetDirty(id, dirty)
    },
    async dirtyTabs() {
      const value = await GetDirtyTabs()
      return Array.isArray(value) ? (value as TabSummary[]) : []
    },

    // Menu
    async showMenu() {
      const value = await ShowTabStripMenu()
      return Array.isArray(value) ? value : []
    },
    async showNewMenu() {
      const value = await ShowNewMenu()
      return Array.isArray(value) ? value : []
    },
    async showTabMenu(tabId) {
      const value = await ShowTabMenu(tabId)
      return Array.isArray(value) ? value : []
    },
    async showAppMenu() {
      const value = await ShowAppMenu()
      return Array.isArray(value) ? value : []
    },

    // Detach / tear-off
    async detach(id) {
      await Detach(id)
    },
    async tearOff(id) {
      await TearOff(id)
    },
    async dock(windowName) {
      await Dock(windowName)
    },
  }
}