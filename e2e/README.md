# E2E tests

One suite: Playwright drives a **server build** of the app (`-tags server`) with
the **real Go services**. No stubs, no Vite dev server.

```bash
# from the repo root
task e2e                      # bindings + renderers + server binary, then the suite
task e2e SPEC=specs/real/docs.spec.ts
```

## How it works

Per the official guide (<https://v3.wails.io/guides/e2e-testing/>), the app is
built with `-tags server` and served over HTTP: same renderer bundles, same
services, same bindings — only the window is gone. That is what makes the suite
end-to-end on a CI runner with no WebView2 and no display. `task e2e:build`
follows the guide's preparation order: `wails3 generate bindings -ts -f
'-tags=server,production'` → renderer build → `go build -tags server,production`.

```
spec (user journey)
  └─ fixtures/app.ts        test + per-test work dir, closes tabs afterwards
       ├─ fixtures/server.ts   one server build per worker: free port,
       │                       throw-away YIIOFFICE_USER_DATA, /health gate
       ├─ fixtures/editors.ts  tabs() / openFile() / editor iframe handles
       └─ fixtures/documents.ts generated .docx / .xlsx / .pdf / text fixtures
```

Three rules keep it honest:

1. **Never stub the bridge.** If `window.aiOffice` were stubbed the suite would
   pass while the app is broken; `harness.spec.ts` asserts that
   `TabService.List` reports a real host tab.
2. **Assert on the disk, not only on the UI.** A save is proven by re-reading the
   file (`readDocxText`, `readXlsxXml`), which is the part the Electron-era tests
   got right.
3. **Leave no state behind.** Tabs live in the Go process, so the `page` fixture
   closes every editor tab after each test.

## Coverage

70 tests in 11 files, all on the real host (`npx playwright test --project=real --list`):

| spec | tests | journey |
| --- | --- | --- |
| `harness.spec.ts` | 3 | the host itself: real backend, isolation, `/health` |
| `shell.spec.ts` | 10 | open/close/switch tabs, `+` menu, recent list, four "new document" kinds |
| `home.spec.ts` | 7 | quick-start cards, type filter, starring, reopening from the recent list |
| `tabs.spec.ts` | 3 | activation, closing the active tab, closing a background tab |
| `docs.spec.ts` | 4 | open → edit → save, verified on disk (+1 fixme) |
| `docs-editing.spec.ts` | 18 | find/replace, bold, undo, word count, zoom, read mode, two docs in parallel |
| `markdown.spec.ts` | 8 | block and inline markdown rendering |
| `editors.spec.ts` | 5 | markdown save, pdf assets, cross-editor switching |
| `pdf.spec.ts` | 8 | 3-page layout, thumbnails, page jump, zoom, fit modes, page indices |
| `sheets.spec.ts` | 3 | open, save keeps the seeded cell (+1 fixme) |
| `slides.spec.ts` | 1 | the new-deck boot crash, registered as fixme |

`test.fixme` marks a **confirmed product defect**, not a flaky test: `docs.spec.ts`
(0-byte document loses its path), `sheets.spec.ts` (no cell→pixel model for the
canvas grid), `slides.spec.ts` (`animations.length` throws right after the first
paint and unmounts `#root`). They run as soon as the bug is fixed — remove the
`.fixme` and nothing else changes.

## Anatomy of a spec

```ts
test('typing then Ctrl+S writes the change to the file', async ({ app }) => {
  const path = await writeDocx(app.workDir, 'roundtrip.docx', 'Original paragraph')

  const editor = await app.openFile(path, { kind: 'docs', title: 'roundtrip.docx' })
  const page = editor.ui.locator('.doc-page[contenteditable="true"]').first()
  await page.click()
  await app.page.keyboard.type('E2E-TYPED')
  await app.page.keyboard.press('Control+s')

  await expect
    .poll(async () => (await readDocxText(path)).includes('E2E-TYPED'))
    .toBe(true)
})
```

`app.workDir` is a temp dir per test; `editor.ui` is a `FrameLocator` scoped to
that tab's iframe (each editor is `/docs/index.html?tabId=…`), so selectors never
leak between tabs.

## What this harness cannot cover

Native surfaces have no browser equivalent and stay out of scope (the Wails guide
says the same): the WebView2 window itself, the frameless title-bar buttons, the
system tray, native file dialogs, drag-to-tear-off windows, and the packaged
installer. Save-as flows that need a native dialog therefore fail in server mode
with `file dialogs not available in server mode` — they are covered by Go tests
plus a manual pass on the packaged build, not here.

## Debugging

```bash
E2E_KEEP_DATA=1 task e2e SPEC=specs/real/docs.spec.ts   # keeps the temp profile
npx playwright show-trace test-results/<case>/trace.zip
```

A failed test writes `server.log` (the Go host's stdout/stderr) next to its
screenshot/video, which is usually enough to see the service-side error.
