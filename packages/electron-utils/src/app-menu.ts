/// Localized replacements for Electron role menus, whose built-in labels are
/// English-only and (for role:'windowMenu' on Windows/Linux) follow macOS
/// conventions (Zoom, Ctrl+M minimize, Bring All to Front).
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { baseLang, contextMenuLabels, type ContextMenuLabels } from './context-menu'

export interface AppMenuLabels extends ContextMenuLabels {
  window: string
  minimize: string
  closeWindow: string
  edit: string
  undo: string
  redo: string
  delete: string
  view: string
  reload: string
  forceReload: string
  toggleDevTools: string
  actualSize: string
  zoomIn: string
  zoomOut: string
  fullscreen: string
  help: string
  about: string
  version: string
}

type Labels = Omit<AppMenuLabels, keyof ContextMenuLabels>

const EN: Labels = {
  window: 'Window',
  minimize: 'Minimize',
  closeWindow: 'Close Window',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  delete: 'Delete',
  view: 'View',
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDevTools: 'Developer Tools',
  actualSize: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  fullscreen: 'Full Screen',
  help: 'Help',
  about: 'About YiiOffice',
  version: 'Version',
}

// Shared table, same rationale as context-menu.ts: one copy instead of
// 15 keys × 20 languages per app dictionary.
const LABELS: Record<string, Labels> = {
  zh: {
    window: '窗口',
    minimize: '最小化',
    closeWindow: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    delete: '删除',
    view: '视图',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '开发者工具',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '全屏',
    help: '帮助',
    about: '关于 YiiOffice',
    version: '版本',
  },
  en: EN,
}

export function appMenuLabels(lang: string): AppMenuLabels {
  return { ...contextMenuLabels(lang), ...(LABELS[lang] ?? LABELS[baseLang(lang)] ?? EN) }
}

/** macOS keeps the native role (Minimize/Zoom/Front, window list); Windows/Linux
 * gets only conventional items — no Zoom/Front, and no Ctrl+M accelerator since
 * Windows has no menu shortcut for minimize. */
export function windowMenuTemplate(
  platform: NodeJS.Platform,
  labels: AppMenuLabels,
): MenuItemConstructorOptions {
  if (platform === 'darwin') return { role: 'windowMenu', label: labels.window }
  return {
    label: labels.window,
    submenu: [
      { label: labels.minimize, click: (_item, win) => win?.minimize() },
      { type: 'separator' },
      { label: labels.closeWindow, click: (_item, win) => win?.close() },
    ],
  }
}

/** macOS keeps role:'editMenu' (Speech/Substitutions submenus etc.); elsewhere
 * the same items Electron would generate, with localized labels. */
export function editMenuTemplate(
  platform: NodeJS.Platform,
  labels: AppMenuLabels,
): MenuItemConstructorOptions {
  if (platform === 'darwin') return { role: 'editMenu', label: labels.edit }
  return {
    label: labels.edit,
    submenu: [
      { role: 'undo', label: labels.undo },
      { role: 'redo', label: labels.redo },
      { type: 'separator' },
      { role: 'cut', label: labels.cut },
      { role: 'copy', label: labels.copy },
      { role: 'paste', label: labels.paste },
      { role: 'delete', label: labels.delete },
      { type: 'separator' },
      { role: 'selectAll', label: labels.selectAll },
    ],
  }
}

let lastDetachedDevToolsTarget: WebContents | undefined

/** role:'toggleDevTools' docks DevTools into the window, where the shell's
 * WebContentsView tabs are stacked above it and occlude it — open detached
 * instead, keeping the role's accelerator and toggle semantics. */
export function toggleDevToolsItem(labels: AppMenuLabels): MenuItemConstructorOptions {
  return {
    label: labels.toggleDevTools,
    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
    click: async () => {
      const { webContents } = await import('electron')
      const focused = webContents.getFocusedWebContents()
      const previous =
        lastDetachedDevToolsTarget && !lastDetachedDevToolsTarget.isDestroyed()
          ? lastDetachedDevToolsTarget
          : undefined
      const wc = !focused || focused === previous?.devToolsWebContents ? previous : focused
      if (!wc) return
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools()
        if (wc === lastDetachedDevToolsTarget) lastDetachedDevToolsTarget = undefined
      } else {
        wc.openDevTools({ mode: 'detach' })
        lastDetachedDevToolsTarget = wc
      }
    },
  }
}

export interface ViewMenuOptions {
  /** Reload / Force Reload / DevTools (default on) */
  readonly devItems?: boolean
  /** Actual Size / Zoom In / Zoom Out page-zoom roles (default on) */
  readonly pageZoom?: boolean
}

/**
 * role:'viewMenu' expands identically on every platform, so no branch. Menu
 * accelerators beat renderer key handlers on macOS, so apps whose document
 * shortcuts collide with ⌘R / ⌘0 / ⌘+ / ⌘- opt those groups out.
 */
export function viewMenuTemplate(
  labels: AppMenuLabels,
  { devItems = true, pageZoom = true }: ViewMenuOptions = {},
): MenuItemConstructorOptions {
  const groups: MenuItemConstructorOptions[][] = []
  if (devItems) {
    groups.push([
      { role: 'reload', label: labels.reload },
      { role: 'forceReload', label: labels.forceReload },
      toggleDevToolsItem(labels),
    ])
  }
  if (pageZoom) {
    groups.push([
      { role: 'resetZoom', label: labels.actualSize },
      { role: 'zoomIn', label: labels.zoomIn },
      { role: 'zoomOut', label: labels.zoomOut },
    ])
  }
  groups.push([{ role: 'togglefullscreen', label: labels.fullscreen }])
  return {
    label: labels.view,
    submenu: groups.flatMap((group, index) =>
      index === 0 ? group : [{ type: 'separator' }, ...group],
    ),
  }
}



/** Callback installed by the shell to trigger a manual update check. */
let _updateCheckInvoker: (() => void) | undefined

/**
 * Allow the owning shell to wire a "Check for Updates…" menu item to the
 * actual auto-updater backend (which lives outside this package).
 */
export function setUpdateCheckInvoker(fn: (() => void) | undefined): void {
  _updateCheckInvoker = fn
}

/** Help > Check for Updates… menu item (no-op when no invoker is wired). */
export function checkUpdatesMenuItem(_labels: AppMenuLabels): MenuItemConstructorOptions {
  return {
    label: 'Check for Updates…',
    click: () => {
      _updateCheckInvoker?.()
    },
  }
}

/** Help > About: a native dialog with the app version — every window's menu
 * gets one, so users can report the exact build they run. */
export function aboutMenuItem(labels: AppMenuLabels): MenuItemConstructorOptions {
  return {
    label: labels.about,
    click: async () => {
      const { app, dialog, clipboard } = await import('electron')
      const version = app.getVersion()
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'YiiOffice',
        message: 'YiiOffice',
        detail: `${labels.version} ${version}`,
        buttons: ['OK', labels.copy],
        defaultId: 0,
        cancelId: 0,
      })
      if (response === 1) clipboard.writeText(`YiiOffice ${version}`)
    },
  }
}

/** Help menu with Check for Updates… + About; extra app-specific items go
 * before the separator. */
export function helpMenuTemplate(
  labels: AppMenuLabels,
  extraItems: MenuItemConstructorOptions[] = [],
): MenuItemConstructorOptions {
  return {
    role: 'help',
    label: labels.help,
    submenu: [
      ...extraItems,
      ...(extraItems.length > 0 ? [{ type: 'separator' } as const] : []),
      aboutMenuItem(labels),
    ],
  }
}
