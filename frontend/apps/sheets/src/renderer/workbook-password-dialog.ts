/**
 * Modal password prompt for an encrypted workbook. Mirrors the React dialogs'
 * markup contract (.dialog-backdrop / .format-cells-dialog / .dialog-actions)
 * to inherit their styling, and reuses the shared Tab trap. Escape and backdrop
 * clicks mean cancel; Enter submits the password.
 */
import { installModalBehavior } from '@yiioffice/ui'
import { t } from './i18n/locale'

// A second open while the prompt is up would stack dialogs; join the first.
let active: Promise<string | null> | null = null

export function showWorkbookPasswordDialog(fileName: string, errorText?: string): Promise<string | null> {
  if (active) return active
  active = new Promise<string | null>((resolve) => {
    const opener = document.activeElement as HTMLElement | null
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'

    const card = document.createElement('div')
    card.className = 'format-cells-dialog recovery-dialog workbook-password-dialog'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', t('appWorkbookPasswordTitle'))
    card.addEventListener('click', (event) => event.stopPropagation())

    const body = document.createElement('section')
    body.className = 'dialog-body'
    const heading = document.createElement('div')
    heading.className = 'recovery-heading'
    const title = document.createElement('h2')
    title.textContent = t('appWorkbookPasswordTitle')
    heading.append(title)
    const text = document.createElement('p')
    text.className = 'recovery-body'
    text.textContent = t('appWorkbookPasswordBody', { name: fileName })
    const label = document.createElement('label')
    label.className = 'workbook-password-label'
    label.textContent = t('appWorkbookPasswordLabel')
    const input = document.createElement('input')
    input.type = 'password'
    input.className = 'workbook-password-input'
    input.autocomplete = 'off'
    input.spellcheck = false
    label.append(input)
    const error = document.createElement('p')
    error.className = 'recovery-body workbook-password-error'
    error.setAttribute('role', 'alert')
    error.hidden = errorText === undefined
    if (errorText !== undefined) error.textContent = errorText
    body.append(heading, text, label, error)

    let stopModal: () => void = () => {}
    const finish = (password: string | null): void => {
      stopModal()
      backdrop.remove()
      active = null
      resolve(password)
    }
    const submit = (): void => {
      if (input.value === '') {
        error.hidden = false
        error.textContent = t('appWorkbookPasswordEmpty')
        input.focus()
        return
      }
      finish(input.value)
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    })

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    const button = (label2: string, className: string): HTMLButtonElement => {
      const el = document.createElement('button')
      el.className = className
      el.textContent = label2
      return el
    }
    const cancel = button(t('appDialogCancel'), 'secondary')
    cancel.addEventListener('click', () => finish(null))
    const open = button(t('appWorkbookPasswordOpen'), 'primary-action')
    open.addEventListener('click', submit)
    actions.append(cancel, open)

    card.append(body, actions)
    backdrop.append(card)
    backdrop.addEventListener('click', () => finish(null))
    document.body.append(backdrop)
    stopModal = installModalBehavior(card, {
      onClose: () => finish(null),
      initialFocus: input,
      restoreFocus: true,
      opener,
    })
  })
  return active
}
