import { test, expect } from './fixture'
import {
  HEADLESS_EXPORT_FLAG,
  HEADLESS_EXIT,
  parseHeadlessExportArgv,
  formatHeadlessEnvelope,
  headlessModuleFor,
  headlessExitCode,
} from '@yiioffice/desktop-utils/headless-export'

/**
 * Headless export contract.
 *
 * Headless export is a CLI process (`<app> --headless-export input --to pdf
 * --out path`), not a browser UI feature, so its grammar and stdout envelope
 * are unit-tested upstream. Here we assert the executable contract the Wails
 * app actually consumes, so a change to the shared module's grammar surfaces
 * as a regression in this E2E suite too (Wails v3 "Run tests" best practice:
 * no-op specs are not allowed, each spec must assert something real).
 */
test.describe('headless export CLI contract', () => {
  test('routes supported input extensions to the owning editor module', () => {
    expect(headlessModuleFor('/tmp/report.docx')).toBe('docs')
    expect(headlessModuleFor('/tmp/sheet.xlsx')).toBe('sheets')
    expect(headlessModuleFor('/tmp/demo.pptx')).toBe('slides')
    expect(headlessModuleFor('/tmp/notes.md')).toBe('markdown')
    expect(headlessModuleFor('/tmp/archive.zip')).toBeNull()
    expect(headlessModuleFor('/tmp/no-extension')).toBeNull()
  })

  test('parses the full headless request from argv', () => {
    const parsed = parseHeadlessExportArgv([
      '/usr/bin/yiioffice',
      HEADLESS_EXPORT_FLAG,
      '/tmp/report.docx',
      '--to',
      'pdf',
      '--out',
      '/tmp/report.pdf',
      '--json',
    ])
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    expect(parsed.request).toEqual({
      input: '/tmp/report.docx',
      targetFormat: 'pdf',
      outPath: '/tmp/report.pdf',
      json: true,
    })
  })

  test('reports a clean exit code and one-line JSON envelope on success', () => {
    const outcome: { ok: true; input: string; outPath: string } = {
      ok: true,
      input: '/tmp/report.docx',
      outPath: '/tmp/report.pdf',
    }
    expect(headlessExitCode(outcome)).toBe(HEADLESS_EXIT.success)
    const envelope = formatHeadlessEnvelope(outcome, true)
    const object = JSON.parse(envelope) as Record<string, unknown>
    expect(object.status).toBe('ok')
    expect(object.output_path).toBe('/tmp/report.pdf')
    // exactly one newline-terminated line: the CLI stdout contract
    expect(envelope.split('\n').filter((l) => l.length > 0)).toHaveLength(1)
  })

  test('rejects a missing output path with the bad-args exit code', () => {
    const parsed = parseHeadlessExportArgv([
      'yiioffice',
      HEADLESS_EXPORT_FLAG,
      '/tmp/report.docx',
      '--to',
      'pdf',
    ])
    expect(parsed.kind).toBe('error')
    if (parsed.kind !== 'ok') {
      expect(parsed.kind).toBe('error')
      expect(parsed.message).toMatch(/--out/)
    }
  })

  test('returns kind none when the headless flag is absent (normal GUI start)', () => {
    expect(parseHeadlessExportArgv(['yiioffice', '--open', '/tmp/a.docx']).kind).toBe(
      'none',
    )
  })
})