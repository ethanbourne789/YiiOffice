import { invoke, on } from './transport'

export interface TabSummary {
  id: string
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'home'
  title: string
  active: boolean
}

export interface TabsBridge {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  reorder(from: number, to: number): Promise<void>
  onChanged(handler: (tabs: TabSummary[]) => void): () => void

  // Menu
  showMenu(): Promise<any[]>
  showNewMenu(): Promise<any[]>
  showTabMenu(tabId: string): Promise<any[]>
  showAppMenu(): Promise<any[]>

  // Detach / tear-off
  detach(id: string): Promise<void>
  tearOff(id: string): Promise<void>
}

export function createTabsApi(): TabsBridge {
  return {
    async list() {
      const value = await invoke<unknown>('tabs:list')
      return Array.isArray(value) ? (value as TabSummary[]) : []
    },
    async activate(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await invoke('tabs:activate', id)
    },
    async close(id) {
      if (typeof id !== 'string' || !id) throw new Error('Invalid tab id.')
      await invoke('tabs:close', id)
    },
    async reorder(from, to) {
      if (typeof from !== 'number' || typeof to !== 'number') throw new Error('Invalid indices.')
      await invoke('tabs:reorder', from, to)
    },
    onChanged(handler) {
      return on('tabs:changed', (data) => {
        if (Array.isArray(data)) handler(data as TabSummary[])
      })
    },

    // Menu
    async showMenu() {
      const value = await invoke<unknown>('tabs:show-menu')
      return Array.isArray(value) ? value : []
    },
    async showNewMenu() {
      const value = await invoke<unknown>('tabs:show-new-menu')
      return Array.isArray(value) ? value : []
    },
    async showTabMenu(tabId) {
      const value = await invoke<unknown>('tabs:show-tab-menu', tabId)
      return Array.isArray(value) ? value : []
    },
    async showAppMenu() {
      const value = await invoke<unknown>('tabs:show-app-menu')
      return Array.isArray(value) ? value : []
    },

    // Detach / tear-off
    async detach(id) {
      await invoke('tabs:detach', id)
    },
    async tearOff(id) {
      await invoke('tabs:tear-off', id)
    },
  }
}
