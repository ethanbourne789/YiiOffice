import { useEffect, useRef, useState } from 'react'
// legacy build: the modern build relies on new APIs like Math.sumPrecise that WebView2/Edge lacks
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { DOC_OPTS } from './view-config'
import type { PageSize } from './view-config'

/** Metadata as pdf.js reports it; the form layer also reads the two feature flags. */
export interface PdfDocumentInfo {
  EncryptFilterName?: string | null
  IsXFAPresent?: boolean
  Title?: string
  Author?: string
  Subject?: string
  Keywords?: string
}

/** Everything a caller needs once a document is open and its page table is probed. */
export interface PdfDocumentProbe {
  doc: PDFDocumentProxy
  numPages: number
  /** Unrotated page size in points, one entry per page */
  sizes: PageSize[]
  /** Base page rotation, one entry per page */
  rotations: number[]
  /** PDF-space origin (page view lower-left), one entry per page */
  origins: [number, number][]
  /** User-unit scale, one entry per page */
  userUnits: number[]
  info: PdfDocumentInfo
}

export interface PdfLoadingTaskLike {
  promise: Promise<PDFDocumentProxy>
  destroy: () => Promise<void>
}

export interface PdfOpenParams {
  data: Uint8Array
  password?: string
  cMapUrl: string
  cMapPacked: boolean
  standardFontDataUrl: string
  wasmUrl: string
}

/** Structural alias for getDocument so tests can inject a fake loader. */
export type GetDocumentFn = (params: PdfOpenParams) => PdfLoadingTaskLike

export interface PdfDocumentState {
  doc: PDFDocumentProxy | null
  error: Error | null
}

export interface PdfDocumentLoader {
  getDoc(): PDFDocumentProxy | null
  getError(): Error | null
  /**
   * Open bytes and probe page geometry. A newer call supersedes an in-flight one:
   * the superseded task is destroyed and its promise resolves `null` instead of
   * surfacing an abort as a load failure.
   */
  load(bytes: Uint8Array, options?: { password?: string }): Promise<PdfDocumentProbe | null>
  /** Make a probe's document the adopted one. Returns false (and destroys it) when
   *  a newer load superseded the probe. */
  adopt(probe: PdfDocumentProbe): boolean
  /** Destroy a document the caller is replacing, at the caller's chosen moment. */
  destroy(doc: PDFDocumentProxy | null): void
  /** Destroy the adopted document and cancel in-flight work. */
  dispose(): void
}

/** Framework-free core so supersede/cancel/destroy can be tested without React. */
export function createPdfDocumentLoader(
  notify: (state: PdfDocumentState) => void,
  getDocumentFn: GetDocumentFn = getDocument as GetDocumentFn,
): PdfDocumentLoader {
  let doc: PDFDocumentProxy | null = null
  let error: Error | null = null
  let disposed = false
  let generation = 0
  let inFlight: PdfLoadingTaskLike | null = null
  const destroyed = new WeakSet<PDFDocumentProxy>()
  const probeGeneration = new WeakMap<PdfDocumentProbe, number>()

  const publish = () => {
    if (!disposed) notify({ doc, error })
  }

  const destroyDoc = (target: PDFDocumentProxy | null) => {
    if (!target || destroyed.has(target)) return
    destroyed.add(target)
    if (doc === target) {
      doc = null
      publish()
    }
    void target.loadingTask.destroy().catch(() => {})
  }

  const destroyTask = (target: PdfLoadingTaskLike | null) => {
    if (!target) return
    void target.destroy().catch(() => {})
  }

  const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

  const probeDocument = async (loaded: PDFDocumentProxy): Promise<PdfDocumentProbe> => {
    const metadata = await loaded.getMetadata()
    const info = metadata.info as PdfDocumentInfo
    const sizes: PageSize[] = []
    const rotations: number[] = []
    const origins: [number, number][] = []
    const userUnits: number[] = []
    for (let i = 1; i <= loaded.numPages; i++) {
      const page = await loaded.getPage(i)
      // Unrotated size; display size is derived by the caller from the total rotation
      const viewport = page.getViewport({ scale: 1, rotation: 0 })
      sizes.push({ width: viewport.width, height: viewport.height })
      rotations.push(page.rotate ?? 0)
      origins.push([page.view[0]!, page.view[1]!])
      userUnits.push(page.userUnit ?? 1)
      // Only geometry was needed; without this a large document keeps every page's
      // parsed content alive for the whole session (pages re-parse lazily).
      page.cleanup()
    }
    return { doc: loaded, numPages: loaded.numPages, sizes, rotations, origins, userUnits, info }
  }

  return {
    getDoc: () => doc,
    getError: () => error,

    async load(bytes, options) {
      const currentGeneration = ++generation
      destroyTask(inFlight)
      inFlight = null
      if (error) {
        error = null
        publish()
      }
      const task = getDocumentFn({ data: bytes, password: options?.password, ...DOC_OPTS })
      inFlight = task
      let loaded: PDFDocumentProxy
      try {
        loaded = await task.promise
      } catch (err) {
        if (inFlight === task) inFlight = null
        // A superseded load was destroyed on purpose: it is not a user-visible failure.
        if (currentGeneration !== generation || disposed) return null
        error = toError(err)
        publish()
        destroyTask(task)
        throw error
      }
      if (inFlight === task) inFlight = null
      if (currentGeneration !== generation || disposed) {
        destroyDoc(loaded)
        return null
      }
      try {
        const probe = await probeDocument(loaded)
        probeGeneration.set(probe, currentGeneration)
        if (currentGeneration !== generation || disposed) {
          destroyDoc(loaded)
          return null
        }
        return probe
      } catch (err) {
        destroyDoc(loaded)
        if (currentGeneration !== generation || disposed) return null
        error = toError(err)
        publish()
        throw error
      }
    },

    adopt(probe) {
      if (
        disposed ||
        probeGeneration.get(probe) !== generation ||
        destroyed.has(probe.doc)
      ) {
        destroyDoc(probe.doc)
        return false
      }
      doc = probe.doc
      error = null
      publish()
      return true
    },

    destroy(target) {
      destroyDoc(target)
    },

    dispose() {
      if (disposed) return
      disposed = true
      generation++
      destroyTask(inFlight)
      inFlight = null
      destroyDoc(doc)
    },
  }
}

export interface PdfDocumentController {
  doc: PDFDocumentProxy | null
  /** Last load failure; cleared when a new load starts or a document is adopted. */
  error: Error | null
  load(bytes: Uint8Array, options?: { password?: string }): Promise<PdfDocumentProbe | null>
  adopt(probe: PdfDocumentProbe): boolean
  destroy(doc: PDFDocumentProxy | null): void
}

/** Owns the open document's lifecycle. The document is destroyed (and in-flight
 *  work cancelled) when the owning component unmounts. */
export function usePdfDocument(getDocumentFn?: GetDocumentFn): PdfDocumentController {
  const [state, setState] = useState<PdfDocumentState>({ doc: null, error: null })
  const loaderRef = useRef<PdfDocumentLoader | null>(null)
  if (!loaderRef.current) loaderRef.current = createPdfDocumentLoader(setState, getDocumentFn)
  useEffect(() => {
    const loader = loaderRef.current!
    return () => loader.dispose()
  }, [])
  const loader = loaderRef.current
  return {
    doc: state.doc,
    error: state.error,
    load: loader.load,
    adopt: loader.adopt,
    destroy: loader.destroy,
  }
}
