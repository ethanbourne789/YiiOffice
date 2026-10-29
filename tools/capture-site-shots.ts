/**
 * Captures the marketing screenshots used by site/ (GitHub Pages landing page).
 *
 * Boots the real built shell against a scratch userData dir, opens a sample
 * document per editor, and writes light + dark shots of the shell home and each
 * editor — once per UI language, because the landing page ships a Chinese and an
 * English edition and the chrome inside the shots has to match. PNG frames are
 * re-encoded to WebP through Chromium so the page stays light.
 *
 * Run: npx tsx tools/capture-site-shots.ts   (after `npm run build:all`)
 * Env: SHOT=sheets  LOCALES=en   narrow the run while iterating on framing
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type ElectronApplication, type Page } from '@playwright/test'
import { launchShell, waitForPageWithUrl } from '../e2e/helpers'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'site/assets/screens')
const RAW_DIR = join(tmpdir(), 'yiioffice-shot-raw')
const VIEW = { width: 1600, height: 1000 } as const

type Theme = 'light' | 'dark'
type Locale = 'zh' | 'en'

interface Shot {
  name: string
  /** undefined = capture the shell window itself (home) */
  urlPart?: string
  file?: string
  /** crop the bottom empty band the shell leaves below the file list */
  clipHeight?: number
}

/* ------------------------------------------------------------------- copy */

interface SampleCopy {
  folder: string
  files: Record<'report' | 'sales' | 'deck' | 'review' | 'notes', string>
  docx: {
    kicker: string
    title: string
    intro: string
    sections: Array<{ heading: string; paragraphs: string[]; table?: boolean }>
    tableHead: [string, string, string, string]
    tableRows: Array<[string, string, string, string]>
    note: string
  }
  xlsx: {
    sheet: string
    head: [string, string, string, string, string, string]
    /** region, product line, orders, revenue, yoy, share */
    rows: Array<[string, string, number, number, number, number]>
  }
  pptx: {
    kicker: string
    title: string
    sub: string
    bulletsTitle: string
    bullets: string[]
    chartTitle: string
    series: string
  }
  md: string
}

export const COPY: Record<Locale, SampleCopy> = {
  zh: {
    folder: '工作文档',
    files: {
      report: '年度运营报告.docx',
      sales: '区域销售.xlsx',
      deck: '产品发布.pptx',
      review: '季度评审.pdf',
      notes: '发布说明.md',
    },
    docx: {
      kicker: '运营中心 · 年度报告',
      title: '2026 年度运营报告',
      intro:
        '本年度的主线是把交付从「按项目排期」改成「按版本节奏」。四个季度里，我们把发布周期从六周压缩到两周，同时把客户侧的可见变更全部搬到了版本说明里。',
      sections: [
        {
          heading: '一、全年概览',
          paragraphs: [
            '全年营业收入 2,376 万元，同比增长 29.0%；毛利率 52.7%，较上年提升 4.5 个百分点。增长主要来自中大型客户的续约扩张，而不是新客获取成本的下降。',
            '团队规模从 3,410 人扩张到 5,286 人，其中工程与设计占比 46%。人员扩张集中在第二、第三季度，第四季度基本停止招聘，转为内部培养。',
          ],
        },
        { heading: '二、关键指标', paragraphs: [], table: true },
        {
          heading: '三、区域表现',
          paragraphs: [
            '华东依然是收入主体，贡献 42% 的营业收入；华南与华北的增速更快，分别为 34% 与 31%。西南区域的试点在第四季度跑通，明年会作为独立区域核算。',
            '海外业务仍处在早期，收入占比不足 4%。我们暂时不打算为其单独建立销售团队，而是跟随现有客户的海外分支自然增长。',
          ],
        },
        {
          heading: '四、明年的三件事',
          paragraphs: [
            '第一，把版本节奏稳定在两周，不再为单个客户插入计划外的排期。',
            '第二，把文档、表格、演示三条线的保存链路统一到同一套补丁回写逻辑上，减少格式回归。',
            '第三，把内部工具的维护成本压到收入的 5% 以内，超出的部分一律砍掉或外包。',
          ],
        },
      ],
      tableHead: ['指标', '2025 年', '2026 年', '变化'],
      tableRows: [
        ['营业收入', '1,842 万元', '2,376 万元', '+29.0%'],
        ['毛利率', '48.2%', '52.7%', '+4.5 pt'],
        ['活跃团队', '3,410', '5,286', '+55.0%'],
      ],
      note: '注：毛利率按新口径计算，已剔除一次性交付成本；与 2025 年数据不可直接比较。',
    },
    xlsx: {
      sheet: '区域销售',
      head: ['区域', '产品线', '订单数', '收入(万元)', '同比', '占比'],
      rows: [
        ['华东', '文档', 1284, 1062, 0.31, 0.447],
        ['华东', '表格', 742, 598, 0.24, 0.252],
        ['华南', '文档', 986, 812, 0.34, 0.342],
        ['华南', '表格', 528, 401, 0.19, 0.169],
        ['华北', '文档', 1142, 943, 0.29, 0.397],
        ['华北', '表格', 611, 468, 0.22, 0.197],
        ['西南', '文档', 312, 244, 0.41, 0.103],
        ['西南', '表格', 188, 146, 0.28, 0.061],
      ],
    },
    pptx: {
      kicker: 'YIIOFFICE · 0.13',
      title: '文件留在你的磁盘上',
      sub: '一个本地优先的 Office 套件：原生读写 Word、Excel、PPT 与 PDF。',
      bulletsTitle: '这一版做了什么',
      bullets: [
        '字节保真保存：只重写被改动的 XML 节点',
        '原子写入：临时文件 + rename，崩溃不留半份文件',
        '本地全文搜索：FTS5 + CJK 双流分词',
        '无界面导出：不弹窗口转 PDF',
      ],
      chartTitle: '五个编辑器（月度新增）',
      series: '打开次数',
    },
    md: `# 发布说明 · 0.13.0

这个版本把「保存不丢格式」这条主线做完了，同时删掉了最后一个会往外发请求的入口。

## 新增

- 字节保真保存：只重写被修改的 XML 节点
- 原子写入：临时文件 + rename
- 本地全文搜索：FTS5 + CJK 双流分词

> 文件双击就开，断网一个功能不少。

## 打开速度

| 文件类型 | 上一版 | 这一版 |
| --- | --- | --- |
| .docx（20 页） | 1.8 s | 0.9 s |
| .xlsx（8 万行） | 4.2 s | 2.6 s |
| .pptx（40 页） | 2.4 s | 1.3 s |

\`\`\`bash
npm install
npm run dev
\`\`\`

## 流程图

\`\`\`mermaid
flowchart LR
  A[打开文件] --> B[解析 OOXML]
  B --> C[只改动编辑过的节点]
  C --> D[临时文件]
  D --> E[rename 落盘]
\`\`\`
`,
  },

  en: {
    folder: 'Work',
    files: {
      report: 'Annual-Report-2026.docx',
      sales: 'Regional-Sales.xlsx',
      deck: 'Product-Launch.pptx',
      review: 'Quarterly-Review.pdf',
      notes: 'Release-Notes.md',
    },
    docx: {
      kicker: 'OPERATIONS · ANNUAL REPORT',
      title: 'Operations Report 2026',
      intro:
        'The thread this year was moving delivery from project-by-project scheduling to a release cadence. Across four quarters we cut the cycle from six weeks to two, and moved every customer-visible change into the release notes.',
      sections: [
        {
          heading: '1. The year at a glance',
          paragraphs: [
            'Revenue reached ¥23.76M, up 29.0% year over year, with gross margin at 52.7% — a 4.5 point improvement. Growth came from expansion inside existing mid-market and enterprise accounts, not from cheaper acquisition.',
            'Headcount grew from 3,410 to 5,286, with engineering and design at 46%. Hiring was concentrated in Q2 and Q3; Q4 stopped external hiring and switched to internal development.',
          ],
        },
        { heading: '2. Key metrics', paragraphs: [], table: true },
        {
          heading: '3. Regional performance',
          paragraphs: [
            'East China remains the core at 42% of revenue. South and North grew faster, at 34% and 31%. The Southwest pilot closed its first full quarter and will be reported as its own region next year.',
            'Overseas business is still early, under 4% of revenue. We are not building a dedicated sales team for it; it will follow the overseas branches of existing customers.',
          ],
        },
        {
          heading: '4. Three things for next year',
          paragraphs: [
            'First, hold the cadence at two weeks and stop inserting off-plan work for single customers.',
            'Second, unify the save paths of the document, spreadsheet and presentation editors onto one patch layer, to cut format regressions.',
            'Third, keep internal tooling under 5% of revenue; anything above that gets cut or outsourced.',
          ],
        },
      ],
      tableHead: ['Metric', '2025', '2026', 'Change'],
      tableRows: [
        ['Revenue', '¥18.42M', '¥23.76M', '+29.0%'],
        ['Gross margin', '48.2%', '52.7%', '+4.5 pt'],
        ['Active teams', '3,410', '5,286', '+55.0%'],
      ],
      note: 'Note: gross margin uses the new definition and excludes one-off delivery costs, so it is not directly comparable with 2025.',
    },
    xlsx: {
      sheet: 'Regional sales',
      head: ['Region', 'Product line', 'Orders', 'Revenue $K', 'YoY', 'Share'],
      rows: [
        ['East', 'Docs', 1284, 1062, 0.31, 0.447],
        ['East', 'Sheets', 742, 598, 0.24, 0.252],
        ['South', 'Docs', 986, 812, 0.34, 0.342],
        ['South', 'Sheets', 528, 401, 0.19, 0.169],
        ['North', 'Docs', 1142, 943, 0.29, 0.397],
        ['North', 'Sheets', 611, 468, 0.22, 0.197],
        ['Southwest', 'Docs', 312, 244, 0.41, 0.103],
        ['Southwest', 'Sheets', 188, 146, 0.28, 0.061],
      ],
    },
    pptx: {
      kicker: 'YIIOFFICE · 0.13',
      title: 'Your files stay on your disk',
      sub: 'A local-first office suite with native Word, Excel, PowerPoint and PDF support.',
      bulletsTitle: 'What this release changes',
      bullets: [
        'Byte-faithful saves: only the edited XML nodes are rewritten',
        'Atomic writes: temp file plus rename, so a crash never leaves half a file',
        'Local full-text search: FTS5 with CJK-aware segmentation',
        'Headless export: convert to PDF without opening a window',
      ],
      chartTitle: 'Five editors (monthly opens)',
      series: 'Opens',
    },
    md: `# Release notes · 0.13.0

This release closes out the "save without losing formatting" work and removes the last code path that reached the network.

## Added

- Byte-faithful saves: only the edited XML nodes are rewritten
- Atomic writes: temp file plus rename
- Local full-text search: FTS5 with CJK-aware segmentation

> Double-click a file and it opens; offline costs you nothing.

## Open times

| File type | Previous | This release |
| --- | --- | --- |
| .docx (20 pages) | 1.8 s | 0.9 s |
| .xlsx (80k rows) | 4.2 s | 2.6 s |
| .pptx (40 slides) | 2.4 s | 1.3 s |

\`\`\`bash
npm install
npm run dev
\`\`\`

## Flow

\`\`\`mermaid
flowchart LR
  A[Open file] --> B[Parse OOXML]
  B --> C[Patch edited nodes only]
  C --> D[Temp file]
  D --> E[Rename into place]
\`\`\`
`,
  },
}

/* ------------------------------------------------------------------ samples */

async function buildReportDocx(path: string, copy: SampleCopy): Promise<void> {
  const docx = await import('docx')
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
  } = docx

  const c = copy.docx
  const h2 = (text: string) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } })
  const p = (text: string) =>
    new Paragraph({ spacing: { after: 120, line: 300 }, children: [new TextRun({ text, size: 21 })] })

  const cell = (text: string, bold = false) =>
    new TableCell({
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold, size: 20 })],
          alignment: AlignmentType.LEFT,
        }),
      ],
    })

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'C9D2DC' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9D2DC' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'C9D2DC' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'C9D2DC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E7ED' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E7ED' },
    },
    rows: [
      new TableRow({ children: c.tableHead.map((t) => cell(t, true)) }),
      ...c.tableRows.map((row) => new TableRow({ children: row.map((t) => cell(t)) })),
    ],
  })

  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  const body: Block[] = []
  for (const section of c.sections) {
    body.push(h2(section.heading))
    for (const text of section.paragraphs) body.push(p(text))
    if (section.table) {
      body.push(table)
      body.push(
        new Paragraph({
          spacing: { before: 120, after: 200 },
          children: [
            new TextRun({ text: c.note, italics: true, size: 18, color: '7A8592' }),
          ],
        }),
      )
    }
  }

  const document = new Document({
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1247, right: 1247 } },
        },
        children: [
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: c.kicker, size: 18, color: '7A8592' })],
          }),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { after: 120 },
            children: [new TextRun({ text: c.title, bold: true, size: 44 })],
          }),
          p(c.intro),
          ...body,
        ],
      },
    ],
  })

  await writeFile(path, await Packer.toBuffer(document))
}

/**
 * A real .xlsx rather than a CSV: opening a CSV makes the app convert it on the
 * fly, which leaves a "streaming <uuid>.xlsx" note in the status bar. Styling
 * lives in the file so the shot needs no post-load massaging.
 */
export async function buildSalesXlsx(path: string, copy: SampleCopy): Promise<void> {
  const JSZip = (await import('jszip')).default
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

  const { head, rows: data, sheet: sheetName } = copy.xlsx

  /** column index -> cell style: 1 header, 2 text, 3 number, 4 percentage */
  const styleForColumn = (c: number): string => (c >= 4 ? '4' : c >= 2 ? '3' : '2')

  const column = (index: number): string => String.fromCharCode(65 + index)
  const esc = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const rows: Array<Array<string | number>> = [head, ...data]

  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${column(c)}${r + 1}`
          if (r === 0) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`
          if (typeof value === 'number') return `<c r="${ref}" s="${styleForColumn(c)}"><v>${value}</v></c>`
          return `<c r="${ref}" s="2" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}"${r === 0 ? ' ht="24" customHeight="1"' : ''}>${cells}</row>`
    })
    .join('')

  // English headers are wider than the two-character Chinese ones
  const widths = Object.is(copy, COPY.en) ? [13, 15, 11, 14, 9, 9] : [11, 11, 12, 15, 10, 10]

  const sheet =
    `${XML}<worksheet xmlns="${NS}">` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="20"/>' +
    '<cols>' +
    widths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join('') +
    '</cols>' +
    `<sheetData>${sheetRows}</sheetData></worksheet>`

  const styles =
    `${XML}<styleSheet xmlns="${NS}">` +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border>' +
    '<left style="thin"><color rgb="FFD8DEE6"/></left>' +
    '<right style="thin"><color rgb="FFD8DEE6"/></right>' +
    '<top style="thin"><color rgb="FFD8DEE6"/></top>' +
    '<bottom style="thin"><color rgb="FFD8DEE6"/></bottom>' +
    '<diagonal/>' +
    '</border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="right"/></xf>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="right"/></xf>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="right"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}">` +
      `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
      '</Relationships>',
  )
  zip.file('xl/styles.xml', styles)
  zip.file('xl/worksheets/sheet1.xml', sheet)

  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function buildDeckPptx(path: string, copy: SampleCopy): Promise<void> {
  const mod = await import('pptxgenjs')
  const PptxGenJS = (mod as unknown as { default: new () => any }).default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  const ink = '101418'
  const muted = '5F6A75'
  const accent = '0F7FFF'
  const c = copy.pptx

  const cover = pptx.addSlide()
  cover.background = { color: 'FFFFFF' }
  cover.addText(c.kicker, {
    x: 0.7,
    y: 0.9,
    w: 8,
    h: 0.3,
    fontSize: 11,
    color: accent,
    charSpacing: 2,
  })
  cover.addText(c.title, {
    x: 0.7,
    y: 1.35,
    w: 8,
    h: 1.1,
    fontSize: 40,
    bold: true,
    color: ink,
  })
  cover.addText(c.sub, {
    x: 0.7,
    y: 2.55,
    w: 7.4,
    h: 0.6,
    fontSize: 14,
    color: muted,
  })
  cover.addShape('rect', { x: 0.7, y: 3.5, w: 1.6, h: 0.06, fill: { color: accent } })

  const bullets = pptx.addSlide()
  bullets.addText(c.bulletsTitle, {
    x: 0.7,
    y: 0.6,
    w: 8,
    h: 0.6,
    fontSize: 26,
    bold: true,
    color: ink,
  })
  bullets.addText(
    c.bullets.map((text) => ({ text, options: { bullet: true } })),
    { x: 0.8, y: 1.5, w: 7.8, h: 3, fontSize: 16, color: muted, lineSpacing: 34 },
  )

  const chart = pptx.addSlide()
  chart.addText(c.chartTitle, {
    x: 0.7,
    y: 0.55,
    w: 8,
    h: 0.5,
    fontSize: 20,
    bold: true,
    color: ink,
  })
  chart.addChart(
    pptx.ChartType.bar,
    [
      {
        name: c.series,
        labels: ['Docs', 'Sheets', 'Slides', 'PDF', 'Markdown'],
        values: [4820, 3910, 2140, 1680, 1220],
      },
    ],
    {
      x: 0.7,
      y: 1.2,
      w: 8.4,
      h: 3.6,
      barDir: 'col',
      showLegend: false,
      showValue: false,
      chartColors: [accent],
      catAxisLabelColor: muted,
      valAxisLabelColor: muted,
      valGridLine: { color: 'E4E7EC', size: 1 },
      catGridLine: { style: 'none' },
    },
  )
  await pptx.writeFile({ fileName: path })
}

async function buildReviewPdf(path: string): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)

  const ink = rgb(0.06, 0.08, 0.1)
  const muted = rgb(0.42, 0.47, 0.52)
  const rule = rgb(0.86, 0.89, 0.92)

  let y = 760
  page.drawText('QUARTERLY REVIEW  /  Q3 2026', { x: 56, y, size: 8, font: mono, color: muted })
  y -= 34
  page.drawText('Saving without losing formatting', { x: 56, y, size: 22, font: bold, color: ink })
  y -= 22
  page.drawText('Byte-faithful OOXML patches and atomic writes', {
    x: 56,
    y,
    size: 11,
    font: regular,
    color: muted,
  })
  y -= 18
  page.drawLine({ start: { x: 56, y }, end: { x: 539, y }, thickness: 1, color: rule })

  const body = [
    'Opening a document and saving it back used to be the riskiest part of the product.',
    'A single round trip through the renderer could drop a custom style, an embedded',
    'object or a macro that the user never touched. The patch layer fixes that: the',
    'engine parses the original package, rewrites only the nodes the editor changed,',
    'and copies every other byte through untouched.',
    '',
    'Every save now goes through a temporary file followed by a rename, so a crash',
    'or a power cut leaves either the old file or the new one, never a half-written',
    'package. The same path is used by the headless exporter, which means the CLI',
    'and the GUI cannot drift apart.',
  ]
  y -= 26
  for (const line of body) {
    if (line) page.drawText(line, { x: 56, y, size: 10.5, font: regular, color: ink })
    y -= 17
  }

  y -= 14
  page.drawText('What changed this quarter', { x: 56, y, size: 12, font: bold, color: ink })
  y -= 20
  const rows: Array<[string, string, string]> = [
    ['Area', 'Before', 'After'],
    ['Formatting loss', '3 known cases', '0 known cases'],
    ['Save duration', '1.8 s', '0.4 s'],
    ['Half-written files', 'rare, unreported', 'structurally impossible'],
  ]
  for (const [index, row] of rows.entries()) {
    const font = index === 0 ? bold : regular
    page.drawText(row[0], { x: 56, y, size: 10, font, color: index === 0 ? ink : muted })
    page.drawText(row[1], { x: 250, y, size: 10, font, color: ink })
    page.drawText(row[2], { x: 400, y, size: 10, font, color: ink })
    y -= 18
    page.drawLine({ start: { x: 56, y: y + 12 }, end: { x: 539, y: y + 12 }, thickness: 0.5, color: rule })
  }

  y -= 18
  for (const line of [
    'The remaining gap is the renderer: three files still hold more than two thousand',
    'lines each. Splitting them is planned for Q4, behind the session-restore work.',
  ]) {
    page.drawText(line, { x: 56, y, size: 10.5, font: regular, color: ink })
    y -= 17
  }

  page.drawText('1 / 4', { x: 56, y: 40, size: 8, font: mono, color: muted })
  page.drawText('YiiOffice internal review - not for distribution', {
    x: 320,
    y: 40,
    size: 8,
    font: regular,
    color: muted,
  })

  await writeFile(path, await doc.save())
}

async function buildNotesMd(path: string, copy: SampleCopy): Promise<void> {
  await writeFile(path, copy.md, 'utf8')
}

/* ------------------------------------------------------------------ launcher */

/**
 * launchShell writes app-settings.json itself when `settings` is passed, so the
 * theme and folder roots go through it; only recent.json is seeded here.
 */
async function prepareUserData(recent: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yiioffice-shot-'))
  await writeFile(join(dir, 'recent.json'), JSON.stringify(recent, null, 2))
  return dir
}

async function capture(
  locale: Locale,
  theme: Theme,
  shot: Shot,
  samplesDir: string,
  recent: string[],
  workDir: string,
): Promise<string> {
  const userDataDir = await prepareUserData(recent)
  const launched = await launchShell({
    userDataDir,
    lang: locale === 'en' ? 'en' : 'zh-CN',
    onboardingSeen: true,
    settings: {
      theme,
      documentTheme: theme,
      defaultSaveDir: samplesDir,
    },
    videoDir: 'site-shots',
    openFile: shot.file,
    env: { YIIOFFICE_DEBUG_HOOKS: '1' },
  })

  const target = await resize(launched.app, launched.page, shot.urlPart)
  await settle(target, shot.name, theme, locale)

  const png = join(workDir, `${shot.name}-${theme}-${locale}.png`)
  await target.screenshot({
    path: png,
    scale: 'css',
    animations: 'disabled',
    ...(shot.clipHeight
      ? { clip: { x: 0, y: 0, width: VIEW.width, height: shot.clipHeight } }
      : {}),
  })
  await closeApp(launched.app)
  return png
}

async function resize(
  app: ElectronApplication,
  shell: Page,
  urlPart?: string,
): Promise<Page> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      // setBounds keeps the requested size even when the desktop is smaller
      win.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    },
    { width: VIEW.width, height: VIEW.height },
  )
  await shell.waitForTimeout(600)
  if (!urlPart) return shell
  const page = await waitForPageWithUrl(app, urlPart)
  await page.waitForTimeout(400)
  return page
}

/** let fonts, charts and canvas frames land before the shutter */
async function settle(page: Page, name: string, theme: Theme, locale: Locale): Promise<void> {
  const extra =
    name === 'sheets' ? 2500 : name === 'slides' ? 2200 : name === 'pdf' ? 2600 : 1600
  await page.waitForTimeout(extra)
  if (name === 'sheets') {
    // the status bar walks through "streaming <uuid>.xlsx" before it settles on
    // "Ready" / "就绪"; wait for that terminal line so the note never lands in
    // the frame
    await page
      .waitForFunction(
        () => {
          const text = document.body.innerText
          if (/\u6d41\u5f0f\u52a0\u8f7d|streaming/i.test(text)) return false
          return /\u5c31\u7eea|\u5df2\u5b8c\u6574\u52a0\u8f7d|ready|fully loaded/i.test(text)
        },
        null,
        { timeout: 25_000, polling: 250 },
      )
      .catch(() => undefined)
    await page.waitForTimeout(500)
  }
  await polish(page, name, theme, locale)
  await page
    .evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready)
    .catch(() => undefined)
  await page.waitForTimeout(300)
}

/** small, guarded touches so each editor shows its intended silhouette */
async function polish(page: Page, name: string, _theme: Theme, locale: Locale): Promise<void> {
  if (name === 'sheets') {
    // column widths in pixels; English headers need more room than the CJK ones
    const widths: Array<[number, number]> =
      locale === 'en'
        ? [
            [0, 110],
            [1, 130],
            [2, 96],
            [3, 124],
            [4, 86],
            [5, 86],
          ]
        : [
            [0, 96],
            [1, 88],
            [2, 80],
            [3, 116],
            [4, 80],
            [5, 80],
          ]
    const diag = await page.evaluate((columns) => {
      const out: string[] = []
      const dbg = (window as unknown as Record<string, any>).__yiiofficeDebug
      const sheet = dbg?.univerAPI?.getActiveWorkbook?.()?.getActiveSheet?.()
      if (!sheet) return ['no-sheet']
      for (const [col, width] of columns) {
        try {
          sheet.setColumnWidth(col, width)
        } catch {
          out.push(`w${col}!`)
        }
      }
      return out
    }, widths)
    if (diag.length) console.log(`    sheets polish: ${diag.join(' ')}`)
    await page.waitForTimeout(400)
  }

  if (name === 'pdf') {
    // a real click lands on the loading overlay, so drive the handlers directly
    const zoom = (): Promise<number> =>
      page.evaluate(() => {
        const label = document.querySelector('.tb-zoom')
        return label ? Number(label.textContent?.replace('%', '')) || 0 : 0
      })
    const tap = (command: string): Promise<void> =>
      page.evaluate((cmd) => {
        const button = document.querySelector(`[data-cmd="${cmd}"]`)
        if (button instanceof HTMLElement) button.click()
      }, command)

    await tap('fitWidth').catch(() => undefined)
    await page.waitForTimeout(700)
    // the fit pass occasionally re-applies the saved zoom; step down to ~100%
    for (let step = 0; step < 8; step += 1) {
      if ((await zoom()) <= 112) break
      await tap('zoomOut').catch(() => undefined)
      await page.waitForTimeout(220)
    }
    await page.waitForTimeout(900)
  }

  if (name === 'markdown' || name === 'docs') {
    await page
      .evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
      .catch(() => undefined)
  }
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox
    })
    .catch(() => undefined)
  const child = app.process()
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 15_000)
  try {
    await app.close()
  } finally {
    clearTimeout(killTimer)
  }
}

/* ------------------------------------------------------------------ encoder */

async function toWebp(pngPath: string, webpPath: string): Promise<number> {
  const { readFile } = await import('node:fs/promises')
  const buffer = await readFile(pngPath)
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const encoded = await page.evaluate(
      async ({ src, quality }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(image, 0, 0)
        return canvas.toDataURL('image/webp', quality)
      },
      { src: dataUrl, quality: 0.94 },
    )
    const base64 = encoded.replace(/^data:image\/webp;base64,/, '')
    const out = Buffer.from(base64, 'base64')
    await writeFile(webpPath, out)
    return out.length
  } finally {
    await browser.close()
  }
}

/* --------------------------------------------------------------------- main */

export async function buildSamples(locale: Locale): Promise<{ dir: string; recent: string[] }> {
  const copy = COPY[locale]
  const root = await mkdtemp(join(tmpdir(), `yiioffice-sample-${locale}-`))
  const dir = join(root, copy.folder)
  await mkdir(dir, { recursive: true })
  const report = join(dir, copy.files.report)
  const sales = join(dir, copy.files.sales)
  const deck = join(dir, copy.files.deck)
  const review = join(dir, copy.files.review)
  const notes = join(dir, copy.files.notes)

  await buildReportDocx(report, copy)
  await buildSalesXlsx(sales, copy)
  await buildDeckPptx(deck, copy)
  await buildReviewPdf(review)
  await buildNotesMd(notes, copy)

  return { dir, recent: [report, sales, deck, review, notes] }
}

async function main(): Promise<void> {
  const shellMain = join(ROOT, 'apps/shell/out/main/index.js')
  if (!existsSync(shellMain)) {
    throw new Error('Missing apps/shell/out — run `npm run build:all` first')
  }

  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(RAW_DIR, { recursive: true })

  const wanted = process.env.LOCALES?.split(',').map((value) => value.trim())
  const locales = (wanted?.length ? wanted : ['zh', 'en']) as Locale[]
  for (const locale of locales) {
    if (locale !== 'zh' && locale !== 'en') throw new Error(`LOCALES=${locale} is unknown`)
  }

  let written = 0
  for (const locale of locales) {
    process.stdout.write(`[${locale}] building sample documents … `)
    const samples = await buildSamples(locale)
    console.log('done')

    const shots: Shot[] = [
      { name: 'home', clipHeight: 792 },
      { name: 'docs', urlPart: '://docs/', file: samples.recent[0] },
      { name: 'sheets', urlPart: '://sheets/', file: samples.recent[1] },
      { name: 'slides', urlPart: '://slides/', file: samples.recent[2] },
      { name: 'pdf', urlPart: '://pdf/', file: samples.recent[3] },
      { name: 'markdown', urlPart: '://markdown/', file: samples.recent[4] },
    ]

    // SHOT=sheets re-captures a single editor while iterating on the framing
    const only = process.env.SHOT
    const selected = only ? shots.filter((shot) => shot.name === only) : shots
    if (!selected.length) throw new Error(`SHOT=${only} matches no shot`)

    for (const theme of ['light', 'dark'] as Theme[]) {
      for (const shot of selected) {
        const label = `${shot.name}-${theme}${locale === 'en' ? '-en' : ''}`
        const png = await capture(locale, theme, shot, samples.dir, samples.recent, RAW_DIR)
        const webp = join(OUT_DIR, `${label}.webp`)
        const bytes = await toWebp(png, webp)
        written += 1
        console.log(`  ${label.padEnd(21)} ${(bytes / 1024).toFixed(0)} KB`)
      }
    }
  }

  console.log(`\nwrote ${written} shots to site/assets/screens`)
}

/** importing this module (for the sample builders) must not start a capture run */
const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isEntry) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
