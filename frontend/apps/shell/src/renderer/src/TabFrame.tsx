import { useEffect, useRef, useState } from 'react'
import type { TabSummary } from '../../shared/tabs-api'
import { ErrorBoundary } from './error-boundary'
import { useI18n } from './locale'

const APP_URLS: Record<string, string> = {
  docs: '/docs/index.html',
  sheets: '/sheets/index.html',
  slides: '/slides/index.html',
  pdf: '/pdf/index.html',
  markdown: '/markdown/index.html',
}

export function TabFrame({
  tabs,
  activeTabId,
  onShortcut,
}: {
  tabs: TabSummary[]
  activeTabId: string
  /** shell-wide tab chords, forwarded into every editor frame's window */
  onShortcut: (event: KeyboardEvent) => void
}) {
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
      {/* Closing a tab removes it from the host list, so its entry disappears
          here and React unmounts the iframe — that is what tears the editor
          runtime down. Switching tabs never removes the entry; it only flips
          `visible`, i.e. display:none. Keep the two paths separate. */}
      {tabs.map((tab) => (
        <ErrorBoundary key={tab.id}>
          <EditorIframe tab={tab} visible={tab.id === activeId} onShortcut={onShortcut} />
        </ErrorBoundary>
      ))}
    </div>
  )
}

function EditorIframe({
  tab,
  visible,
  onShortcut,
}: {
  tab: TabSummary
  visible: boolean
  onShortcut: (event: KeyboardEvent) => void
}) {
  const { t } = useI18n()
  const base = APP_URLS[tab.kind] || ''
  // The renderer reports unsaved changes back to this tab id (dirty flag + close guard).
  const src = base ? `${base}?tabId=${encodeURIComponent(tab.id)}` : ''
  const frameRef = useRef<HTMLIFrameElement>(null)
  const detachShortcutRef = useRef<(() => void) | null>(null)
  // keep the forwarded listener pointed at the latest handler without
  // re-registering on every tab-list broadcast
  const shortcutRef = useRef(onShortcut)
  shortcutRef.current = onShortcut

  useEffect(
    () => () => {
      detachShortcutRef.current?.()
      detachShortcutRef.current = null
    },
    [],
  )

  // Keydown does not bubble across a frame boundary: a chord pressed while an
  // editor has focus is only visible inside that frame. The frames are
  // same-origin, so the shell can register the same handler on each frame's
  // window; it runs in the bubble phase, after the editor's own handlers, so
  // anything an editor consumed (`defaultPrevented`) is left to the editor.
  const handleLoad = (): void => {
    detachShortcutRef.current?.()
    detachShortcutRef.current = null
    const frame = frameRef.current
    const win = frame?.contentWindow
    if (!win) return
    const listener = (event: KeyboardEvent): void => shortcutRef.current(event)
    win.addEventListener('keydown', listener)
    detachShortcutRef.current = () => {
      detachShortcutRef.current = null
      try {
        win.removeEventListener('keydown', listener)
      } catch {
        // the frame's window may be gone already (navigation / teardown)
      }
    }
  }

  return (
    <iframe
      ref={frameRef}
      // readable and unique: two untitled documents (or the same file opened
      // twice) would otherwise hand assistive tech identical frame names
      title={`${tab.title.trim() || t('untitledDocument')} (${tab.id})`}
      // E2E selectors key on the stable tab id rather than the display title
      data-tab-id={tab.id}
      src={src}
      onLoad={handleLoad}
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
