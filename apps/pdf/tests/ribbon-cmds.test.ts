/** The ribbon's `data-cmd` / `data-tab` hooks are a contract, not decoration:
    every test that drives the editor through the UI goes through them. This file
    pins the set each tab exposes, so a control that loses its hook (or gets
    renamed) fails here with the tab and the name in the message instead of
    surfacing as a mystery timeout in an unrelated test.

    Locale independence is the whole point: the label, `data-tip` and `aria-label`
    are all translated, so the e2e suite's `getByRole('button', { name: 'Rotate
    Left' })` stops matching when the app runs in English. `data-cmd` is the
    button's i18n key -- stable across languages, and traceable back to the label
    without a second naming scheme. */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cmdNames,
  clickTab,
  mountPdfApp,
  stubPdfApi,
  tab,
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

/** A one-page document, mounted. The ribbon only renders once a document is
    loaded -- the no-document state is a placeholder -- so every hook assertion
    needs real bytes behind it. */
async function mountWithDocument(): Promise<HTMLElement> {
  const bytes = await pdfWith('Hello')
  stubPdfApi({
    consumePending: async () => '/docs/queued.pdf',
    readFile: async () => bytes,
  })
  mounted = await mountPdfApp()
  await mounted.settle()
  return mounted.container
}

/** The quick-access bar sits above the tabs, so it is on screen on every tab. */
const QUICK_ACCESS = ['save', 'undo', 'redo']

/** Per tab, in document order. Conditional entries are called out where the
    default one-page document cannot reach them:
    - annotate: `redactClear`/`redactApply` appear only once a redaction is drawn
    - fillForm: `formPreviousField`/`formNextField` only for a fillable form
    - formDesign: `formDesignArrange-*` only while the arrange menu is open */
const EXPECTED: Record<string, string[]> = {
  home: [
    ...QUICK_ACCESS,
    'highlight',
    'highlightColor',
    'underline',
    'strikeout',
    'editText',
    'insertText',
    'convertPdf',
    'pageInput',
    'zoomOut',
    'zoomIn',
    'fitWidth',
    'fitPage',
    'search',
    'print',
    'exportImages',
    'props',
  ],
  annotate: [
    ...QUICK_ACCESS,
    'highlight',
    'highlightColor',
    'underline',
    'strikeout',
    'drawInk',
    'drawRect',
    'drawEllipse',
    'drawArrow',
    'drawNote',
    'redact',
    'sign',
    'drawColor',
  ],
  edit: [...QUICK_ACCESS, 'editText', 'insertText', 'insertImage', 'editImage', 'watermark'],
  page: [
    ...QUICK_ACCESS,
    'rotateLeft',
    'rotateRight',
    'rotateAllPages',
    'deletePage',
    'extractPage',
    'insertPdf',
    'insertBlankPage',
    'replacePages',
    'cropPages',
    'pageSize',
    'reversePages',
    'splitPdf',
    'mergePdf',
    'mergePages',
    'splitPages',
  ],
  view: [
    ...QUICK_ACCESS,
    'thumbs',
    'outline',
    'search',
    'spread',
    'nightMode',
    'pageInput',
    'zoomOut',
    'zoomIn',
    'fitWidth',
    'fitPage',
  ],
  fillForm: [
    ...QUICK_ACCESS,
    'formAddText',
    'formAddCheck',
    'formAddCross',
    'sign',
    'insertImage',
    'formComplete',
  ],
  formDesign: [
    ...QUICK_ACCESS,
    'formDesignText',
    'formDesignDate',
    'formDesignCheckbox',
    'formDesignRadio',
    'formDesignChoice',
    'formDesignSignature',
    'formDesignKeepTool',
    'formDesignPreview',
    'formDesignDetect',
    'formDesignArrange',
    'formDesignDelete',
  ],
}

describe('pdf ribbon command hooks', () => {
  it('exposes every ribbon tab', async () => {
    const root = await mountWithDocument()
    const ids = Object.keys(EXPECTED)
    const rendered = Array.from(root.querySelectorAll<HTMLElement>('[data-tab]')).map(
      (el) => el.getAttribute('data-tab') ?? '',
    )
    expect(rendered).toEqual(ids)
    // and every one of them is reachable by hook
    for (const id of ids) expect(tab(root, id).getAttribute('data-tab')).toBe(id)
  })

  it.each(Object.keys(EXPECTED))('lists the commands on the %s tab', async (id) => {
    const root = await mountWithDocument()
    await clickTab(root, id)
    expect(cmdNames(root)).toEqual(EXPECTED[id])
  })
})
