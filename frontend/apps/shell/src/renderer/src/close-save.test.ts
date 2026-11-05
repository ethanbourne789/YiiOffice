import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveTabsForClose } from './close-save'

/** Mounts an editor iframe and returns the window the shell would call into. */
function mountFrame(tabId: string): Window {
  const frame = document.createElement('iframe')
  frame.dataset.tabId = tabId
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) throw new Error('jsdom did not attach a contentWindow')
  return win
}

function installHook(win: Window, hook: () => Promise<boolean> | boolean): void {
  ;(win as unknown as { __yiiofficeCloseSave?: () => Promise<boolean> | boolean })
    .__yiiofficeCloseSave = hook
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('saveTabsForClose', () => {
  it('reports success when every dirty editor saved', async () => {
    const docs = mountFrame('tab-1')
    const sheets = mountFrame('tab-2')
    const calls: string[] = []
    installHook(docs, () => {
      calls.push('docs')
      return Promise.resolve(true)
    })
    installHook(sheets, () => {
      calls.push('sheets')
      return Promise.resolve(true)
    })

    const ok = await saveTabsForClose([
      { id: 'tab-1', kind: 'docs' },
      { id: 'tab-2', kind: 'sheets' },
    ])

    expect(ok).toBe(true)
    // Sequential, so one editor cannot write the same file the other is writing.
    expect(calls).toEqual(['docs', 'sheets'])
  })

  it('fails when an editor reports a failed write', async () => {
    const docs = mountFrame('tab-1')
    installHook(docs, () => Promise.resolve(false))

    expect(await saveTabsForClose([{ id: 'tab-1' }])).toBe(false)
  })

  it('treats a missing hook as a failure instead of closing over unsaved edits', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mountFrame('tab-1')

    expect(await saveTabsForClose([{ id: 'tab-1' }])).toBe(false)
  })

  it('keeps going after one editor throws', async () => {
    const broken = mountFrame('tab-1')
    const healthy = mountFrame('tab-2')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installHook(broken, () => Promise.reject(new Error('disk full')))
    installHook(healthy, () => Promise.resolve(true))

    expect(await saveTabsForClose([{ id: 'tab-1' }, { id: 'tab-2' }])).toBe(false)
  })

  it('ignores entries without a tab id', async () => {
    const docs = mountFrame('tab-1')
    installHook(docs, () => Promise.resolve(true))

    expect(await saveTabsForClose([{ kind: 'docs' }, { id: 'tab-1' }])).toBe(true)
  })

  it('rejects a payload that is not a list', async () => {
    expect(await saveTabsForClose(undefined)).toBe(false)
    expect(await saveTabsForClose({ id: 'tab-1' })).toBe(false)
  })
})
