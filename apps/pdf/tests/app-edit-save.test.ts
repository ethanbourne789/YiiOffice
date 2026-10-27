/** The edit -> save path, driven the way a user drives it: a ribbon command, then
    the save button. Until the ribbon carried `data-cmd` hooks this could only be
    reached by calling the component's internals; the hooks make the real path
    (state update -> dirty -> enabled save -> `pdfApi.save` payload) testable.

    Rotation is the edit: it is one click, it sets `ordinaryDirty`, and its payload
    is a single comparable array. Text markup would need a live selection, which
    jsdom does not have in a form the component's hit-testing accepts. */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SavePdfRequest } from '../src/shared/ipc'
import {
  clickCmd,
  clickTab,
  cmd,
  freshBytes,
  mountPdfApp,
  stubPdfApi,
  until,
  usePdfWorkerFromDisk,
  type MountedApp,
} from './helpers/render-app'

let mounted: MountedApp | null = null

beforeEach(() => {
  usePdfWorkerFromDisk()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

async function pdfWith(text: string): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(text, { x: 72, y: 700, size: 24, font })
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Mount one page and record every save the app asks for. */
async function mountForSave(): Promise<{ root: HTMLElement; saves: SavePdfRequest[] }> {
  const bytes = await pdfWith('Hello')
  const saves: SavePdfRequest[] = []
  stubPdfApi({
    consumePending: async () => '/docs/queued.pdf',
    // a copy per call: the post-save reload reads the file again, and pdfjs
    // detaches whatever buffer it is handed
    readFile: async () => freshBytes(bytes),
    save: async (request) => {
      saves.push(request)
      return { ok: true }
    },
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return { root: mounted.container, saves }
}

describe('pdf edit -> save', () => {
  it('keeps save disabled until an edit lands', async () => {
    const { root } = await mountForSave()
    // a freshly opened document has nothing to write, and the button says so
    expect(cmd(root, 'save').hasAttribute('disabled')).toBe(true)

    await clickTab(root, 'page')
    await clickCmd(root, 'rotateLeft')

    expect(cmd(root, 'save').hasAttribute('disabled')).toBe(false)
  })

  it('writes the rotation the ribbon command recorded', async () => {
    const { root, saves } = await mountForSave()
    await clickTab(root, 'page')
    await clickCmd(root, 'rotateLeft')
    await clickCmd(root, 'save')
    await until(() => saves.length === 1, 'the save request')

    const request = saves[0]!
    expect(request.path).toBe('/docs/queued.pdf')
    // -90 is normalized into [0, 360) by the page-op layer, so one step counter
    // clockwise arrives as 270
    expect(request.rotations).toEqual([{ pageIndex: 0, delta: 270 }])
    // the other edit channels stay empty: the save sends what was edited, not defaults
    expect(request.markups).toEqual([])
    expect(request.drawings).toEqual([])
    expect(request.textEdits).toEqual([])
    expect(request.blankPages).toEqual([])
  })

  it('returns to a clean state once the write succeeded', async () => {
    const { root, saves } = await mountForSave()
    await clickTab(root, 'page')
    await clickCmd(root, 'rotateLeft')
    await clickCmd(root, 'save')
    await until(() => saves.length === 1, 'the save request')
    // the post-save reload drops the pending rotation, so there is nothing left to write
    await until(() => cmd(root, 'save').hasAttribute('disabled'), 'the save button to go clean')
    expect(saves).toHaveLength(1)
  })
})
