// @vitest-environment jsdom
// Tells React that act() is supported in this jsdom test environment
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PasswordDialog } from './PasswordDialog'

afterEach(() => {
  document.body.innerHTML = ''
})

function dialogProps(overrides: { error?: string; onCancel?: () => void } = {}) {
  return {
    title: 'Document password',
    body: 'This document is protected.',
    label: 'Password',
    value: 'secret',
    error: overrides.error ?? '',
    submitLabel: 'Open',
    cancelLabel: 'Cancel',
    onChange: () => {},
    onSubmit: () => {},
    onCancel: overrides.onCancel ?? (() => {}),
  }
}

function keydown(target: HTMLElement, key: string, shiftKey = false): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
}

function renderDialog(props: ReturnType<typeof dialogProps>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(createElement(PasswordDialog, props))
  })
  return root
}

describe('PasswordDialog keyboard contract', () => {
  it('focuses the password field, cycles Tab inside, closes on Esc and restores the opener', () => {
    const opener = document.createElement('button')
    opener.textContent = 'open document'
    document.body.append(opener)
    opener.focus()

    const onCancel = vi.fn()
    const root = renderDialog(dialogProps({ onCancel }))
    const input = document.querySelector<HTMLInputElement>('.pwd-dialog input')!
    const buttons = document.querySelectorAll<HTMLButtonElement>('.modal-actions button')
    const cancel = buttons[0]!
    const submit = buttons[1]!

    // Focus enters on the password field; the opener's page is inert meanwhile.
    expect(document.activeElement).toBe(input)
    expect(opener.getAttribute('aria-hidden')).toBe('true')
    expect(opener.hasAttribute('inert')).toBe(true)

    // Wrap forward from the last control and backward from the first.
    submit.focus()
    keydown(submit, 'Tab')
    expect(document.activeElement).toBe(input)
    input.focus()
    keydown(input, 'Tab', true)
    expect(document.activeElement).toBe(submit)

    keydown(cancel, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    expect(document.activeElement).toBe(opener)
    expect(opener.hasAttribute('aria-hidden')).toBe(false)
    expect(opener.hasAttribute('inert')).toBe(false)
  })

  it('puts focus back in the password field when the attempt fails', () => {
    const root = renderDialog(dialogProps())
    const input = document.querySelector<HTMLInputElement>('.pwd-dialog input')!
    const cancel = document.querySelectorAll<HTMLButtonElement>('.modal-actions button')[0]!
    cancel.focus()

    act(() => {
      root.render(createElement(PasswordDialog, dialogProps({ error: 'Wrong password' })))
    })
    expect(document.activeElement).toBe(input)
  })
})
