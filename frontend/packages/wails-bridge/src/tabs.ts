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
  }
}
