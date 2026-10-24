import type { BrowserWindow } from 'electron'
import type { UpdateChannel } from '../shared/update-api'

/**
 * Auto-updater stub.
 *
 * The official YiiOffice release pipeline injects electron-updater
 * integration at build time.  For local / fork builds (where no signing
 * credentials or update-server URL is available) the updater is a no-op so
 * the app still starts and the Help > Check for Updates menu item works
 * without crashing.
 */

/* istanbul ignore next -- requires electron-updater binary */
export function initAutoUpdater(
  _getWindow: () => BrowserWindow | null,
  _channel: UpdateChannel,
): void {
  // no-op in local builds
}

/* istanbul ignore next */
export function checkForUpdatesNow(): void {
  // no-op in local builds
}

/* istanbul ignore next */
export function applyUpdateChannel(_channel: UpdateChannel): void {
  // no-op in local builds
}