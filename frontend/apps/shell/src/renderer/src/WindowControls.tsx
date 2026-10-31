import { useEffect, useState } from 'react'
import type { WindowControlsApi } from '@yiioffice/wails-bridge'
import { useI18n } from './locale'

declare global {
  interface Window {
    windowControls?: WindowControlsApi
  }
}

/**
 * Windows/Linux caption buttons.
 *
 * The shell window is frameless so the tab strip can act as the title bar
 * (Chrome's layout), which removes the system-drawn minimise / maximise /
 * close buttons. They have to be re-created here: the strip reserves their
 * space, and each press is forwarded to the Go WindowService — the same three
 * actions the native caption would perform, including the unsaved-document
 * guard on close.
 *
 * macOS keeps its traffic lights (the strip only reserves their inset), so
 * this component is mounted for non-mac platforms only.
 */
export function WindowControls() {
  const { t } = useI18n()
  const api = window.windowControls
  // The main window opens maximised, so ask once; afterwards the native
  // maximise / restore events (including drag-to-snap) keep this in sync.
  const [maximised, setMaximised] = useState(false)

  useEffect(() => {
    if (!api) return
    let alive = true
    void api
      .isMaximised()
      .then((value) => {
        if (alive) setMaximised(value)
      })
      .catch(() => undefined)
    const off = api.onMaximisedChange((value) => setMaximised(value))
    return () => {
      alive = false
      off()
    }
  }, [api])

  return (
    <div className="tab-caption-buttons">
      <button
        type="button"
        className="tab-caption-btn"
        title={t('winMinimise')}
        aria-label={t('winMinimise')}
        onClick={() => void api?.minimise().catch(() => undefined)}
      >
        {/* minimise: a single hairline, Windows 11 metrics (10px glyph) */}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className="tab-caption-btn"
        title={maximised ? t('winRestore') : t('winMaximise')}
        aria-label={maximised ? t('winRestore') : t('winMaximise')}
        onClick={() => void api?.toggleMaximise().then(setMaximised).catch(() => undefined)}
      >
        {maximised ? (
          /* restore: the front square peeking out behind the active one */
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2.5 2.5V0.5h7v7h-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="tab-caption-btn tab-caption-close"
        title={t('winClose')}
        aria-label={t('winClose')}
        onClick={() => void api?.close().catch(() => undefined)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  )
}
