import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rasterizePdf } from '../src/formats/render'
import { run, tempDir, writeMinimalPdf } from './helpers'

describe('yiioffice slides render', () => {
  it('rasterizes every PDF page to PNG', async () => {
    const dir = tempDir()
    const pdf = writeMinimalPdf(join(dir, 'one.pdf'))
    const pages = await rasterizePdf(new Uint8Array(readFileSync(pdf)), 1)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.width).toBe(612)
    expect(pages[0]!.height).toBe(792)
    expect(Array.from(pages[0]!.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    await expect(rasterizePdf(new Uint8Array(readFileSync(pdf)), 1, 3)).rejects.toThrow(
      'out of range',
    )
  })
})