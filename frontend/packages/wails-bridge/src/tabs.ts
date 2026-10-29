import { invoke, on } from './transport'

export interface TabSummary {
  id: string
  kind: 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown' | 'home'
  title: string
  active: boolean
}

/** Phase 1 subset: the strip renders an empty list until Phase 2 adds the tab host. */
export interface TabsBridge {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  onChanged(handler: (tabs: TabSummary[]) => void): () => void
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
    onChanged(handler) {
      return on('tabs:changed', (data) => {
        if (Array.isArray(data)) handler(data as TabSummary[])
      })
    },
  }
}
