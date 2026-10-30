/** Find-in-document: the state machine and the bar it drives.

    Four states used to sit in the editor (`open` / `query` / `matches` /
    `cursor`) next to a debounced index scan, and the set the scan returns is not
    the set the user navigates: a page with an unsaved deletion is hidden on
    screen, so jumping to a hit on it scrolls to blank paper. `matches` here
    excludes those pages, and `current` is clamped into what remains -- a cursor
    left past the end because the page it pointed at was deleted lands on the
    last live hit instead of on nothing.

    The bar only reports where a jump should go; deciding what "go" means is
    geometry (scroll offset, zoom, spread layout) and stays with the caller. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { TFunc } from './i18n/locale'
import { searchInIndex } from './search'
import type { SearchIndex, SearchMatch } from './search'

/** Long enough to finish a word, short enough to feel live */
const DEBOUNCE_MS = 200

export interface PdfSearchDeps {
  /** Text index of the open document; null while none is loaded. Must be
      memoised: a new identity is what asks for a re-scan, so an inline arrow
      would re-scan on every render. */
  index: () => Promise<SearchIndex> | null
  /** Pages whose content an unsaved deletion has removed */
  hidden: ReadonlySet<number>
}

export interface PdfSearch {
  open: boolean
  query: string
  /** Navigable hits, hidden pages already removed, in document order */
  matches: SearchMatch[]
  /** Index into `matches`; always in range, 0 when there is nothing to jump to */
  current: number
  /** The field to focus when the bar opens */
  inputRef: RefObject<HTMLInputElement | null>
  setQuery: (value: string) => void
  openSearch: () => void
  close: () => void
  toggle: () => void
  step: (direction: 1 | -1) => void
  /** Drop the results but keep the bar open -- the document behind them changed */
  clear: () => void
}

export function usePdfSearch({ index, hidden }: PdfSearchDeps): PdfSearch {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [raw, setRaw] = useState<SearchMatch[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Trailing whitespace cannot match anything, so it must not restart the scan
  const needle = query.trim()

  useEffect(() => {
    if (!open || !needle) {
      // Bail out on the same reference: an empty result set is the overwhelmingly
      // common case, and re-setting it would re-render for nothing
      setRaw((prev) => (prev.length === 0 ? prev : []))
      setCursor((prev) => (prev === 0 ? prev : 0))
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void index()?.then((idx) => {
        if (cancelled) return
        setRaw(searchInIndex(idx, needle))
        setCursor(0)
      })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, needle, index])

  const matches = useMemo(() => raw.filter((m) => !hidden.has(m.pageIndex)), [raw, hidden])
  const current = Math.min(cursor, Math.max(0, matches.length - 1))

  // The bar mounts in the same render that flips `open`, so the input exists by
  // the time this effect runs. Selecting the old query is what makes ⌘F followed
  // by typing actually replace it.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  const step = (direction: 1 | -1): void => {
    const total = matches.length
    if (total === 0) return
    setCursor((position) => (Math.min(position, total - 1) + direction + total) % total)
  }

  return {
    open,
    query,
    matches,
    current,
    inputRef,
    setQuery,
    openSearch: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen((was) => !was),
    step,
    clear: () => {
      setRaw([])
      setCursor(0)
    },
  }
}

export interface SearchBarProps {
  search: PdfSearch
  t: TFunc
}

/** The find bar. Closed, it renders nothing, so the caller can mount it
    unconditionally next to the page area. */
export function SearchBar({ search, t }: SearchBarProps): ReactElement | null {
  if (!search.open) return null
  const total = search.matches.length
  const empty = total === 0
  return (
    <div className="pdf-search-bar" role="search">
      <input
        ref={search.inputRef}
        className="pdf-search-input"
        data-cmd="searchInput"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Escape is not handled here: the editor's global chain unwinds it, and
          // a second handler would cancel the same keypress twice
          if (e.key === 'Enter') search.step(e.shiftKey ? -1 : 1)
        }}
      />
      <span className="pdf-search-count" data-cmd="searchCount">
        {search.query.trim()
          ? empty
            ? t('searchNoResults')
            : t('searchCount', { current: search.current + 1, total })
          : ''}
      </span>
      <button
        className="rb-icon"
        data-cmd="searchPrev"
        data-tip={t('searchPrev')}
        aria-label={t('searchPrev')}
        disabled={empty}
        onClick={() => search.step(-1)}
      >
        ‹
      </button>
      <button
        className="rb-icon"
        data-cmd="searchNext"
        data-tip={t('searchNext')}
        aria-label={t('searchNext')}
        disabled={empty}
        onClick={() => search.step(1)}
      >
        ›
      </button>
      <button className="rb-icon" data-cmd="searchClose" onClick={search.close}>
        ×
      </button>
    </div>
  )
}
