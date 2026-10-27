/** The text dialog through the ribbon, on a real document.

    `static-text-dialog.test.ts` covers the draft and the shell; this covers what
    only the editor can get wrong: which title a given opener produces, and that a
    confirm leaves the editor in the mode that opener was arming (insert text is
    click-to-place, a form label is click-to-place as an image). */

import { act } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clickCmd,
  clickTab,
  freshBytes,
  mountPdfApp,
  stubPdfApi,
  usePdfWorkerFromDisk,
  type MountedApp,
} from './helpers/render-app'
import * as staticFormFill from '../src/renderer/static-form-fill'

/** Rasterizing a label needs a 2D canvas, which jsdom does not have, so the real
    renderer returns null here and the editor correctly refuses to arm a placement
    it could not fill. The one test that needs the armed state hands that function a
    pre-baked image instead of asserting on the gap. */
vi.mock('../src/renderer/static-form-fill', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/static-form-fill')>()
  return { ...actual, renderStaticFormText: vi.fn(actual.renderStaticFormText) }
})

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

async function openEditor(): Promise<HTMLElement> {
  const bytes = await pdfWith('Hello')
  stubPdfApi({
    consumePending: async () => '/docs/queued.pdf',
    readFile: async () => freshBytes(bytes),
    // the insert path refuses text it cannot embed; this stub can draw anything
    canDrawText: async () => true,
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return mounted.container
}

const dialogTitle = (root: HTMLElement): string | null | undefined =>
  root.querySelector('[role="dialog"]')?.getAttribute('aria-label')

async function type(root: HTMLElement, value: string): Promise<void> {
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-cmd="dialogInput"]')!
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  await act(async () => {
    setValue.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

const isArmed = (root: HTMLElement, cmd: string): boolean =>
  root.querySelector(`[data-cmd="${cmd}"]`)!.className.includes('active')

describe('text dialog from the ribbon', () => {
  it('opens insert-text with an empty field and a dead OK', async () => {
    const root = await openEditor()
    await clickCmd(root, 'insertText')

    // zh is the harness locale, so this pins the title the insert opener produces
    expect(dialogTitle(root)).toBe('插入文字')
    expect(root.querySelector<HTMLTextAreaElement>('[data-cmd="dialogInput"]')!.value).toBe('')
    expect(root.querySelector<HTMLButtonElement>('[data-cmd="dialogOk"]')!.disabled).toBe(true)
  })

  it('arms click-to-place once the text is confirmed', async () => {
    const root = await openEditor()
    await clickCmd(root, 'insertText')
    await type(root, 'Signed off')
    await clickCmd(root, 'dialogOk')

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    // pendingTextInsert set: the next click on a page places the text
    expect(isArmed(root, 'insertText')).toBe(true)
  })

  it('arms nothing when the dialog is cancelled', async () => {
    const root = await openEditor()
    await clickCmd(root, 'insertText')
    await type(root, 'never placed')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(isArmed(root, 'insertText')).toBe(false)
  })

  it('opens the form-label dialog under its own title', async () => {
    const root = await openEditor()
    await clickTab(root, 'fillForm')
    await clickCmd(root, 'formAddText')

    expect(dialogTitle(root)).toBe('添加文字到 PDF')
  })

  it('arms click-to-place as a form label, not as inserted text', async () => {
    const root = await openEditor()
    await clickTab(root, 'fillForm')
    await clickCmd(root, 'formAddText')
    // stand in for the rasterized label jsdom cannot produce
    vi.mocked(staticFormFill.renderStaticFormText).mockReturnValueOnce({
      kind: 'image',
      image: 'AAAA',
      width: 48,
      height: 16,
    })
    await type(root, 'Date: ____')
    await clickCmd(root, 'dialogOk')

    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(isArmed(root, 'formAddText')).toBe(true)
    // the insert path must not have been taken: nothing is pending placement as text
    // (its button only exists on the home tab, so look for it there)
    await clickTab(root, 'home')
    expect(isArmed(root, 'insertText')).toBe(false)
  })
})
