import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/**
 * ipc-guard.ts (audit 2026-10-26 item 6): every shell IPC entry point runs
 * behind `handleFromShell` / `onFromShell`, which drop a sender whose frame
 * URL is not one of the renderers this app loads. A renderer that got a
 * foothold must not be able to rename, move, trash or reveal arbitrary paths
 * by invoking the shell's channels directly.
 */

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  app: { getAppPath: () => '/app/root' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, fn)
    },
  },
}))

import {
  handleFromShell,
  isTrustedRendererUrl,
  onFromShell,
} from '../src/main/ipc-guard'

const APP_ROOT = '/app/root'

describe('isTrustedRendererUrl', () => {
  it('trusts the built editor renderers', () => {
    expect(isTrustedRendererUrl('yiioffice-app://docs/index.html', APP_ROOT)).toBe(true)
    expect(isTrustedRendererUrl('yiioffice-app://pdf/index.html?x=1', APP_ROOT)).toBe(true)
  })

  it('trusts the dev server, and only on a loopback host', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/docs/index.html', APP_ROOT)).toBe(true)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', APP_ROOT)).toBe(true)
    expect(isTrustedRendererUrl('http://192.168.1.10:5173/', APP_ROOT)).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example.com/docs', APP_ROOT)).toBe(false)
  })

  it('trusts a file:// page only inside the app root', () => {
    const appRoot = join(tmpdir(), 'yiioffice-app-root')
    const inside = pathToFileURL(join(appRoot, 'out', 'renderer', 'index.html')).toString()
    const sibling = pathToFileURL(join(tmpdir(), 'yiioffice-app-root-escape', 'evil.html')).toString()
    const outside = pathToFileURL(join(tmpdir(), 'evil.html')).toString()
    expect(isTrustedRendererUrl(inside, appRoot)).toBe(true)
    expect(isTrustedRendererUrl(sibling, appRoot)).toBe(false)
    expect(isTrustedRendererUrl(outside, appRoot)).toBe(false)
  })

  it('rejects everything else', () => {
    expect(isTrustedRendererUrl('https://yiioffice-app/docs', APP_ROOT)).toBe(false)
    expect(isTrustedRendererUrl('data:text/html,x', APP_ROOT)).toBe(false)
    expect(isTrustedRendererUrl('about:blank', APP_ROOT)).toBe(false)
    expect(isTrustedRendererUrl('not a url', APP_ROOT)).toBe(false)
    expect(isTrustedRendererUrl('', APP_ROOT)).toBe(false)
  })
})

describe('handleFromShell / onFromShell', () => {
  const trustedFrame = { url: 'yiioffice-app://docs/index.html' }
  const hostileFrame = { url: 'https://evil.example.com/' }

  it('runs the handler for a frame the app loaded', () => {
    const fn = vi.fn(() => 'ok')
    handleFromShell('test:trusted', fn)
    expect(handlers.get('test:trusted')!({ senderFrame: trustedFrame }, 1, 2)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rejects a handler call from any other frame', () => {
    const fn = vi.fn()
    handleFromShell('test:hostile', fn)
    expect(() => handlers.get('test:hostile')!({ senderFrame: hostileFrame })).toThrow(
      /untrusted sender frame/,
    )
    expect(fn).not.toHaveBeenCalled()
  })

  it('drops a send from any other frame without touching the listener', () => {
    const fn = vi.fn()
    onFromShell('test:send', fn)
    listeners.get('test:send')!({ senderFrame: hostileFrame }, 'payload')
    expect(fn).not.toHaveBeenCalled()
    listeners.get('test:send')!({ senderFrame: trustedFrame }, 'payload')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('shell IPC registrations', () => {
  const mainDir = join(__dirname, '../src/main')
  const sources = readdirSync(mainDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [file, readFileSync(join(mainDir, file), 'utf8')] as const)

  it('registers every handler through the guard', () => {
    const raw = sources
      .filter(([file]) => file !== 'ipc-guard.ts')
      .filter(([, source]) => /\bipcMain\.(handle|on)\(/.test(source))
      .map(([file]) => file)
    expect(raw).toEqual([])
  })

  it('has a guard call for every channel the shell exposes', () => {
    const guarded = sources
      .flatMap(([, source]) => [...source.matchAll(/handleFromShell\(|onFromShell\(/g)])
      .length
    // 50+ home channels, the tab strip, the PDF converter dropdown, the drop
    // bridge and the pdf-password prompt — the audit counted 68 in one file
    expect(guarded).toBeGreaterThanOrEqual(60)
  })
})
