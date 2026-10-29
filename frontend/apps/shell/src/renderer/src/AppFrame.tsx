import { useEffect, useState } from 'react'
import type { TabSummary } from '../shared/tabs-api'
import { Home } from './Home'
import { TabBar } from './TabBar'
import { TabFrame } from './TabFrame'

export function AppFrame() {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [activeTabId, setActiveTabId] = useState('')

  useEffect(() => {
    const applyTabs = (list: TabSummary[]) => {
      setTabs(list)
      const active = list.find((t) => t.active)
      if (active && active.kind !== 'home') {
        setActiveTabId(active.id)
      } else {
        setActiveTabId('')
      }
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  const hasEditorTabs = tabs.some((t) => t.kind !== 'home')
  const homeActive = !hasEditorTabs

  return (
    <div className="app-frame">
      <TabBar />
      <div
        className="app-frame-content"
        style={{ visibility: homeActive ? 'visible' : 'hidden' }}
      >
        <Home />
      </div>
      {hasEditorTabs && (
        <TabFrame
          tabs={tabs.filter((t) => t.kind !== 'home')}
          activeTabId={activeTabId}
        />
      )}
    </div>
  )
}
