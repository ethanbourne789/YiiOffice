import { useEffect, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'

const APP_URLS: Record<string, string> = {
  docs: '/docs/index.html',
  sheets: '/sheets/index.html',
  slides: '/slides/index.html',
  pdf: '/pdf/index.html',
  markdown: '/markdown/index.html',
}

export function TabFrame({ tabs, activeTabId }: { tabs: TabSummary[]; activeTabId: string }) {
  const [activeId, setActiveId] = useState(activeTabId)

  useEffect(() => {
    setActiveId(activeTabId)
  }, [activeTabId])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {tabs.map((tab) => (
        <EditorIframe
          key={tab.id}
          tab={tab}
          visible={tab.id === activeId}
        />
      ))}
    </div>
  )
}

function EditorIframe({ tab, visible }: { tab: TabSummary; visible: boolean }) {
  const src = APP_URLS[tab.kind] || ''

  return (
    <iframe
      title={tab.id}
      src={src}
      style={{
        position: 'absolute',
        inset: 0,
        border: 'none',
        width: '100%',
        height: '100%',
        display: visible ? 'block' : 'none',
      }}
    />
  )
}
