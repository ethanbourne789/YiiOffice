/**
 * Wails port of the headless-export helpers from @yiioffice/electron-utils.
 * Pure logic — no Electron dependencies.
 */

/** Wait budget for the headless renderer to open its document */
const HEADLESS_TIMEOUT_MS = 180_000
const HEADLESS_POLL_MS = 250

export interface HeadlessExportReport {
  ok: boolean
  error?: string
}

export async function pollUntilReady(
  ready: () => boolean,
  stallMessage: string | (() => string),
  { timeoutMs = HEADLESS_TIMEOUT_MS, pollMs = HEADLESS_POLL_MS } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(typeof stallMessage === 'function' ? stallMessage() : stallMessage)
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export async function runHeadlessRendererExport(
  outPath: string,
  waitUntilReady: () => Promise<void>,
  exportFile: (outPath: string) => Promise<boolean>,
): Promise<HeadlessExportReport> {
  try {
    await waitUntilReady()
    const ok = await exportFile(outPath)
    return ok ? { ok: true } : { ok: false, error: 'export did not produce a file' }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
