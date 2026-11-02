export type TabKind = 'home' | 'docs' | 'sheets' | 'slides' | 'pdf' | 'markdown'

/** a tab that holds a document — every kind except the Home screen */
export type DocumentTabKind = Exclude<TabKind, 'home'>

/** one open tab in the top tab strip; Home is always id 'home' and not closable */
export interface TabSummary {
  id: string
  kind: TabKind
  title: string
  closable: boolean
  active: boolean
  /** absolute path behind the tab; absent while the document is untitled */
  filePath?: string
  dirty?: boolean
}

/**
 * One document open in an editor tab, as reported to the `open_documents`
 * tool. Unlike `TabSummary` this excludes Home and chrome-free Present tabs (no
 * file, nothing an agent could read or close) and carries the unsaved-changes
 * state, which the shell resolves per family.
 */
export interface OpenDocumentTab {
  id: string
  kind: DocumentTabKind
  title: string
  filePath?: string
  active: boolean
  dirty: boolean
}

export interface TabsApi {
  list(): Promise<TabSummary[]>
  activate(id: string): Promise<void>
  close(id: string): Promise<void>
  /**
   * @deprecated The strip draws its menus itself now (TabBar's MenuPopover):
   * the editors are same-origin iframes, so a DOM menu stacks above them and
   * the "native popup at (x, y)" contract the Electron shell needed is gone.
   * The Wails bridge cannot pop a native menu at a point either, so calling
   * these was a no-op — keep them only for API compatibility.
   */
  showMenu(x: number, y: number): Promise<void>
  /** @deprecated see showMenu — use the strip's own new-document menu. */
  showNewMenu(x: number, y: number): Promise<void>
  /** @deprecated see showMenu — use the strip's own tab context menu. */
  showTabMenu(id: string, x: number, y: number): Promise<void>
  /** detach a document tab into its own window ("Open in New Window") */
  detach(id: string): Promise<void>
  /**
   * Tear a tab off mid-drag: the tab leaves the strip and its live view lands
   * in a new window placed so that (screenX, screenY) — the pointer — sits in
   * the window's title bar. The window is shown without taking focus so the
   * shell keeps receiving the held pointer's moves. False when the tab cannot
   * be torn off (Home, Present tabs, a tab mid close-prompt).
   */
  tearOff(id: string, screenX: number, screenY: number): Promise<boolean>
  /** move the torn-off window to follow the still-held pointer */
  dragTornWindow(screenX: number, screenY: number): void
  /**
   * the held pointer came back over the strip: put the torn-off tab back at
   * `index` (Home stays pinned at 0) and end the tear-off
   */
  dockTornWindow(index: number): Promise<void>
  /** the pointer was released: the torn-off window becomes a normal detached window */
  endTornDrag(): Promise<void>
  /**
   * A detached window is being dragged natively over the strip (or left it:
   * null). `x` is in window CSS coordinates; the strip draws an insertion
   * indicator there and answers with reportDockIndex.
   */
  onDockPreview(handler: (preview: { x: number } | null) => void): () => void
  /** the insertion slot the strip computed for the last dock preview */
  reportDockIndex(index: number): void
  /**
   * @deprecated see showMenu — the ☰ button opens the strip's own menu now.
   * Windows and Linux hide the native menu bar under the tab strip; macOS
   * keeps the system menu bar and never shows the button.
   */
  showAppMenu(x: number, y: number): Promise<void>
  /** move a tab to a new index in the strip; Home stays pinned at index 0 */
  reorder(id: string, toIndex: number): Promise<void>
  /** subscribe to tab list changes (open/close/activate/title updates); returns unsubscribe */
  onChanged(handler: (tabs: TabSummary[]) => void): () => void
  /**
   * fire-and-forget: a pointerdown landed on the shell chrome (tab strip).
   * Document tabs are sibling WebContentsViews that see neither the event nor
   * a focus change, so the shell relays it for them to dismiss popovers.
   */
  notifyChromePressed(): void
  /** the main-process broadcast that notifyChromePressed (and a window drag)
   * triggers; the shell's own popovers subscribe so a title-bar drag — which
   * produces no DOM event — still dismisses them */
  onChromePressed(handler: () => void): () => void
}

export const TABS_CHANNELS = {
  list: 'tabs:list',
  activate: 'tabs:activate',
  close: 'tabs:close',
  showMenu: 'tabs:show-menu',
  showNewMenu: 'tabs:show-new-menu',
  showTabMenu: 'tabs:show-tab-menu',
  detach: 'tabs:detach',
  tearOff: 'tabs:tear-off',
  dragTornWindow: 'tabs:drag-torn-window',
  dockTornWindow: 'tabs:dock-torn-window',
  endTornDrag: 'tabs:end-torn-drag',
  dockPreview: 'tabs:dock-preview',
  dockIndex: 'tabs:dock-index',
  showAppMenu: 'tabs:show-app-menu',
  reorder: 'tabs:reorder',
  changed: 'tabs:changed',
  chromePressed: 'tabs:chrome-pressed',
} as const
