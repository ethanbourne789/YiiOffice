/** Find-in-document through the ribbon, on a real document.

    `search-bar.test.ts` covers the state machine against a hand-built index; this
    covers the seam it cannot see: the ⌘F/ribbon command opens the bar, the text
    index of the loaded PDF backs the hits, and the editor's global Escape chain
    (not the input) is what closes it. */

import { act } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clickCmd,
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

async function pdfWith(pages: string[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = doc.addPage([612, 792])
    page.drawText(text, { x: 72, y: 700, size: 24, font })
  }
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function openEditor(pages: string[]): Promise<HTMLElement> {
  const bytes = await pdfWith(pages)
  stubPdfApi({
    consumePending: async () => '/docs/queued.pdf',
    readFile: async () => freshBytes(bytes),
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return mounted.container
}

const count = (root: HTMLElement): string | null | undefined =>
  root.querySelector('[data-cmd="searchCount"]')?.textContent

describe('find in document from the ribbon', () => {
  it('opens the bar and puts the caret in it', async () => {
    const root = await openEditor(['alpha beta'])
    expect(root.querySelector('.pdf-search-bar')).toBeNull()

    await clickCmd(root, 'search')

    const input = root.querySelector<HTMLInputElement>('[data-cmd="searchInput"]')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('counts the hits the document text actually contains', async () => {
    const root = await openEditor(['alpha beta', 'gamma alpha'])
    await clickCmd(root, 'search')
    await type(root.querySelector<HTMLInputElement>('[data-cmd="searchInput"]')!, 'alpha')

    // the scan is debounced and the index is built from pdfjs text extraction
    await until(() => count(root) === '1 / 2', 'the search results')

    await clickCmd(root, 'searchNext')
    expect(count(root)).toBe('2 / 2')
    await clickCmd(root, 'searchNext')
    expect(count(root)).toBe('1 / 2')
  })

  it('reports no results for a term the document does not contain', async () => {
    const root = await openEditor(['alpha beta'])
    await clickCmd(root, 'search')
    await type(root.querySelector<HTMLInputElement>('[data-cmd="searchInput"]')!, 'zzz')

    await until(() => count(root) === '无结果', 'the empty result')
    expect(
      root.querySelector<HTMLButtonElement>('[data-cmd="searchNext"]')!.disabled,
    ).toBe(true)
  })

  it('closes on Escape through the editor, not through the input', async () => {
    const root = await openEditor(['alpha beta'])
    await clickCmd(root, 'search')
    const input = root.querySelector<HTMLInputElement>('[data-cmd="searchInput"]')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(root.querySelector('.pdf-search-bar')).toBeNull()
  })

  it('toggles shut from the ribbon button as well', async () => {
    const root = await openEditor(['alpha beta'])
    await clickCmd(root, 'search')
    expect(root.querySelector('.pdf-search-bar')).not.toBeNull()
    await clickCmd(root, 'search')
    expect(root.querySelector('.pdf-search-bar')).toBeNull()
  })
})
