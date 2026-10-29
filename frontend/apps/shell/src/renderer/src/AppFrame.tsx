import { useEffect, useState } from 'react'
import { Home } from './Home'
import { TabBar } from './TabBar'

function TabHostSpike() {
  return (
    <iframe
      title="docs-spike"
      src="/docs/index.html"
      style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
    />
  )
}

export function AppFrame() {
  const spike = new URLSearchParams(window.location.search).get('spike') === '1'

  const [homeActive, setHomeActive] = useState(true)

  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])

  if (spike) {
    return <TabHostSpike />
  }

  return (
    <div className="app-frame">
      <TabBar />
      {/* docs/sheets tabs render as WebContentsView children of this window, positioned
       * by the main process to cover this area — only Home paints its own content here. */}
      <div className="app-frame-content" style={{ visibility: homeActive ? 'visible' : 'hidden' }}>
        <Home />
      </div>
    </div>
  )
}
