/**
 * Rebuilds the landing page's brand assets.
 *
 * The mark is a full-bleed blue square with no transparent rounding, so the site
 * rounds it in CSS. Small sizes are copied from the exported icon set instead of
 * being resampled here — hand-tuned 32/64px exports keep the glyph edges sharper
 * than `drawImage` downscaling can. This script also renders a 1200×630 social
 * card per locale, because a raw screenshot as `og:image` gets cropped by every
 * feed that expects 1.91:1.
 *
 * Run: BRAND_DIR=/path/to/logo-icons/brand npx tsx tools/build-site-brand.ts
 * Without BRAND_DIR the committed small marks are left alone and only the cards
 * are re-rendered, so a clean clone can regenerate those on its own.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'site/assets/brand')
const BRAND_DIR = process.env.BRAND_DIR ? resolve(process.env.BRAND_DIR) : null
/** 512×512 master, byte-identical to brand/logo-512.png of the exported set */
const MASTER = process.env.BRAND_MASTER
  ? resolve(process.env.BRAND_MASTER)
  : join(ROOT, 'apps/shell/build/icon.png')

/** exported size -> filename on the site; 256 backs the apple-touch-icon */
const COPIES = [
  ['logo-32.png', 'mark-32.png'],
  ['logo-64.png', 'mark-64.png'],
  ['logo-256.png', 'mark-256.png'],
] as const

interface Card {
  file: string
  lang: string
  headline: string
  sub: string
  footnote: string
}

const CARDS: Card[] = [
  {
    file: 'og-zh.png',
    lang: 'zh-CN',
    headline: '文件留在你的磁盘上。',
    sub: '原生读写 Word、Excel、PPT、PDF 与 Markdown 的桌面 Office 套件。',
    footnote: '本地优先 · 开源 · 零联网',
  },
  {
    file: 'og-en.png',
    lang: 'en',
    headline: 'Your files stay on your disk.',
    sub: 'A desktop office suite with native Word, Excel, PowerPoint, PDF and Markdown.',
    footnote: 'Local-first · Open source · Offline',
  },
]

async function dataUrl(path: string): Promise<string> {
  const buffer = await readFile(path)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

function cardHtml(markSrc: string, card: Card): string {
  // negative tracking is a Latin-only device: CJK glyphs fill their em box, so
  // -0.038em at 60px visibly collides 磁/盘/上
  const tracking = card.lang.startsWith('zh') ? '0' : '-0.036em'
  return `<!doctype html>
<html lang="${card.lang}">
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        flex-direction: column;
        padding: 84px 88px 64px;
        background: #ffffff;
        color: #0b0b0c;
        font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC",
          "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .lockup { display: flex; align-items: center; gap: 22px; }
      .lockup img { width: 76px; height: 76px; border-radius: 21px; display: block; }
      .lockup span { font-size: 42px; font-weight: 680; letter-spacing: -0.032em; }
      .body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
      h1 { font-size: 60px; font-weight: 660; letter-spacing: ${tracking}; line-height: 1.12; }
      p { margin-top: 20px; max-width: 880px; color: #6b6b73; font-size: 25px; line-height: 1.45; }
      footer {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding-top: 26px;
        border-top: 1px solid #e7e7e9;
        color: #8b8b93;
        font-size: 19px;
      }
      footer b { font-weight: 560; color: #4a4a52; }
    </style>
  </head>
  <body>
    <div class="lockup"><img src="${markSrc}" alt="" /><span>YiiOffice</span></div>
    <div class="body">
      <h1>${card.headline}</h1>
      <p>${card.sub}</p>
    </div>
    <footer><span>${card.footnote}</span><b>github.com/ethanbourne789/YiiOffice</b></footer>
  </body>
</html>`
}

async function main(): Promise<void> {
  if (!existsSync(MASTER)) throw new Error(`Missing brand master: ${MASTER}`)
  await mkdir(OUT_DIR, { recursive: true })

  if (BRAND_DIR) {
    for (const [source, target] of COPIES) {
      const from = join(BRAND_DIR, source)
      if (!existsSync(from)) throw new Error(`Missing exported icon: ${from}`)
      await copyFile(from, join(OUT_DIR, target))
      console.log(`  ${target}`.padEnd(26), 'copied')
    }
    // the exported .ico is tuned per size (16/32/48) and is a third the weight
    // of the app's own multi-size icon, so it is what the browser should get
    const ico = join(BRAND_DIR, 'favicon.ico')
    if (existsSync(ico)) {
      await copyFile(ico, join(ROOT, 'site/favicon.ico'))
      console.log('  favicon.ico'.padEnd(26), 'copied')
    }
  } else {
    console.log('  (BRAND_DIR not set — keeping the committed marks as they are)')
  }

  const mark = await dataUrl(MASTER)
  const browser = await chromium.launch()
  try {
    // render at 2× and downscale: a 1× capture lands the headline on a half
    // pixel inside the centred flex column, which smears the CJK strokes
    const card = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2,
    })
    for (const entry of CARDS) {
      await card.setContent(cardHtml(mark, entry), { waitUntil: 'load' })
      await card.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready)
      await card.waitForTimeout(400)
      const shot = await card.screenshot({ type: 'png' })
      const buffer = Buffer.from(
        (
          await card.evaluate(async (src) => {
            const image = new Image()
            image.src = src
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = 1200
            canvas.height = 630
            const ctx = canvas.getContext('2d')!
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(image, 0, 0, 1200, 630)
            return canvas.toDataURL('image/png')
          }, 'data:image/png;base64,' + shot.toString('base64'))
        ).replace(/^data:image\/png;base64,/, ''),
        'base64',
      )
      await writeFile(join(OUT_DIR, entry.file), buffer)
      console.log(`  ${entry.file}`.padEnd(26), `${(buffer.length / 1024).toFixed(1)} KB`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
