/** Render harness for the pdf editor component.

    `App` is 9.7k lines with 143 `useState` hooks and no test ever imported it,
    because getting it onto a DOM needed three things nothing in this repo did:
    a `window.pdfApi` stub, the locale provider `main.tsx` wraps it in, and an
    act() boundary for its mount effects. That is all this file is.

    The stub is a Proxy rather than 60 hand-written methods: `PdfApi` grows with
    every feature, and a hand-written double would fail the *next* method added
    as a missing-function TypeError in an unrelated test. Anything unrecognised
    resolves `null`; `on*` subscription registrars return an unsubscribe, since
    the component calls the returned function in its cleanup. Override only what
    a test actually asserts on -- an override list that mirrors the interface is
    a second copy of it, and goes stale just as quietly.

    Deliberately not `@testing-library/react`: it is not a dependency of this
    repo, and the assertions written against this harness so far need `act` plus
    plain DOM queries. Bring it in when a test needs `waitFor`/`fireEvent` and
    the hand-rolled equivalents stop being enough. */

import { act, createElement } from 'react'
import type { ReactNode } from 'react'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import App from '../../src/renderer/App'
import { LocaleProvider } from '../../src/renderer/i18n/locale'
import type { PdfApi } from '../../src/shared/ipc'

/** Every member optional: a test names the calls it cares about, nothing else. */
export type PdfApiStub = { [K in keyof PdfApi]?: PdfApi[K] }

const noUnsubscribe = (): void => {}

/** Calls the first paint actually makes. Everything else may stay null. */
const MOUNT_DEFAULTS = {
  consumePending: async () => null,
  getLanguage: async () => 'zh',
  getTheme: async () => 'system',
  getUsername: async () => 'tester',
  listEditFonts: async () => [],
  listSavedSignatures: async () => [],
  listStaticFormFills: async () => [],
  isUntitled: async () => false,
} satisfies PdfApiStub

/** Install a `window.pdfApi` the component can talk to. Call before mounting. */
export function stubPdfApi(overrides: PdfApiStub = {}): void {
  const table: Record<string, unknown> = { ...MOUNT_DEFAULTS, ...overrides }
  const stub = new Proxy({} as Record<string, unknown>, {
    // `then` must stay undefined or awaiting the api object itself would hang
    get: (_target, prop: string) => {
      if (prop === 'then') return undefined
      if (prop in table) return table[prop]
      // event registrars: the component stores the result and calls it on unmount
      if (/^on[A-Z]/.test(prop)) return () => noUnsubscribe
      return async () => null
    },
    has: () => true,
  })
  Object.defineProperty(window, 'pdfApi', { value: stub, configurable: true, writable: true })
}

/** jsdom has no layout engine, so it ships neither observer the renderer assumes
    from Chromium. Inert doubles are enough: the page components gate their
    rendering on `isIntersecting`, so never firing keeps the mount light instead
    of pushing a real canvas render through jsdom (which has no 2d context). */
class InertObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}

/** Install the DOM surfaces jsdom lacks. Idempotent; safe to call per test. */
export function installDomStubs(): void {
  const globals = globalThis as Record<string, unknown>
  if (!globals.IntersectionObserver) globals.IntersectionObserver = InertObserver
  if (!globals.ResizeObserver) globals.ResizeObserver = InertObserver
}

export interface MountedApp {
  container: HTMLElement
  /** Re-render after external events (storage, resize, a resolved promise) */
  settle: () => Promise<void>
  unmount: () => Promise<void>
}

/** Ribbon controls carry `data-cmd`, ribbon tabs `data-tab`.

    Both are locale-independent, which nothing else on a ribbon button is: the
    visible label, `data-tip` and `aria-label` are all translated, so a selector
    built on any of them stops matching the moment the app runs in another
    language (the e2e suite's `getByRole('button', { name: 'Rotate Left' })` has
    exactly that problem). The value is the button's i18n key, so a control can
    be traced back to its label without a second naming scheme to maintain.

    Only the ribbon is stamped so far. Dialogs, popovers and overlays get a hook
    when a test first needs to drive them -- a hook nobody queries is a
    contract nobody checks. */

const selectorFor = (attr: 'data-cmd' | 'data-tab', value: string): string =>
  `[${attr}="${value}"]`

function find(root: ParentNode, attr: 'data-cmd' | 'data-tab', value: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selectorFor(attr, value))
  if (!el) throw new Error(`no ${selectorFor(attr, value)} in the rendered editor`)
  return el
}

/** The control, or a thrown error naming the missing hook. */
export function cmd(root: ParentNode, name: string): HTMLElement {
  return find(root, 'data-cmd', name)
}

/** Click a ribbon command inside `act`, so the state update it schedules lands
    before the assertion. Returns the element: asserting `disabled` after the
    click is the usual follow-up. */
export async function clickCmd(root: ParentNode, name: string): Promise<HTMLElement> {
  const el = cmd(root, name)
  await act(async () => {
    el.click()
  })
  return el
}

export function tab(root: ParentNode, id: string): HTMLElement {
  return find(root, 'data-tab', id)
}

export async function clickTab(root: ParentNode, id: string): Promise<HTMLElement> {
  const el = tab(root, id)
  await act(async () => {
    el.click()
  })
  return el
}

/** Every `data-cmd` the current tab exposes, in document order. */
export function cmdNames(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-cmd]')).map(
    (el) => el.getAttribute('data-cmd') ?? '',
  )
}

/** Bytes for a `readFile` stub: a fresh copy per call.

    pdfjs transfers the buffer it is handed to its worker, detaching the original.
    A stub that returns one ArrayBuffer instance works exactly once, then fails the
    next read with "Cannot perform Construct on a detached ArrayBuffer" -- and the
    second read is real: every save reloads the file it just wrote. `Buffer#slice`
    copies, which is what the IPC bridge does anyway. */
export function freshBytes(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0)
}

/** Poll until `predicate` holds, letting timers and promise chains run in `act`.

    `settle()` drains the microtask queue, which is not enough after a save: the
    post-save reload goes through `readFile` -> pdfjs `getDocument`, and pdfjs
    hops through scheduled tasks before its promise settles. Polling is the
    hand-rolled stand-in for `waitFor`, and it fails loudly with the last state
    instead of silently returning early. */
export async function until(
  predicate: () => boolean,
  what: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

/** Point pdfjs at the worker file on disk.

    `App` sets `GlobalWorkerOptions.workerSrc` from a Vite `?url` import at module
    scope, which under Vitest becomes a `/@fs/...` virtual path. jsdom has no
    Worker, so pdfjs falls back to a fake one and dynamic-imports `workerSrc` --
    and that virtual path is not importable, so every `getDocument` failed with
    "Setting up fake worker failed". Call this before a test opens a document.

    Resolved through `createRequire` rather than a relative path: the package is
    hoisted to the repo root today, but that is a layout detail, not a contract. */
export function usePdfWorkerFromDisk(): void {
  const resolve = createRequire(import.meta.url)
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href
}

/** Mount the editor the way `main.tsx` does, minus the CSS and screen tips. */
export async function mountPdfApp(): Promise<MountedApp> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installDomStubs()
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const tree = (): ReactNode =>
    createElement(LocaleProvider, { initial: 'zh' as const, children: createElement(App) })
  await act(async () => {
    root.render(tree())
  })
  return {
    container,
    settle: async () => {
      // drain the microtask queue the mount effects queued their api calls on
      await act(async () => {
        await Promise.resolve()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
