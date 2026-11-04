import { expect, type Frame, type FrameLocator, type Page } from '@playwright/test'

/**
 * Typed access to the running application through its own bridge.
 *
 * The real-backend suite drives the app the way a user does — a click in the
 * home page, a key chord in an editor — and only falls back to `page.evaluate`
 * for the two things a browser cannot click: the native file picker and the
 * native application menu. Everything else goes through the same Go services
 * the desktop build uses, because the host is a server build of the app.
 */

/** What `TabService.List` returns for one tab. */
export interface Tab {
  id: string
  kind: 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'
  title: string
  closable: boolean
  active: boolean
  filePath?: string
}

/** An editor tab plus its iframe, ready to be driven. */
export interface EditorHandle {
  tab: Tab
  /** Real frame — use for `evaluate` / keyboard. */
  frame: Frame
  /** Locator scoped to the frame — use for auto-waiting assertions. */
  ui: FrameLocator
}

interface AiOfficeWindow {
  aiOffice: {
    openPath(path: string): Promise<void>
    newDoc(): Promise<void>
    newSheet(): Promise<void>
    newSlide(): Promise<void>
    newMarkdown(): Promise<void>
    recents(offset?: number, limit?: number): Promise<{ entries?: { path?: string }[]; total?: number }>
  }
  aiOfficeTabs: {
    list(): Promise<Tab[]>
    close(id: string): Promise<void>
    activate(id: string): Promise<void>
  }
}

declare global {
  interface Window {
    aiOffice: AiOfficeWindow['aiOffice']
    aiOfficeTabs: AiOfficeWindow['aiOfficeTabs']
  }
}

/** Every tab the Go TabHost currently knows about, home included. */
export function listTabs(page: Page): Promise<Tab[]> {
  return page.evaluate(() => window.aiOfficeTabs.list())
}

/** Close every editor tab; the shell's home tab is not closable. */
export async function closeAllTabs(page: Page): Promise<void> {
  const tabs = await listTabs(page).catch(() => [] as Tab[])
  for (const tab of tabs) {
    if (tab.kind === 'home') continue
    await page.evaluate((id) => window.aiOfficeTabs.close(id), tab.id).catch(() => undefined)
  }
  await expect
    .poll(async () => (await listTabs(page)).filter((t) => t.kind !== 'home').length, {
      timeout: 10_000,
      message: 'editor tabs should be gone',
    })
    .toBe(0)
}

/**
 * Open a local document the way the home page does after its file picker:
 * `HomeService.OpenPath` creates a tab, which mounts the editor iframe.
 */
export async function openPath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => window.aiOffice.openPath(p), path)
}

/** Wait until exactly one editor tab is active and return it. */
export async function waitForActiveEditor(
  page: Page,
  expected?: { kind?: Tab['kind']; title?: string },
): Promise<Tab> {
  let active: Tab | undefined
  await expect
    .poll(
      async () => {
        const tabs = await listTabs(page)
        active = tabs.find((tab) => tab.active && tab.kind !== 'home')
        if (!active) return 'no active editor'
        if (expected?.kind && active.kind !== expected.kind) return `kind=${active.kind}`
        if (expected?.title && active.title !== expected.title) return `title=${active.title}`
        return 'ok'
      },
      { timeout: 20_000, message: 'an editor tab should become active' },
    )
    .toBe('ok')
  return active!
}

/**
 * Resolve the frame of an editor tab and wait for it to be attached.
 *
 * Each editor is an iframe (`/docs/index.html?tabId=…`), so this is the Wails
 * counterpart of the Electron suite's "wait for a new BrowserWindow".
 */
export async function editorFor(page: Page, tab: Tab): Promise<EditorHandle> {
  const iframe = page.locator(`iframe[data-tab-id="${tab.id}"]`)
  await expect(iframe).toBeVisible({ timeout: 20_000 })
  // `locator.contentFrame()` yields a FrameLocator (no URL, no evaluate), so the
  // real Frame comes from the element handle — that is the object a test can
  // ask for its URL and that mirrors Electron's `app.windows()`.
  const handle = await iframe.elementHandle()
  let frame: Frame | null = null
  await expect
    .poll(
      async () => {
        frame = (await handle?.contentFrame()) ?? null
        return Boolean(frame)
      },
      { timeout: 20_000, message: `iframe for ${tab.id} should expose a frame` },
    )
    .toBe(true)
  return { tab, frame: frame!, ui: page.frameLocator(`iframe[data-tab-id="${tab.id}"]`) }
}

/** Open a document and return its editor once the tab is active. */
export async function openDocument(
  page: Page,
  path: string,
  expected?: { kind?: Tab['kind']; title?: string },
): Promise<EditorHandle> {
  await openPath(page, path)
  const tab = await waitForActiveEditor(page, expected)
  return editorFor(page, tab)
}

/** Wait for the editor's own boot selector (`.doc-page`, `canvas`, …). */
export async function waitForEditorReady(editor: EditorHandle, selector: string): Promise<void> {
  await expect(editor.ui.locator(selector).first()).toBeVisible({ timeout: 30_000 })
}

/** Ctrl+S on the focused editor (the shell has no menu bar to click). */
export async function saveWithKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('Control+s')
}

/** A tab's title as the tab strip renders it (title plus the close glyph). */
export function tabStripLabel(page: Page, title: string) {
  return page.locator('.tab-item', { hasText: title })
}
