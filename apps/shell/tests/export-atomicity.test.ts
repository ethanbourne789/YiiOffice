import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const mockedRename = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  rename: mockedRename,
}))

import { atomicWriteFile } from '../src/main/atomic-write'

const root = join(__dirname, '../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const section = (source: string, start: string, end: string) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

describe('atomic export destinations', () => {
  it('keeps an existing destination intact when a temporary write fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yiioffice-export-atomic-'))
    const target = join(dir, 'report.docx')
    writeFileSync(target, 'old')
    try {
      await expect(
        atomicWriteFile(target, { byteLength: -1 } as unknown as Uint8Array),
      ).rejects.toThrow()
      expect(readFileSync(target, 'utf8')).toBe('old')
      expect(readdirSync(dir)).toEqual(['report.docx'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the destination intact when publishing the temporary file fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yiioffice-export-rename-'))
    const target = join(dir, 'report.docx')
    writeFileSync(target, 'old')
    mockedRename.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EPERM' }))
    try {
      await expect(atomicWriteFile(target, 'new')).rejects.toMatchObject({ code: 'EPERM' })
      expect(readFileSync(target, 'utf8')).toBe('old')
      expect(readdirSync(dir)).toEqual(['report.docx'])
    } finally {
      mockedRename.mockReset()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not contain a direct destination-write fallback', () => {
    const source = read('apps/shell/src/main/atomic-write.ts')
    expect(source).not.toContain('await writeFile(filePath, data)')
  })

  it('publishes every Docs export through a temporary file', () => {
    const source = read('apps/docs/src/main/docs-main.ts')
    const pdf = section(source, "'docs:export-pdf'", "'docs:save-image-as'")
    const image = section(source, "'docs:write-export-image'", "'docs:export-html'")
    const html = section(source, "'docs:export-html'", "'docs:print-pdf-buffer'")
    const merged = section(source, "'docs:save-merged-pdf'", "'win:new'")

    expect(pdf).toContain('await atomicWriteFile(filePath, data)')
    expect(image).toMatch(/await atomicWriteFile\(\s*filePath,/)
    expect(html).toMatch(/await atomicWriteFile\(\s*filePath,/)
    expect(merged).toMatch(/await atomicWriteFile\(\s*filePath,/)
    expect(`${pdf}${image}${html}${merged}`).not.toMatch(/writeFile(?:Sync)?\(filePath/)
  })

  it('publishes Sheets PDF exports through a temporary file', () => {
    const source = read('apps/sheets/src/main/pdf-export.ts')
    const pdf = section(
      source,
      'export async function exportPdf',
      'export async function printWorkbook',
    )

    expect(pdf).toContain('await atomicWriteFile(selection.filePath, pdf)')
    expect(pdf).not.toContain('writeFile(selection.filePath')
  })

  it('publishes Shell PDF conversions through a temporary file', () => {
    // the three conversions share one driver (shell-pdf-export.ts); it is the
    // only place that hands converted bytes to the filesystem
    const source = read('apps/shell/src/main/shell-pdf-export.ts')
    const driver = section(source, 'async function runPdfOfficeExport', 'function pdfLoadErrorDetail')
    const docx = section(source, 'export function exportPdfAsDocxLocal', 'export function exportPdfAsPptxLocal')
    const pptx = section(source, 'export function exportPdfAsPptxLocal', 'export function exportPdfAsXlsxLocal')
    const xlsx = section(source, 'export function exportPdfAsXlsxLocal', 'ipcMain.handle(PDF_CHANNELS.convertOffice')

    expect(driver).toContain('await atomicWriteFile(picked.filePath, spec.bytes(result))')
    expect(driver).not.toMatch(/writeFileSync\(picked\.filePath/)
    // each format only names the field its converter returned
    expect(docx).toContain('bytes: (result) => result.docx')
    expect(pptx).toContain('bytes: (result) => result.pptx')
    expect(xlsx).toContain('bytes: (result) => result.xlsx')
  })
})
