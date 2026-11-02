import { afterEach, describe, expect, it, vi } from 'vitest'

const slidesBindings = vi.hoisted(() => ({
  OpenPath: vi.fn(),
  FilesRead: vi.fn(),
  FilesReadImage: vi.fn(),
  FilesAdd: vi.fn(),
  PickFiles: vi.fn(),
  Opened: vi.fn(),
  Save: vi.fn(),
  SaveAs: vi.fn(),
}))

const exportBindings = vi.hoisted(() => ({
  ExportPdf: vi.fn(),
  ExportHtml: vi.fn(),
  RenderPdfBase64: vi.fn(),
  MergePdfParts: vi.fn(),
  PickExportFolder: vi.fn(),
  TakeTempPdf: vi.fn(),
  WriteBase64File: vi.fn(),
  PickSaveFile: vi.fn(),
  ListPrinters: vi.fn(),
}))

vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/slidesservice', () => slidesBindings)
vi.mock('@bindings/gitee.com/ethanbourne789/yiioffice/internal/bridge/exportservice', () => exportBindings)
vi.mock('./tabs-bridge', () => ({ currentTabPath: vi.fn(async () => '') }))
vi.mock('./transport', () => ({ on: vi.fn(() => () => undefined) }))

import { createSlidesDesktopApi } from './slides-bridge'

const api = createSlidesDesktopApi()

afterEach(() => {
  vi.clearAllMocks()
})

describe('slides bridge pickExportDir', () => {
  it('returns the picked directory', async () => {
    exportBindings.PickExportFolder.mockResolvedValueOnce({ dir: 'C:\\out', pdfPath: '' })
    await expect(api.pickExportDir()).resolves.toBe('C:\\out')
    expect(exportBindings.PickExportFolder).toHaveBeenCalledWith('Export as Images')
  })

  it('maps a canceled dialog to null', async () => {
    exportBindings.PickExportFolder.mockResolvedValueOnce({ dir: '', pdfPath: '' })
    await expect(api.pickExportDir()).resolves.toBeNull()
  })

  it('rejects when the dialog is unavailable (never a fake cancel)', async () => {
    exportBindings.PickExportFolder.mockRejectedValueOnce(new Error('app not available'))
    await expect(api.pickExportDir()).rejects.toThrow('app not available')
  })
})

describe('slides bridge pickExportPdfPath', () => {
  it('returns the chosen save path', async () => {
    exportBindings.PickSaveFile.mockResolvedValueOnce('C:\\out\\deck.pdf')
    await expect(api.pickExportPdfPath('deck.pdf')).resolves.toBe('C:\\out\\deck.pdf')
    expect(exportBindings.PickSaveFile).toHaveBeenCalledWith('deck.pdf', 'pdf')
  })

  it('maps a canceled dialog to null', async () => {
    exportBindings.PickSaveFile.mockResolvedValueOnce('')
    await expect(api.pickExportPdfPath('deck.pdf')).resolves.toBeNull()
  })
})

describe('slides bridge exportImages', () => {
  it('writes every page as <baseName>-NN.png and returns the paths', async () => {
    exportBindings.WriteBase64File.mockImplementation(async (path: string) => ({ ok: true, path }))
    const r = await api.exportImages({
      dir: 'C:\\out\\',
      baseName: 'deck',
      pngsBase64: ['AAA', 'BBB'],
    })
    expect(r).toEqual({ ok: true, paths: ['C:\\out/deck-01.png', 'C:\\out/deck-02.png'] })
    expect(exportBindings.WriteBase64File).toHaveBeenNthCalledWith(1, 'C:\\out/deck-01.png', 'AAA')
    expect(exportBindings.WriteBase64File).toHaveBeenNthCalledWith(2, 'C:\\out/deck-02.png', 'BBB')
  })

  it('reports the first write failure instead of a fake success', async () => {
    exportBindings.WriteBase64File
      .mockResolvedValueOnce({ ok: true, path: 'C:\\out/deck-01.png' })
      .mockResolvedValueOnce({ ok: false, error: 'disk full' })
    const r = await api.exportImages({ dir: 'C:\\out', baseName: 'deck', pngsBase64: ['AAA', 'BBB', 'CCC'] })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('disk full')
    expect(r.paths).toBeUndefined()
    expect(exportBindings.WriteBase64File).toHaveBeenCalledTimes(2)
  })

  it('catches binding rejections as a visible error', async () => {
    exportBindings.WriteBase64File.mockRejectedValueOnce(new Error('boom'))
    const r = await api.exportImages({ dir: 'C:\\out', baseName: 'deck', pngsBase64: ['AAA'] })
    expect(r).toEqual({ ok: false, error: 'boom' })
  })

  it('rejects an op without a directory', async () => {
    const r = await api.exportImages({ dir: '', baseName: 'deck', pngsBase64: ['AAA'] })
    expect(r.ok).toBe(false)
    expect(exportBindings.WriteBase64File).not.toHaveBeenCalled()
  })
})

describe('slides bridge exportPdf', () => {
  const op = {
    filePath: 'C:\\out\\deck.pdf',
    pages: [{ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"></svg>' }],
    widthPx: 1280,
    heightPx: 720,
  }

  it('assembles the print HTML and renders to the chosen path', async () => {
    exportBindings.ExportPdf.mockResolvedValueOnce({ ok: true, path: op.filePath })
    const r = await api.exportPdf(op)
    expect(r).toEqual({ ok: true, path: op.filePath })
    const [html, outPath, name, widthIn, heightIn] = exportBindings.ExportPdf.mock.calls[0]
    expect(outPath).toBe('C:\\out\\deck.pdf')
    expect(name).toBe('deck.pdf')
    expect(widthIn).toBeCloseTo(1280 / 96, 6)
    expect(heightIn).toBeCloseTo(720 / 96, 6)
    expect(html).toContain('<div class="slide-page" id="pg1">')
    expect(html).toContain('<svg')
  })

  it('passes a Go-side failure through', async () => {
    exportBindings.ExportPdf.mockResolvedValueOnce({ ok: false, error: 'export pdf: edge not found' })
    const r = await api.exportPdf(op)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('export pdf: edge not found')
  })

  it('catches binding rejections as a visible error', async () => {
    exportBindings.ExportPdf.mockRejectedValueOnce(new Error('render crashed'))
    const r = await api.exportPdf(op)
    expect(r).toMatchObject({ ok: false, error: 'render crashed' })
  })

  it('refuses an op without pages or a target path', async () => {
    expect((await api.exportPdf({ ...op, pages: [] })).ok).toBe(false)
    expect((await api.exportPdf({ ...op, filePath: '' })).ok).toBe(false)
    expect(exportBindings.ExportPdf).not.toHaveBeenCalled()
  })
})
