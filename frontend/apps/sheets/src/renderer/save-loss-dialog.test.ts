import { afterEach, describe, expect, it } from 'vitest'
import { showUnpersistedSaveConfirm } from './save-loss-dialog'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('showUnpersistedSaveConfirm', () => {
  it('lists the affected categories and resolves false when cancelled', async () => {
    const pending = showUnpersistedSaveConfirm(['charts', 'notes'])
    const card = document.querySelector('.format-cells-dialog')
    expect(card).not.toBeNull()
    expect(card!.querySelectorAll('.recovery-list li')).toHaveLength(2)
    ;(card!.querySelector('.dialog-actions .secondary') as HTMLButtonElement).click()
    await expect(pending).resolves.toBe(false)
    expect(document.querySelector('.format-cells-dialog')).toBeNull()
  })

  it('resolves true when the user chooses to continue', async () => {
    const pending = showUnpersistedSaveConfirm(['charts'])
    const card = document.querySelector('.format-cells-dialog')
    ;(card!.querySelector('.dialog-actions .primary-action') as HTMLButtonElement).click()
    await expect(pending).resolves.toBe(true)
  })

  it('short-circuits when there is nothing to warn about', async () => {
    await expect(showUnpersistedSaveConfirm([])).resolves.toBe(true)
    expect(document.querySelector('.format-cells-dialog')).toBeNull()
  })

  it('opens on Cancel, keeps Tab inside, closes on Esc, and returns focus to the opener', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'save'
    const page = document.createElement('main')
    document.body.append(opener, page)
    opener.focus()

    const pending = showUnpersistedSaveConfirm(['charts'])
    const card = document.querySelector<HTMLElement>('.format-cells-dialog')!
    const cancel = card.querySelector<HTMLButtonElement>('.dialog-actions .secondary')!
    const keepGoing = card.querySelector<HTMLButtonElement>('.dialog-actions .primary-action')!

    // The safe choice owns focus on open, and the page behind becomes inert.
    expect(document.activeElement).toBe(cancel)
    expect(page.getAttribute('aria-hidden')).toBe('true')
    expect(page.hasAttribute('inert')).toBe(true)

    // Tab from the last control wraps to the first; Shift+Tab wraps back.
    keepGoing.focus()
    keepGoing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(cancel)
    cancel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(keepGoing)

    // Esc cancels, tears the dialog down, restores both focus and the page.
    keepGoing.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await expect(pending).resolves.toBe(false)
    expect(document.querySelector('.format-cells-dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(page.hasAttribute('aria-hidden')).toBe(false)
    expect(page.hasAttribute('inert')).toBe(false)
  })
})
