/** The page-operation dialogs, driven through the ribbon: the ribbon command opens
    the prompt, typed input goes through the real controlled input, and a rejected
    range keeps the dialog open with the field marked.

    This is the wiring the extracted `RangeDialog` cannot cover on its own -- the
    component test proves the dialog closes and confirms, this one proves the
    editor opens the right dialog with the right starting value and hands the
    parsed pages to the bridge. */

import { act } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExtractPagesRequest } from '../src/shared/ipc'
import {
  clickCmd,
  clickTab,
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

/** Type into a controlled React input the way a keystroke does. Setting `.value`
    directly is ignored by React: it tracks the value on the DOM node and only
    updates state from the native setter's change event. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function openEditor(): Promise<{ root: HTMLElement; extracts: ExtractPagesRequest[] }> {
  const bytes = await pdfWith('Hello')
  const extracts: ExtractPagesRequest[] = []
  stubPdfApi({
    consumePending: async () => '/docs/queued.pdf',
    readFile: async () => freshBytes(bytes),
    extractPages: async (request) => {
      extracts.push(request)
      return { ok: false, error: 'canceled by the stub' }
    },
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return { root: mounted.container, extracts }
}

describe('page-operation dialogs from the ribbon', () => {
  it('opens the extract prompt prefilled with the current page', async () => {
    const { root } = await openEditor()
    await clickTab(root, 'page')
    await clickCmd(root, 'extractPage')

    const dialog = root.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-label')).toBeTruthy()
    const input = dialog!.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!
    // "extract the page I am looking at" is the common case, so it starts at 1
    expect(input.value).toBe('1')
  })

  it('keeps a rejected range open and marks the field', async () => {
    const { root, extracts } = await openEditor()
    await clickTab(root, 'page')
    await clickCmd(root, 'extractPage')
    const input = root.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!

    // the document has one page
    await type(input, '9')
    await clickCmd(root, 'dialogOk')

    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    expect(root.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!.className).toContain(
      'invalid',
    )
    expect(extracts).toEqual([])
  })

  it('extracts the visible page numbers a valid range names', async () => {
    const { root, extracts } = await openEditor()
    await clickTab(root, 'page')
    await clickCmd(root, 'extractPage')
    await clickCmd(root, 'dialogOk')

    await until(() => extracts.length === 1, 'the extract request')
    // page numbers are 1-based in the prompt and 0-based on the bridge
    expect(extracts[0]!.pages).toEqual([0])
    expect(extracts[0]!.path).toBe('/docs/queued.pdf')
    expect(extracts[0]!.suggestedName).toMatch(/-p1\.pdf$/)
    // confirmed dialogs close
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens print on all pages and only asks for a range when custom is picked', async () => {
    const { root } = await openEditor()
    await clickCmd(root, 'print')

    const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(3)
    expect(radios[0]!.checked).toBe(true)
    expect(root.querySelector('[data-cmd="dialogInput"]')).toBeNull()

    await clickCmd(root, 'printRange-custom')
    const input = root.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')
    expect(input).not.toBeNull()

    // past the last page of a one-page document
    await type(input!, '99')
    await clickCmd(root, 'dialogOk')
    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
    expect(root.querySelector<HTMLInputElement>('[data-cmd="dialogInput"]')!.className).toContain(
      'invalid',
    )
  })
})
