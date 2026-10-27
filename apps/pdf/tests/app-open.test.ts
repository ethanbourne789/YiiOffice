/** The open path, end to end inside jsdom: real PDF bytes in through the stubbed
    bridge, a parsed document out. This is the layer the component's state-domain
    refactor has to keep intact, and nothing covered it before.

    The bytes come from pdf-lib rather than a checked-in fixture: the repo has no
    PDF fixtures on disk, and every existing pdf test builds its own. */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '../src/renderer/i18n/locale'
import { mountPdfApp, stubPdfApi, usePdfWorkerFromDisk, type MountedApp } from './helpers/render-app'

let mounted: MountedApp | null = null

beforeEach(() => {
  usePdfWorkerFromDisk()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/** One US-Letter page carrying `text`, as PDF bytes. */
async function pdfWith(text: string): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 72, y: 700, size: 24, font })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('pdf editor open path', () => {
  it('opens the document the shell queued for this tab', async () => {
    const bytes = await pdfWith('Hello')
    const read: string[] = []
    stubPdfApi({
      consumePending: async () => '/docs/queued.pdf',
      readFile: async (path: string) => {
        read.push(path)
        return bytes
      },
    })
    mounted = await mountPdfApp()
    await mounted.settle()
    expect(read).toEqual(['/docs/queued.pdf'])
    const text = mounted.container.textContent ?? ''
    expect(text).not.toContain(t('loadError'))
    // left the no-document state and laid out the parsed page
    expect(text).not.toContain(t('noFile'))
    const pages = mounted.container.querySelectorAll('.pdf-page')
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0]!.getAttribute('data-page')).toBe('0')
  })

  it('reports a document it cannot parse instead of showing an empty view', async () => {
    stubPdfApi({
      consumePending: async () => '/docs/corrupt.pdf',
      readFile: async () => new TextEncoder().encode('not a pdf').buffer as ArrayBuffer,
    })
    mounted = await mountPdfApp()
    await mounted.settle()
    expect(mounted.container.textContent ?? '').toContain(t('loadError'))
  })

  it('answers the shell control channel with the real page count', async () => {
    stubPdfApi({
      consumePending: async () => '/docs/queued.pdf',
      readFile: async () => pdfWith('Hello'),
    })
    mounted = await mountPdfApp()
    await mounted.settle()
    // App installs this on every render for `yiioffice open --page` / `selection`
    const control = (window as unknown as Record<string, unknown>).__yiiofficeControl as (req: {
      cmd: string
      target?: { kind: string; page?: number }
    }) => { status: string; result?: Record<string, unknown> }

    expect(control({ cmd: 'goto', target: { kind: 'page', page: 1 } })).toEqual({
      status: 'ok',
      result: { page: 1 },
    })
    // out of range against a one-page document, not against an unloaded view
    expect(control({ cmd: 'goto', target: { kind: 'page', page: 9 } }).status).toBe('error')
  })
})
