import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeEntry = { types: string[]; getType: (type: string) => Promise<{ text: () => Promise<string> }> }

/** Mirrors the raw-format address used by the main-process clipboard module. */
const rawFormat = (format: string) => `electron application/osclipboard;format="${format}"`

const ELEMENT_FORMAT = rawFormat('io.yiioffice.slides.elements')

const electron = vi.hoisted(() => ({
  clipboard: {
    read: vi.fn(),
    readText: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
  },
  nativeImage: {
    createFromBuffer: vi.fn(),
  },
  ClipboardItem: class ClipboardItem {
    constructor(public items: Record<string, unknown>) {}
  },
}))

vi.mock('electron', () => electron)

import {
  canWriteElementClipboardImage,
  elementClipboardMarkerMatches,
  writeElementClipboardImage,
} from '../src/main/element-clipboard'

const token = 'copy-token-1'

/** Clipboard entries shaped like Electron 45's async clipboard: values come back per MIME type. */
function entriesOf(values: Record<string, string | (() => string)>): FakeEntry[] {
  return [
    {
      types: Object.keys(values),
      async getType(type: string) {
        const value = values[type]
        const resolved = typeof value === 'function' ? value() : value
        return { text: async () => resolved ?? '' }
      },
    },
  ]
}

beforeEach(() => {
  electron.clipboard.read.mockReset().mockResolvedValue([])
  electron.clipboard.readText.mockReset().mockResolvedValue('')
  electron.clipboard.write.mockReset()
  electron.nativeImage.createFromBuffer.mockReset().mockImplementation((bytes: Buffer) => ({
    isEmpty: () => bytes.length === 0 || bytes[0] === 0,
    toPNG: () => Buffer.from('normalized-png'),
  }))
})

describe('element clipboard OS marker', () => {
  it('only recognizes the exact custom-format token as internal', async () => {
    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: token }))
    await expect(elementClipboardMarkerMatches(token)).resolves.toBe(true)

    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: `${token}-other` }))
    await expect(elementClipboardMarkerMatches(token)).resolves.toBe(false)
  })

  it('recognizes the token in the HTML image marker when custom formats are absent', async () => {
    electron.clipboard.read.mockResolvedValue(
      entriesOf({
        'text/html':
          '<img src="data:image/png;base64,cG5n" data-yiioffice-slides-elements="copy-token-1">',
      }),
    )

    await expect(elementClipboardMarkerMatches(token)).resolves.toBe(true)
  })

  it('rejects a stale token and an externally replaced clipboard before image write', async () => {
    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: 'new-token' }))
    const current = { token: 'new-token', senderId: 42 }

    await expect(canWriteElementClipboardImage(current, 42, token)).resolves.toBe(false)
    await expect(canWriteElementClipboardImage(current, 7, 'new-token')).resolves.toBe(false)
    await expect(canWriteElementClipboardImage(current, 42, 'new-token')).resolves.toBe(true)

    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: 'external-copy' }))
    await expect(canWriteElementClipboardImage(current, 42, 'new-token')).resolves.toBe(false)
  })
})

describe('element clipboard PNG writer', () => {
  it('writes normalized PNG and HTML marker in one clipboard operation', async () => {
    const decoded = { isEmpty: () => false, toPNG: () => Buffer.from('normalized-png') }
    electron.nativeImage.createFromBuffer.mockReturnValue(decoded)
    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: 'copy token' }))

    await expect(writeElementClipboardImage('copy token', 'cG5n')).resolves.toBe(true)

    expect(electron.clipboard.write).toHaveBeenCalledOnce()
    expect(electron.clipboard.write).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ items: { 'image/png': decoded } }),
        expect.objectContaining({
          items: {
            'text/html':
              '<img src="data:image/png;base64,bm9ybWFsaXplZC1wbmc=" data-yiioffice-slides-elements="copy%20token">',
          },
        }),
      ]),
    )
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledOnce()
  })

  it('does not overwrite an external copy made while PNG normalization runs', async () => {
    electron.clipboard.read.mockResolvedValue(entriesOf({ [ELEMENT_FORMAT]: token }))
    electron.nativeImage.createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => {
        electron.clipboard.read.mockResolvedValue(
          entriesOf({ [ELEMENT_FORMAT]: 'external-copy' }),
        )
        return Buffer.from('normalized-png')
      },
    })

    await expect(writeElementClipboardImage(token, 'cG5n')).resolves.toBe(false)
    expect(electron.clipboard.write).not.toHaveBeenCalled()
  })

  it('leaves the clipboard untouched for an empty or undecodable PNG', async () => {
    await expect(writeElementClipboardImage(token, '')).resolves.toBe(false)
    await expect(writeElementClipboardImage(token, 'AA==')).resolves.toBe(false)

    expect(electron.clipboard.write).not.toHaveBeenCalled()
  })

  it('leaves the clipboard untouched when PNG decoding throws', async () => {
    electron.nativeImage.createFromBuffer.mockImplementationOnce(() => {
      throw new Error('invalid PNG')
    })

    await expect(writeElementClipboardImage(token, 'cG5n')).resolves.toBe(false)
    expect(electron.clipboard.write).not.toHaveBeenCalled()
  })
})
