import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

/**
 * Test host for the real-backend E2E suite.
 *
 * Follows the official Wails v3 E2E guide (https://v3.wails.io/guides/e2e-testing/):
 * Playwright drives a **server build** of the app (`-tags server`), which serves
 * the same renderer bundles and the same Go services over HTTP. Every binding
 * call the page makes therefore lands in the real Go code — no bridge stubs.
 *
 * Two deliberate differences from the guide's `webServer` block:
 *
 * 1. The host is spawned per worker instead of once per run, so each worker gets
 *    its own `YIIOFFICE_USER_DATA` directory and its own port. Wails' TabHost is
 *    process-wide, so a shared host would leak open tabs between tests.
 * 2. The binary is prebuilt (`task e2e:build`) rather than `go run`, so a test
 *    run never recompiles the Go side and the harness can start in ~200 ms.
 */

/** Path to the server-mode binary the harness launches. */
export const SERVER_BINARY = resolve(
  __dirname,
  '..',
  '..',
  'build',
  'bin',
  process.platform === 'win32' ? 'YiiOffice-e2e-server.exe' : 'YiiOffice-e2e-server',
)

export interface TestServer {
  /** Origin of the running host, e.g. http://127.0.0.1:53412 */
  baseURL: string
  port: number
  /** Isolated YIIOFFICE_USER_DATA passed to the process. */
  dataDir: string
  /** Everything the host wrote to stdout/stderr, for failure messages. */
  logs: () => string
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolvePort(port))
    })
  })
}

async function waitForHealth(server: TestServer, child: ChildProcess, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `E2E server exited with code ${child.exitCode} before becoming healthy.\n${server.logs()}`,
      )
    }
    try {
      const response = await fetch(`${server.baseURL}/health`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`E2E server did not answer /health within ${timeoutMs}ms.\n${server.logs()}`)
}

/**
 * Start one isolated server build. Call `stop()` when the worker is done.
 */
export async function startServer(): Promise<{ server: TestServer; stop: () => Promise<void> }> {
  if (!existsSync(SERVER_BINARY)) {
    throw new Error(
      `Missing E2E server binary at ${SERVER_BINARY}.\n` +
        'Build it first:  task e2e:build   (or: go build -tags server,production -o build/bin/YiiOffice-e2e-server.exe .)',
    )
  }

  const dataDir = await mkdtemp(join(tmpdir(), 'yiioffice-e2e-data-'))
  const port = await freePort()
  const server: TestServer = {
    baseURL: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    logs: () => output.join(''),
  }

  const output: string[] = []
  const child = spawn(SERVER_BINARY, [], {
    env: {
      ...process.env,
      // Reported by internal/servmode: server builds skip the WebView2 probe,
      // the tray, and every window call.
      WAILS_SERVER_HOST: '127.0.0.1',
      WAILS_SERVER_PORT: String(port),
      // Never touch the developer's real %APPDATA%\YiiOffice.
      YIIOFFICE_USER_DATA: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  await waitForHealth(server, child)

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill()
      // Windows has no SIGTERM: give TerminateProcess a moment, then move on.
      await new Promise((r) => setTimeout(r, 300))
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    // A failed run keeps its profile for triage; a green run cleans up.
    if (process.env.E2E_KEEP_DATA !== '1') {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {})
    } else {
      console.log(`[e2e] kept user data dir: ${dataDir}`)
    }
  }

  return { server, stop }
}

/** Copy the host log next to the Playwright artifacts (CI uploads it). */
export async function archiveServerLog(server: TestServer, target: string): Promise<void> {
  mkdirSync(join(target, '..'), { recursive: true })
  const log = server.logs()
  if (log.length === 0) return
  const { writeFile } = await import('node:fs/promises')
  await writeFile(target, log)
}

export { readFile, copyFileSync }
