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
  /** Home is pinned: the shell draws no close button for it. */
  closable: boolean
  active: boolean
  /** Absolute path behind the tab; empty/absent while the document is untitled. */
  filePath?: string
  dirty?: boolean
}

/**
 * The JSON shape Go's host.TabSummary marshals to (`path`, not `filePath`).
 * Kept separate from the renderer-facing TabSummary so the shell contract
 * stays the one the Electron renderers were written against.
 */
interface WireTab {
  id?: unknown
  kind?: unknown
  title?: unknown
  path?: unknown
  active?: unknown
  dirty?: unknown
  closable?: unknown
}

const TAB_KINDS = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'home'] as const

function toTabSummary(raw: WireTab): TabSummary | null {
  const id = typeof raw.id === 'string' ? raw.id : ''
  const kind = raw.kind
  if (!id || typeof kind !== 'string') return null
  if (!(TAB_KINDS as readonly string[]).includes(kind)) return null
  const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : undefined
  return {
    id,
    kind: kind as TabSummary['kind'],
    title: typeof raw.title === 'string' ? raw.title : id,
    // Go reports closable explicitly; fall back to the pinned-Home rule when an
    // older build omits it so the strip never loses its close buttons.
    closable: typeof raw.closable === 'boolean' ? raw.closable : id !== 'home',
    active: raw.active === true,
    ...(path ? { filePath: path } : {}),
    ...(raw.dirty === true ? { dirty: true } : {}),
  }
}

function toTabList(value: unknown): TabSummary[] {
  if (!Array.isArray(value)) return []
  const out: TabSummary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const summary = toTabSummary(item as WireTab)
    if (summary) out.push(summary)
  }
  return out
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
  const match = toTabList(tabs).find((tab) => tab.id === id)
  return match?.filePath ?? null
}

/**
 * Reports this renderer's unsaved-changes state to the shell tab, so the window
 * close guard can ask before quitting. No-ops outside an iframe host (dev mode).
 */
export function setCurrentTabDirty(dirty: boolean): void {
  const id = currentTabId()
  if (!id) return
  SetDirty(id, dirty).catch((err: unknown) => {
    // A lost dirty flag means the window close guard never prompts and
    // unsaved changes can quit silently. This is a data-loss channel, so
    // surface the failure instead of swallowing it.
    console.error(`[wails-bridge] SetDirty(tab=${id}, dirty=${dirty}) failed`, err)
  })
}

export interface TabsBridge {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  /** Move the tab with this id to `to` (Home stays at index 0). */
  reorder(id: string, to: number): Promise<void>
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
      return toTabList(await List())
    },
    async activate(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await Activate(id)
    },
    async close(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await Close(id)
    },
    async reorder(id, to) {
      if (typeof id !== 'string' || !id) return
      if (typeof to !== 'number') throw new Error('Invalid indices.')
      // Go reorders by position; the shell identifies the dragged tab by id
      // because the list can change mid-drag (a Cmd+W, a new tab).
      const tabs = toTabList(await List())
      const from = tabs.findIndex((tab) => tab.id === id)
      if (from < 0) return
      await Reorder(from, to)
    },
    onChanged(handler) {
      return on('tabs:changed', (data) => handler(toTabList(data)))
    },
    async setDirty(id, dirty) {
      if (typeof id !== 'string' || !id) return
      await SetDirty(id, dirty)
    },
    async dirtyTabs() {
      return toTabList(await GetDirtyTabs())
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