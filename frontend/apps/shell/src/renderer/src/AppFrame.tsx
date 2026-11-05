import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import { installCloseSaveBridge } from './close-save'
import { ErrorBoundary } from './error-boundary'
import { Home } from './Home'
import { TabBar } from './TabBar'
import { TabFrame } from './TabFrame'
import { ToastHost } from './toast'

/** Move focus to the strip entry for `id`, if it is on screen. */
function focusStripTab(id: string): void {
  for (const item of document.querySelectorAll<HTMLElement>('.tab-item')) {
    if (item.dataset.tabId === id) {
      item.focus()
      return
    }
  }
}

export function AppFrame() {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const tabsRef = useRef<TabSummary[]>([])
  tabsRef.current = tabs

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

  // "Save" in the Go close prompt lands here: fan the request out to the dirty
  // editor frames and report back so Go can retry the quit.
  useEffect(() => installCloseSaveBridge(), [])

  const switchTab = useCallback((delta: number) => {
    const list = tabsRef.current
    if (list.length < 2) return
    const activeIndex = list.findIndex((tab) => tab.active)
    const from = activeIndex < 0 ? 0 : activeIndex
    const target = list[(from + delta + list.length) % list.length]
    if (!target) return
    void window.aiOfficeTabs.activate(target.id)
    // A chord typed while an editor has focus is forwarded from the iframe
    // (see TabFrame). Once that editor is hidden, leaving focus inside it would
    // strand the keyboard, so hand focus to the strip entry the user landed on
    // — the visible ring also tells them where the next chord will start.
    requestAnimationFrame(() => focusStripTab(target.id))
  }, [])

  /**
   * Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+PageDown / Ctrl+PageUp step forward /
   * backward. Registered on this window (shell chrome, Home) and forwarded into
   * each same-origin editor iframe by TabFrame: browsers do not bubble keydown
   * across a frame boundary, so one listener cannot cover both.
   *
   * `defaultPrevented` is the conflict guard: an editor that already consumed
   * the chord (Univer's own Ctrl+PageDown worksheet switch, say) marks it
   * handled and we leave it alone.
   */
  const handleTabShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.altKey || !event.ctrlKey) return
      switch (event.key) {
        case 'Tab':
          event.preventDefault()
          switchTab(event.shiftKey ? -1 : 1)
          break
        case 'PageDown':
          if (event.shiftKey) return
          event.preventDefault()
          switchTab(1)
          break
        case 'PageUp':
          if (event.shiftKey) return
          event.preventDefault()
          switchTab(-1)
          break
      }
    },
    [switchTab],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleTabShortcut)
    return () => window.removeEventListener('keydown', handleTabShortcut)
  }, [handleTabShortcut])

  const hasEditorTabs = tabs.some((t) => t.kind !== 'home')
  // Home is a real tab in the strip: it is only hidden while an *editor* tab is
  // the active one. Driving this off "any editor tab exists" blanked the window
  // whenever the user switched back to Home with a document still open — Home
  // was hidden, and every editor iframe was display:none.
  const homeActive = activeTabId === ''

  return (
    <ErrorBoundary>
      <div className="app-frame">
        <ToastHost />
        <TabBar />
        <div
        className="app-frame-content"
        style={{ visibility: homeActive ? 'visible' : 'hidden' }}
      >
        <Home active={homeActive} />
      </div>
      {hasEditorTabs && (
        <TabFrame
          tabs={tabs.filter((t) => t.kind !== 'home')}
          activeTabId={activeTabId}
          onShortcut={handleTabShortcut}
        />
      )}
    </div>
    </ErrorBoundary>
  )
}
