// @vitest-environment jsdom
// Tells React that act() is supported in this jsdom test environment
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import {
  createPdfDocumentLoader,
  usePdfDocument,
  type PdfDocumentController,
  type PdfDocumentState,
  type PdfLoadingTaskLike,
} from './usePdfDocument'

const bytes = new Uint8Array([1, 2, 3])

function makeDoc(numPages = 2, failAtPage?: number) {
  const destroy = vi.fn(async () => {})
  const cleanups: ReturnType<typeof vi.fn>[] = []
  const doc = {
    numPages,
    getMetadata: async () => ({
      info: {
        Title: 'Title',
        Author: 'Author',
        Subject: 'Subject',
        Keywords: 'Keywords',
        EncryptFilterName: null,
        IsXFAPresent: false,
      },
    }),
    getPage: async (pageNo: number) => {
      if (pageNo === failAtPage) throw new Error('page probe failed')
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return {
        getViewport: () => ({ width: 100 + pageNo, height: 200 }),
        rotate: 0,
        view: [0, 0, 100, 200],
        userUnit: 1,
        cleanup,
      }
    },
    loadingTask: { destroy },
  }
  return { doc: doc as unknown as PDFDocumentProxy, destroy, cleanups }
}

function makeTask(doc: PDFDocumentProxy, destroy = vi.fn(async () => {})): PdfLoadingTaskLike {
  return { promise: Promise.resolve(doc), destroy }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeLoader(getDocumentFn: Parameters<typeof createPdfDocumentLoader>[1]) {
  const states: PdfDocumentState[] = []
  return { loader: createPdfDocumentLoader((state) => states.push(state), getDocumentFn), states }
}

describe('createPdfDocumentLoader', () => {
  it('opens a document, probes page geometry and cleans each page', async () => {
    const { doc, cleanups } = makeDoc(3)
    const { loader } = makeLoader(() => makeTask(doc))

    const probe = await loader.load(bytes)
    expect(probe).not.toBeNull()
    expect(probe!.numPages).toBe(3)
    expect(probe!.sizes).toEqual([
      { width: 101, height: 200 },
      { width: 102, height: 200 },
      { width: 103, height: 200 },
    ])
    expect(probe!.rotations).toEqual([0, 0, 0])
    expect(probe!.origins).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(probe!.userUnits).toEqual([1, 1, 1])
    expect(cleanups).toHaveLength(3)
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(1)

    // A probe is not adopted until the caller says so
    expect(loader.getDoc()).toBeNull()
    expect(loader.adopt(probe!)).toBe(true)
    expect(loader.getDoc()).toBe(doc)
  })

  it('destroys the half-open document and keeps the error when probing fails', async () => {
    const { doc, destroy } = makeDoc(3, 2)
    const { loader } = makeLoader(() => makeTask(doc))

    await expect(loader.load(bytes)).rejects.toThrow('page probe failed')
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(loader.getDoc()).toBeNull()
    expect(loader.getError()?.message).toBe('page probe failed')
  })

  it('a newer load cancels the in-flight task and discards its document', async () => {
    const a = deferred<PDFDocumentProxy>()
    const destroyTaskA = vi.fn(async () => {})
    const { doc: docA, destroy: destroyDocA } = makeDoc()
    const { doc: docB } = makeDoc()
    const taskA = { promise: a.promise, destroy: destroyTaskA }
    const getDocumentFn = vi.fn().mockReturnValueOnce(taskA).mockReturnValueOnce(makeTask(docB))
    const { loader } = makeLoader(getDocumentFn)

    const loadA = loader.load(bytes)
    const loadB = loader.load(bytes)
    expect(destroyTaskA).toHaveBeenCalledTimes(1)

    a.resolve(docA)
    await expect(loadA).resolves.toBeNull()
    // The superseded document is released instead of leaked or adopted
    expect(destroyDocA).toHaveBeenCalledTimes(1)

    const probeB = await loadB
    expect(probeB?.doc).toBe(docB)
    expect(loader.getError()).toBeNull()
  })

  it('treats an aborted in-flight load as superseded, not as a load error', async () => {
    const a = deferred<PDFDocumentProxy>()
    const taskA = { promise: a.promise, destroy: vi.fn(async () => {}) }
    const { doc: docB } = makeDoc()
    const getDocumentFn = vi.fn().mockReturnValueOnce(taskA).mockReturnValueOnce(makeTask(docB))
    const { loader } = makeLoader(getDocumentFn)

    const loadA = loader.load(bytes)
    void loader.load(bytes)
    a.reject(new Error('RenderingCancelledException'))
    await expect(loadA).resolves.toBeNull()
    expect(loader.getError()).toBeNull()
  })

  it('refuses to adopt a probe superseded by a newer load and releases it', async () => {
    const { doc: docA, destroy: destroyDocA } = makeDoc()
    const { doc: docB } = makeDoc()
    const getDocumentFn = vi
      .fn()
      .mockReturnValueOnce(makeTask(docA))
      .mockReturnValueOnce(makeTask(docB))
    const { loader } = makeLoader(getDocumentFn)

    const probeA = await loader.load(bytes)
    const probeB = await loader.load(bytes)
    expect(loader.adopt(probeA!)).toBe(false)
    expect(destroyDocA).toHaveBeenCalledTimes(1)
    expect(loader.adopt(probeB!)).toBe(true)
    expect(loader.getDoc()).toBe(docB)
  })

  it('dispose cancels in-flight work and destroys the adopted document', async () => {
    const { doc: adopted, destroy: destroyAdopted } = makeDoc()
    const { loader } = makeLoader(() => makeTask(adopted))
    const probe = await loader.load(bytes)
    expect(loader.adopt(probe!)).toBe(true)

    const pending = deferred<PDFDocumentProxy>()
    const destroyPending = vi.fn(async () => {})
    const getDocumentFn = vi.fn(() => ({ promise: pending.promise, destroy: destroyPending }))
    const second = makeLoader(getDocumentFn).loader
    const loadPending = second.load(bytes)

    loader.dispose()
    expect(destroyAdopted).toHaveBeenCalledTimes(1)
    expect(loader.getDoc()).toBeNull()

    second.dispose()
    expect(destroyPending).toHaveBeenCalledTimes(1)
    pending.reject(new Error('aborted'))
    await expect(loadPending).resolves.toBeNull()
  })
})

describe('usePdfDocument', () => {
  it('destroys the adopted document when the owning component unmounts', async () => {
    const { doc, destroy } = makeDoc()
    const ref: { current: PdfDocumentController | null } = { current: null }

    function Harness({ onReady }: { onReady: (controller: PdfDocumentController) => void }) {
      const controller = usePdfDocument(() => makeTask(doc))
      onReady(controller)
      return null
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Harness onReady={(controller) => (ref.current = controller)} />)
    })
    await act(async () => {
      const probe = await ref.current!.load(bytes)
      expect(ref.current!.adopt(probe!)).toBe(true)
    })
    expect(ref.current!.doc).toBe(doc)

    await act(async () => {
      root.unmount()
    })
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
