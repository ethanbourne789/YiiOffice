// @vitest-environment jsdom
// Tells React that act() is supported in this jsdom test environment
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CropDialog, CutoutDialog } from './ImageDialogs'
import type { TFunc } from './i18n/locale'

const t: TFunc = ((key: string) => key) as TFunc

// jsdom does not decode images or paint canvases; the two dialogs only need
// onload, natural size and a 2D context that accepts the pixel copies.
class FakeImage {
  naturalWidth = 120
  naturalHeight = 80
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0)
  }
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

const originalImage = globalThis.Image
const originalImageData = globalThis.ImageData
const originalGetContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  globalThis.Image = FakeImage as unknown as typeof Image
  if (!globalThis.ImageData) globalThis.ImageData = FakeImageData as unknown as typeof ImageData
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      drawImage() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData() {},
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  document.body.innerHTML = ''
  globalThis.Image = originalImage
  globalThis.ImageData = originalImageData
  HTMLCanvasElement.prototype.getContext = originalGetContext
})

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function keydown(target: HTMLElement, key: string, shiftKey = false): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
}

function setup() {
  const opener = document.createElement('button')
  opener.textContent = 'open'
  const page = document.createElement('main')
  page.textContent = 'page'
  const host = document.createElement('div')
  document.body.append(opener, page, host)
  opener.focus()
  const root = createRoot(host)
  return { opener, page, root }
}

function dialogButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.pdf-modal-actions button')]
}

function expectBackgroundHidden(page: HTMLElement, hidden: boolean): void {
  expect(page.hasAttribute('inert')).toBe(hidden)
  expect(page.getAttribute('aria-hidden')).toBe(hidden ? 'true' : null)
}

describe('PDF image dialogs keyboard contract', () => {
  it('cuts out: focus moves to the tolerance input, Tab cycles, Esc closes, opener refocused', async () => {
    const { opener, page, root } = setup()
    const onCancel = vi.fn()
    act(() => {
      root.render(<CutoutDialog t={t} image="AAAA" onApply={() => {}} onCancel={onCancel} />)
    })
    await flush()

    const range = document.querySelector<HTMLInputElement>('input[type="range"]')!
    const [cancel, apply] = dialogButtons()
    expect(range.disabled).toBe(false)
    // First input, not the Cancel button, owns focus once the preview is ready.
    expect(document.activeElement).toBe(range)
    expectBackgroundHidden(page, true)

    apply!.focus()
    keydown(apply!, 'Tab')
    expect(document.activeElement).toBe(range)
    keydown(range, 'Tab', true)
    expect(document.activeElement).toBe(apply)

    keydown(range, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(document.activeElement).toBe(opener)
    expectBackgroundHidden(page, false)
    expect(cancel).toBeTruthy()
  })

  it('crop: Cancel takes focus, Tab cycles, Esc closes, opener refocused', async () => {
    const { opener, page, root } = setup()
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <CropDialog t={t} image="AAAA" onApply={() => {}} onCancel={onCancel} title="Crop" />,
      )
    })
    await flush()

    const [cancel, apply] = dialogButtons()
    expect(document.activeElement).toBe(cancel)
    expectBackgroundHidden(page, true)

    apply!.focus()
    keydown(apply!, 'Tab')
    expect(document.activeElement).toBe(cancel)
    keydown(cancel!, 'Tab', true)
    expect(document.activeElement).toBe(apply)

    keydown(apply!, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(document.activeElement).toBe(opener)
    expectBackgroundHidden(page, false)
  })
})
