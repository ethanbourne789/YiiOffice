/// Tab-strip IPC: the tab list lifecycle, the native tab context menus, the
/// tear-off / detach-to-window flows and the shell-chrome press relay.

import { handleFromShell, onFromShell } from './ipc-guard'
import { Menu, webContents } from 'electron'
import type { MenuItemConstructorOptions, WebContents } from 'electron'

import { TABS_CHANNELS } from '../shared/tabs-api'
import {
  createDetachedEditorWindow,
  dragTornWindow,
  endTornDrag,
  isTearingOff,
  takeTornTab,
} from './detached-windows'
import { tm } from './shell-i18n'
import {
  applyMenuFor,
  menuIcons,
  openFileViaDialog,
  TAB_MENU_ICON,
} from './shell-menus'
import {
  newDocTab,
  newMarkdownTab,
  newPdfTab,
  newSheetTab,
  newSlideTab,
} from './shell-routing'
import { ensureTabManager, setLastDockIndex, shellWindow, tabManager } from './shell-state'


function broadcastChromePressed(exclude?: WebContents): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc !== exclude) wc.send('app:chrome-pressed')
  }
}

/** "Open in New Window": reparent the tab's live view into a detached editor
 *  window — the document moves as-is, unsaved edits included. */
function detachTabToWindow(id: string): void {
  if (!tabManager) return
  const record = tabManager.detachTab(id)
  if (!record) return
  const win = createDetachedEditorWindow({ ...record, applyMenuFor })
  win.focus()
}

/** Tear-off: the tab leaves the strip for a window created under the held
 *  pointer at (x, y); the strip keeps steering it until release. */
function tearOffTabToWindow(id: string, x: number, y: number): boolean {
  if (!tabManager || isTearingOff() || !tabManager.canDetachTab(id)) return false
  const record = tabManager.detachTab(id)
  if (!record) return false
  createDetachedEditorWindow({ ...record, applyMenuFor, tearOffAt: { x, y } })
  return true
}


function registerTabsIpc(): void {
  onFromShell(TABS_CHANNELS.chromePressed, (event) => broadcastChromePressed(event.sender))
  handleFromShell(TABS_CHANNELS.list, () => tabManager?.list() ?? [])
  handleFromShell(TABS_CHANNELS.activate, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    tabManager?.activateTab(id)
  })
  handleFromShell(TABS_CHANNELS.close, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    return tabManager?.closeTab(id)
  })
  handleFromShell(TABS_CHANNELS.reorder, (_event, id: string, toIndex: number) => {
    if (typeof id === 'string' && Number.isInteger(toIndex)) tabManager?.reorderTab(id, toIndex)
  })
  // "all tabs" overflow menu — native popup because the editors' WebContentsView
  // would cover any DOM dropdown the shell renderer draws below the tab strip
  handleFromShell(TABS_CHANNELS.showAppMenu, (_event, x: unknown, y: unknown) => {
    if (!shellWindow) return
    Menu.getApplicationMenu()?.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  handleFromShell(TABS_CHANNELS.showMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate(
      tabManager.list().map((tab) => ({
        label: tab.title,
        type: 'checkbox' as const,
        checked: tab.active,
        icon: menuIcons()[TAB_MENU_ICON[tab.kind]],
        click: () => tabManager?.activateTab(tab.id),
      })),
    )
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  handleFromShell(TABS_CHANNELS.detach, (_event, id: unknown) => {
    if (typeof id !== 'string' || !tabManager?.canDetachTab(id)) return
    detachTabToWindow(id)
  })
  // drag-to-tear-off: the strip drives the window until the pointer lifts
  handleFromShell(TABS_CHANNELS.tearOff, (_event, id: unknown, x: unknown, y: unknown) => {
    if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number') return false
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return tearOffTabToWindow(id, x, y)
  })
  onFromShell(TABS_CHANNELS.dragTornWindow, (_event, x: unknown, y: unknown) => {
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y))
      dragTornWindow(x, y)
  })
  handleFromShell(TABS_CHANNELS.dockTornWindow, (_event, index: unknown) => {
    const tab = takeTornTab()
    if (!tab) return
    ensureTabManager().attachTab(tab, typeof index === 'number' ? index : undefined)
  })
  handleFromShell(TABS_CHANNELS.endTornDrag, () => endTornDrag())
  onFromShell(TABS_CHANNELS.dockIndex, (_event, index: unknown) => {
    setLastDockIndex(typeof index === 'number' && Number.isInteger(index) ? index : undefined)
  })
  // per-tab context menu — native for the same reason as the tab list above
  handleFromShell(TABS_CHANNELS.showTabMenu, (_event, id: unknown, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow || typeof id !== 'string') return
    const tab = tabManager.list().find((t) => t.id === id)
    if (!tab || tab.kind === 'home') return
    const template: MenuItemConstructorOptions[] = []
    // every document tab except a chrome-free Present tab (a live preview of
    // another tab's document — it has nothing of its own to move)
    if (tabManager.canDetachTab(id)) {
      template.push({
        label: tm('menuOpenInNewWindow'),
        click: () => detachTabToWindow(id),
      })
      template.push({ type: 'separator' })
    }
    template.push({
      label: tm('menuClose'),
      enabled: tab.closable,
      click: () => void tabManager?.closeTab(id),
    })
    Menu.buildFromTemplate(template).popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
  // "+" new-file menu — native for the same reason as the tab list above
  handleFromShell(TABS_CHANNELS.showNewMenu, (_event, x: unknown, y: unknown) => {
    if (!tabManager || !shellWindow) return
    const menu = Menu.buildFromTemplate([
      // enabled:false so pre-Sonoma macOS / Windows (no 'header' support) degrade
      // to an inert label instead of a clickable no-op item
      { label: tm('menuSectionNew'), type: 'header', enabled: false },
      {
        label: tm('menuNewDoc'),
        icon: menuIcons().docx,
        click: () => newDocTab(),
      },
      {
        label: tm('menuNewSheet'),
        icon: menuIcons().xlsx,
        click: () => void newSheetTab(),
      },
      {
        label: tm('menuNewSlide'),
        icon: menuIcons().pptx,
        click: () => newSlideTab(),
      },
      {
        label: tm('menuNewMarkdown'),
        icon: menuIcons().md,
        click: () => newMarkdownTab(),
      },
      {
        label: tm('menuNewPdf'),
        icon: menuIcons().pdf,
        click: () => void newPdfTab(),
      },
      { type: 'separator' },
      { label: tm('menuOpen'), click: () => void openFileViaDialog() },
    ])
    menu.popup({
      window: shellWindow,
      ...(typeof x === 'number' && typeof y === 'number'
        ? { x: Math.round(x), y: Math.round(y) }
        : {}),
    })
  })
}

// On mainland-China networks the main process's Node fetch (undici) bypasses the system proxy,
// so direct calls to overseas LLM/image-search APIs time out or get region-blocked (403).
// Prefer proxy env vars (terminal launch); a packaged app launched from Finder inherits no shell
// env vars, so fall back to the system HTTP proxy. The renderer uses Chromium's system proxy and
// is unaffected. Same bootstrap as slides-main startSlidesStandalone.
// awaited by login IPC so the first status probe / login click cannot race the proxy resolution

export { registerTabsIpc, broadcastChromePressed, detachTabToWindow, tearOffTabToWindow }
