import { basename } from 'node:path'
import { flagBool, flagString } from '../args'
import {
  applyOps,
  describeDeck,
  PREVIEW_CHARS,
  inlineLocalFiles,
  openDeck,
  parseOps,
  saveDeck,
} from '../formats/pptx'
import { previewChars } from '../preview'
import { readInput, resolveInput, resolveOutput, writeOutput } from '../fs'
import { outputDirectory, parseScale, renderToPngs } from '../formats/render'
import { readOpsInput } from '../ops-input'
import type { TxnResult } from '@yiioffice/pptx-ops'
import type { CommandContext, CommandDef } from '../registry'
import { CliError, EXIT, type CommandResult } from '../result'
import { txnDetail, txnFailure } from './txn'
import { BATCH_OPTIONS, batchCounts, batchMode, batchResult, failedBatch } from '../batch'
import type { OpFailure } from '../op-errors'
import { emuPer, isReadUnit, READ_UNITS, type ReadUnit } from '../length-units'

export const slidesCommand: CommandDef = {
  name: 'slides',
  summary:
    'Read, edit or render a .pptx with the ops the in-app AI uses.',
  usage:
    'slides <read|apply|render> <file.pptx> [options]',
  options: [
    {
      name: 'slide',
      value: 'n',
      description: 'read/render: only this 0-based slide',
    },
    {
      name: 'full',
      description: 'read: whole text and every table row instead of previews, plus speaker notes',
    },
    {
      name: 'layouts',
      description:
        'read: also list the deck layouts (name, index, placeholders) for addSlideWithLayout',
    },
    {
      name: 'max-chars',
      value: 'n',
      description:
        'read: preview length per text element (default 300); clipped text ends in …(+n chars)',
    },
    {
      name: 'units',
      value: 'unit',
      description: `read: report box and slide size lengths in ${READ_UNITS.join(', ')} (default emu; px at 96 dpi)`,
    },
    { name: 'ops', value: 'file', description: 'apply: JSON ops file, or "-" for stdin' },
    { name: 'dry-run', description: 'apply: validate and print the plan without writing' },
    ...BATCH_OPTIONS,
    {
      name: 'isolation',
      value: 'mode',
      description: 'apply: atomic (default) or per_op (same as --best-effort)',
    },
    { name: 'out', value: 'path', description: 'apply: write here instead of in place' },
    {
      name: 'force',
      description:
        'apply: overwrite an existing --out file, or write while YiiOffice has the file open',
    },
    {
      name: 'scale',
      value: 'n',
      description: 'render: pixels per point (default 1 = 960x540 for a 16:9 deck; 2 doubles it)',
    },
  ],
  async run(args, ctx) {
    const [verb, file] = args.positionals
    switch (verb) {
      case 'read':
        return read(file, args, ctx)
      case 'apply':
        return apply(file, args, ctx)
      case 'render':
        return render(file, args, ctx)
      default:
        throw new CliError(
          EXIT.usage,
          'expected "slides read|apply|render <file.pptx>"',
          undefined,
          {
            reason: verb === undefined ? 'missing_argument' : 'invalid_argument',
            suggestion: 'run `yiioffice help slides`',
          },
        )
    }
  },
}

function slideFlag(args: Parameters<CommandDef['run']>[0], count: number): number | undefined {
  const index = slideFlagValue(args)
  if (index === undefined) return undefined
  if (index >= count) {
    throw new CliError(
      EXIT.usage,
      `--slide out of range (0-${count - 1})`,
      { valid_range: [0, count - 1] },
      { reason: 'out_of_range', suggestion: `use a 0-based index between 0 and ${count - 1}` },
    )
  }
  return index
}

/**
 * `--slide` as a 0-based index, before any file is opened: a malformed value
 * (a shell loop that pasted "2 03") is reported as such, not as a missing file
 * or an out-of-range slide.
 */
function slideFlagValue(args: Parameters<CommandDef['run']>[0]): number | undefined {
  const only = flagString(args, 'slide')
  if (only === undefined) return undefined
  const index = Number(only)
  if (!/^\d+$/.test(only.trim()) || !Number.isInteger(index) || index < 0) {
    throw new CliError(
      EXIT.usage,
      `--slide must be one 0-based slide index (e.g. --slide 2), got "${only}"`,
      undefined,
      { reason: 'invalid_argument' },
    )
  }
  return index
}

async function read(
  file: string | undefined,
  args: Parameters<CommandDef['run']>[0],
  ctx: CommandContext,
): Promise<CommandResult> {
  const unit = unitsFlag(args)
  const path = resolveInput(file, ctx)
  const opened = await openDeck(readInput(path))
  const index = slideFlag(args, opened.deck.slides.length)
  const deck = describeDeck(
    opened,
    index,
    flagBool(args, 'full'),
    previewChars(args, PREVIEW_CHARS),
    flagBool(args, 'layouts'),
    unit,
  )
  return {
    summary: `${basename(path)}: ${deck.slides} slides${deck.layouts ? `, ${deck.layouts.length} layouts` : ''}`,
    detail: {
      ...deck,
      units: `${unitsNote(unit)}; slide ids s_<n> and element ids e_* are durable op targets; layouts[].name/index feed addSlideWithLayout`,
    },
  }
}

function unitsFlag(args: Parameters<CommandDef['run']>[0]): ReadUnit {
  const value = flagString(args, 'units')
  if (value === undefined) return 'emu'
  if (!isReadUnit(value)) {
    throw new CliError(
      EXIT.usage,
      `--units must be one of ${READ_UNITS.join(', ')}, got "${value}"`,
      { valid_values: READ_UNITS },
      { reason: 'invalid_argument' },
    )
  }
  return value
}

function unitsNote(unit: ReadUnit): string {
  if (unit === 'emu') return 'EMU (914400 per inch)'
  const dpi = unit === 'px' ? ' at 96 dpi' : ''
  return `${unit}${dpi} (${emuPer(unit)} EMU each; box and size carry unit: "${unit}"); ops take the same lengths as strings such as "1.5${unit}"`
}

async function apply(
  file: string | undefined,
  args: Parameters<CommandDef['run']>[0],
  ctx: CommandContext,
): Promise<CommandResult> {
  const path = resolveInput(file, ctx)
  const mode = batchMode(args)
  const { text, source } = readOpsInput(args, ctx)
  const ops = inlineLocalFiles(parseOps(text, source), ctx)
  const opened = await openDeck(readInput(path))
  const dryRun = flagBool(args, 'dry-run')
  // One transaction per op, as `create` does: the executor validates a batch
  // against the pre-transaction deck, so a slide added by op 0 would not exist
  // for op 1 in a single transaction. Atomic still means nothing is written
  // unless every op applied; the other modes keep what applied and report the rest.
  const records: NonNullable<TxnResult['records']> = []
  const failures: NonNullable<TxnResult['failures']> = []
  // dry-run plan lines keep the caller's op index, so they line up with failures
  const plan: string[] = []
  let applied = 0
  for (const [index, op] of ops.entries()) {
    // the op's own isolation mode, so a per_op failure is not worded as an atomic rollback
    const r = applyOps(opened, [op], { isolation: mode === 'atomic' ? 'atomic' : 'per_op' })
    if (r.applied) {
      applied++
      records.push(...(r.records ?? []))
      const slide = r.records?.[0]?.slideId
      plan.push(`${index}: ${op.op}${slide ? ` on ${slide}` : ''}`)
      continue
    }
    if (mode === 'atomic') throw failedBatch(txnFailure(r, index), ops.length)
    failures.push(...(r.failures ?? []).map((f) => ({ ...f, index })))
    if (mode === 'stop_on_error') break
  }
  const r: TxnResult = { applied: records.length > 0, records, failures }
  const counts = batchCounts(ops.length, applied, failures.length)
  const finish = (base: CommandResult): CommandResult => {
    const { failures: classified, ...detail } = txnDetail(r)
    return batchResult({ ...base, detail }, counts, (classified as OpFailure[] | undefined) ?? [])
  }
  if (!applied) throw failedBatch(txnFailure(r), ops.length)
  if (dryRun) {
    // the batch ran on the in-memory deck only: nothing is applied to the file
    r.applied = false
    r.dryRun = true
    r.plan = plan
    return finish({ summary: `dry run: ${applied} of ${ops.length} ops validated` })
  }
  const output = resolveOutput(flagString(args, 'out'), ctx, {
    fallback: path,
    force: flagBool(args, 'force'),
    // in-place edits overwrite by design; --out onto another existing file needs --force
    fresh: flagString(args, 'out') !== undefined,
  })
  writeOutput(output, await saveDeck(opened))
  return finish({
    summary: `applied ${applied} of ${ops.length} ops to ${basename(output)}`,
    outputPath: output,
  })
}

/** One PNG per slide, through the app's PDF export (hidden YiiOffice process) and pdfium. */
async function render(
  file: string | undefined,
  args: Parameters<CommandDef['run']>[0],
  ctx: CommandContext,
): Promise<CommandResult> {
  const path = resolveInput(file, ctx)
  const outDir = outputDirectory(flagString(args, 'out'), ctx)
  const scale = parseScale(flagString(args, 'scale'))
  const opened = await openDeck(readInput(path))
  const only = slideFlag(args, opened.deck.slides.length)
  const files = await renderToPngs(path, ctx, { outDir, scale, only, log: ctx.log })
  return {
    summary: `rendered ${files.length} slide(s) to ${outDir}`,
    outputPath: outDir,
    detail: { files: files.map(({ page, ...f }) => ({ slide: page, ...f })) },
  }
}
