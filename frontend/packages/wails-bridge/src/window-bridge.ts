// Thin wrapper over the official Wails V3 generated WindowService bindings.
//
// The main window is frameless so the tab strip can be the title bar, which
// means Windows never draws its own caption buttons — the shell renders them
// and calls these. Nothing here is Electron-specific: the same bindings drive
// the caption buttons of a detached document window if one ever grows a strip.
import { on } from './transport'
import {
  Close,
  IsMaximised,
  Minimise,
  ToggleMaximise,
} from '@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/windowservice'

export interface WindowControlsApi {
  /** send the window to the taskbar */
  minimise(): Promise<void>
  /** flip between maximised and restored; resolves with the new state */
  toggleMaximise(): Promise<boolean>
  /** current maximised state, for the restore/maximise glyph at startup */
  isMaximised(): Promise<boolean>
  /** close the window; the Go side runs the unsaved-document guard first */
  close(): Promise<void>
  /** subscribe to maximise/un-maximise (drag-to-snap included); returns unsubscribe */
  onMaximisedChange(handler: (maximised: boolean) => void): () => void
}

/** Wraps the generated WindowService bindings behind the window-controls API. */
export function createWindowControlsApi(): WindowControlsApi {
  return {
    async minimise() {
      await Minimise()
    },
    async toggleMaximise() {
      const value = await ToggleMaximise()
      return value === true
    },
    async isMaximised() {
      const value = await IsMaximised()
      return value === true
    },
    async close() {
      await Close()
    },
    onMaximisedChange(handler) {
      // the runtime is absent in plain-browser previews: no events, no crash
      try {
        const offMaximise = on('common:WindowMaximise', () => handler(true))
        const offRestore = on('common:WindowUnMaximise', () => handler(false))
        return () => {
          offMaximise()
          offRestore()
        }
      } catch {
        return () => {}
      }
    },
  }
}

/**
 * Reads the window's maximised state without surfacing binding errors: the
 * shell degrades to "restore" glyph in dev browsers and during startup races.
 */
export async function readMaximised(api: WindowControlsApi): Promise<boolean> {
  try {
    return await api.isMaximised()
  } catch {
    return false
  }
}
