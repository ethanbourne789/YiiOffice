import { beforeEach, describe, expect, it } from 'vitest'
import { createHeadlessExportChannel } from './headless-export-bridge'

interface FakeRuntime {
  Events: {
    On: (name: string, cb: (ev: unknown) => void) => () => void
    Emit: (name: string, data?: unknown) => void
    Off?: (...names: string[]) => void
  }
}

interface Fake {
  fire: (name: string, data: unknown) => void
  emitted: Array<{ name: string; data: unknown }>
  channels: string[]
}

function installRuntime(): Fake {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  const emitted: Array<{ name: string; data: unknown }> = []
  const channels: string[] = []
  const runtime: FakeRuntime = {
    Events: {
      On(name, cb) {
        channels.push(name)
        const list = listeners.get(name) ?? []
        list.push(cb)
        listeners.set(name, list)
        return () => {
          listeners.set(
            name,
            (listeners.get(name) ?? []).filter((l) => l !== cb),
          )
        }
      },
      Emit(name, data) {
        emitted.push({ name, data })
      },
    },
  }
  ;(window as unknown as { wails?: FakeRuntime }).wails = runtime
  return {
    channels,
    emitted,
    fire(name, data) {
      for (const cb of listeners.get(name) ?? []) cb({ name, data })
    },
  }
}

describe('headless export channel', () => {
  beforeEach(() => {
    delete (window as unknown as { wails?: FakeRuntime }).wails
  })

  it('subscribes and signals ready at construction time', () => {
    const fake = installRuntime()
    createHeadlessExportChannel('unit-docs')

    expect(fake.channels).toContain('unit-docs:consume-headless-export')
    expect(fake.emitted[0]).toEqual({ name: 'unit-docs:headless-ready', data: undefined })
  })

  it('delivers the request emitted after consume() was called', async () => {
    const fake = installRuntime()
    const channel = createHeadlessExportChannel('unit-late')

    const pending = channel.consume()
    fake.fire('unit-late:consume-headless-export', {
      inputPath: 'in.docx',
      outPath: 'out.pdf',
      format: 'pdf',
    })

    await expect(pending).resolves.toEqual({
      inputPath: 'in.docx',
      outPath: 'out.pdf',
      format: 'pdf',
    })
  })

  it('replays a request that arrived before the editor subscribed', async () => {
    const fake = installRuntime()
    const channel = createHeadlessExportChannel('unit-early')

    fake.fire('unit-early:consume-headless-export', {
      outPath: 'out.pdf',
      format: 'pdf',
    })

    await expect(channel.consume()).resolves.toEqual({
      inputPath: '',
      outPath: 'out.pdf',
      format: 'pdf',
    })
    // One-shot: the same request must not be handed to a later consumer.
    await expect(channel.consume()).resolves.toBeNull()
  })

  it('reports completion back to Go', () => {
    const fake = installRuntime()
    const channel = createHeadlessExportChannel('unit-done')

    channel.done({ ok: true })

    expect(fake.emitted.at(-1)).toEqual({
      name: 'unit-done:headless-export-done',
      data: { ok: true },
    })
  })

  it('stays inert without a Wails runtime (normal GUI / browser preview)', async () => {
    const channel = createHeadlessExportChannel('unit-headless')

    await expect(channel.consume()).resolves.toBeNull()
    expect(() => channel.done({ ok: true })).not.toThrow()
  })

  it('ignores malformed request payloads', async () => {
    const fake = installRuntime()
    const channel = createHeadlessExportChannel('unit-malformed')
    fake.fire('unit-malformed:consume-headless-export', { format: 'pdf' })

    fake.fire('unit-malformed:consume-headless-export', null)
    // No valid request is pending, so resolve it ourselves through a valid one.
    fake.fire('unit-malformed:consume-headless-export', { outPath: 'out.pdf', format: 'pdf' })
    await expect(channel.consume()).resolves.toEqual({ inputPath: '', outPath: 'out.pdf', format: 'pdf' })
  })
})
