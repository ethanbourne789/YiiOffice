import { useEffect, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import { ErrorBoundary } from './error-boundary'

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

  // While the home tab is active every editor iframe is display:none, but this
  // wrapper still spans the content area and sits above <Home> in DOM order, so
  // it swallowed every click: after opening one document, the home page looked
  // right and was completely inert. Let clicks through when no editor is active.
  const editorActive = tabs.some((tab) => tab.id === activeId)

  return (
    // top: 40px — the strip doubles as the title bar; a full-bleed frame would
    // hide each editor's own ribbon behind it.
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 40,
        bottom: 0,
        pointerEvents: editorActive ? 'auto' : 'none',
      }}
    >
      {tabs.map((tab) => (
        <ErrorBoundary key={tab.id}>
          <EditorIframe
            tab={tab}
            visible={tab.id === activeId}
          />
        </ErrorBoundary>
      ))}
    </div>
  )
}

function EditorIframe({ tab, visible }: { tab: TabSummary; visible: boolean }) {
  const base = APP_URLS[tab.kind] || ''
  // The renderer reports unsaved changes back to this tab id (dirty flag + close guard).
  const src = base ? `${base}?tabId=${encodeURIComponent(tab.id)}` : ''

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
