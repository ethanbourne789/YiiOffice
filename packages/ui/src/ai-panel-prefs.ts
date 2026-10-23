import { useSyncExternalStore } from 'react'

/** AI panel font size preset labels */
export const AI_FONT_SIZES = ['default', 'small', 'medium', 'large'] as const

/** Base font size for AI panel zoom calculations */
export const AI_FONT_BASE_PX = 16

/** Min/max for custom AI font sizes */
export const AI_CUSTOM_FONT_MIN_PX = 12
export const AI_CUSTOM_FONT_MAX_PX = 32

/** Preset zoom levels for AI panel font sizes */
export const PRESET_ZOOM: Record<string, number> = {
  default: 1,
  small: 0.875,
  medium: 1,
  large: 1.125,
}

/** AI panel side labels per locale */
export const AI_PANEL_SIDE_LABELS: Record<string, Record<string, string>> = {
  en: { left: 'Move Left', right: 'Move Right' },
  zh: { left: '移至左侧', right: '移至右侧' },
}

/** AI panel preferences shape */
export interface AiPanelPrefs {
  side: 'left' | 'right'
  fontSize: string
  customFontSize: number
  spellcheck: boolean
  openInNewDocs: boolean
}

export const DEFAULT_AI_PANEL_PREFS: AiPanelPrefs = {
  side: 'left',
  fontSize: 'default',
  customFontSize: AI_FONT_BASE_PX,
  spellcheck: true,
  openInNewDocs: true,
}

function isAiFontSize(value: unknown): value is string {
  return typeof value === 'string' && AI_FONT_SIZES.includes(value as typeof AI_FONT_SIZES[number])
}

function clampAiCustomFontSize(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(AI_CUSTOM_FONT_MAX_PX, Math.max(AI_CUSTOM_FONT_MIN_PX, Math.round(n)))
}

export function aiPanelZoom(prefs: AiPanelPrefs): number {
  return prefs.fontSize === 'custom'
    ? prefs.customFontSize / AI_FONT_BASE_PX
    : (PRESET_ZOOM[prefs.fontSize] ?? 1)
}

function sameAiPanelPrefs(a: AiPanelPrefs, b: AiPanelPrefs): boolean {
  return (
    a.side === b.side &&
    a.fontSize === b.fontSize &&
    a.customFontSize === b.customFontSize &&
    a.spellcheck === b.spellcheck &&
    a.openInNewDocs === b.openInNewDocs
  )
}

function normalizeAiPanelPrefs(raw: unknown): AiPanelPrefs {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    side: obj.side === 'right' ? 'right' : 'left',
    fontSize: isAiFontSize(obj.fontSize) ? obj.fontSize : DEFAULT_AI_PANEL_PREFS.fontSize,
    customFontSize: clampAiCustomFontSize(obj.customFontSize) ?? DEFAULT_AI_PANEL_PREFS.customFontSize,
    spellcheck: typeof obj.spellcheck === 'boolean' ? obj.spellcheck : DEFAULT_AI_PANEL_PREFS.spellcheck,
    openInNewDocs: typeof obj.openInNewDocs === 'boolean'
      ? obj.openInNewDocs
      : DEFAULT_AI_PANEL_PREFS.openInNewDocs,
  }
}

let current = DEFAULT_AI_PANEL_PREFS
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyAiPanelPrefs(raw: unknown): void {
  const next = normalizeAiPanelPrefs(raw)
  if (sameAiPanelPrefs(next, current)) return
  current = next
  const html = document.documentElement
  html.dataset.aiPanelSide = next.side
  if (next.fontSize === 'default') {
    delete html.dataset.aiFontSize
    html.style.removeProperty('--ai-font-zoom')
  } else {
    html.dataset.aiFontSize = next.fontSize
    html.style.setProperty('--ai-font-zoom', String(aiPanelZoom(next)))
  }
  for (const listener of listeners) listener()
}

/**
 * Determine whether the AI panel should initially be open when creating a
 * new document.  Returns false when `openInNewDocs` is disabled; otherwise
 * checks the per-editor localStorage entry.
 */
export function aiPanelInitiallyOpen(storageKey: string): boolean {
  if (!current.openInNewDocs) return false
  return localStorage.getItem(storageKey) !== '0'
}

/** Persist the AI panel open/closed state for a given editor. */
export function rememberAiPanelOpen(storageKey: string, open: boolean): void {
  if (!current.openInNewDocs) return
  localStorage.setItem(storageKey, open ? '1' : '0')
}

/** React hook that re-renders when AI panel prefs change. */
export function useAiPanelPrefs(): AiPanelPrefs {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_AI_PANEL_PREFS,
  )
}

/** Width of the AI panel at a given pointer position. */
export function aiPanelWidthAtPointer(clientX: number): number {
  return current.side === 'right' ? window.innerWidth - clientX : clientX
}