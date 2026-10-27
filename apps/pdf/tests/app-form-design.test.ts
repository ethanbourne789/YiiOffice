/** The form-design tab through the editor: arming, preview, and leaving the tab.

    `form-design-bar.test.ts` covers the state and the controls on their own. What
    only the editor can get wrong is the wiring around them -- Escape unwinding one
    authoring mode per press, and the tab switch that must not leave a tool armed
    (the ribbon is one component for every tab, so the mode outlives the button). */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clickCmd,
  clickTab,
  freshBytes,
  mountPdfApp,
  stubPdfApi,
  usePdfWorkerFromDisk,
  type MountedApp,
} from './helpers/render-app'
import { act } from 'react'
import { t } from '../src/renderer/i18n/locale'

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
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return mounted.container
}

const pressed = (root: ParentNode, cmd: string): string | null =>
  root.querySelector(`[data-cmd="${cmd}"]`)?.getAttribute('aria-pressed') ?? null

const progress = (root: ParentNode): string | null | undefined =>
  root.querySelector('.form-ribbon-progress')?.textContent

const press = async (key: string): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await Promise.resolve()
  })
}

describe('form design tab', () => {
  it('arms one tool at a time and says so on the ribbon', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    expect(progress(root)).toBe(t('formDesignEmptyHint'))

    await clickCmd(root, 'formDesignText')
    expect(pressed(root, 'formDesignText')).toBe('true')
    expect(progress(root)).toBe(t('formDesignPlaceHint'))

    await clickCmd(root, 'formDesignCheckbox')
    expect(pressed(root, 'formDesignText')).toBe('false')
    expect(pressed(root, 'formDesignCheckbox')).toBe('true')
  })

  it('presses the armed tool again to disarm it', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    await clickCmd(root, 'formDesignDate')
    await clickCmd(root, 'formDesignDate')

    expect(pressed(root, 'formDesignDate')).toBe('false')
    expect(progress(root)).toBe(t('formDesignEmptyHint'))
  })

  it('preview replaces the tool rather than stacking with it', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    await clickCmd(root, 'formDesignText')
    await clickCmd(root, 'formDesignPreview')

    expect(progress(root)).toBe(t('formDesignPreviewOn'))
    expect(pressed(root, 'formDesignPreview')).toBe('true')
    expect(pressed(root, 'formDesignText')).toBe('false')
  })

  it('Escape disarms the armed tool', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    await clickCmd(root, 'formDesignText')

    await press('Escape')
    expect(pressed(root, 'formDesignText')).toBe('false')
    expect(progress(root)).toBe(t('formDesignEmptyHint'))
  })

  it('preview is left through its own button, not by Escape', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    await clickCmd(root, 'formDesignPreview')

    // the Escape chain unwinds a tool, a selection, an annot — preview is a mode
    await press('Escape')
    expect(pressed(root, 'formDesignPreview')).toBe('true')

    await clickCmd(root, 'formDesignPreview')
    expect(pressed(root, 'formDesignPreview')).toBe('false')
    expect(progress(root)).toBe(t('formDesignEmptyHint'))
  })

  it('leaving the tab drops the armed tool, so it is not still armed on return', async () => {
    const root = await openEditor()
    await clickTab(root, 'formDesign')
    await clickCmd(root, 'formDesignRadio')
    expect(pressed(root, 'formDesignRadio')).toBe('true')

    await clickTab(root, 'home')
    await clickTab(root, 'formDesign')
    expect(pressed(root, 'formDesignRadio')).toBe('false')
    expect(progress(root)).toBe(t('formDesignEmptyHint'))
  })
})
