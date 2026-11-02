/**
 * Excel's "keep this format?" prompt for CSV sessions, as an imperative
 * promise so the desktop-api bridge can await it from the save flow.
 * Mirrors the React dialogs' markup contract (.dialog-backdrop /
 * .format-cells-dialog / .dialog-actions) to inherit their styling, and
 * reuses the shared Tab trap. Escape and backdrop clicks mean cancel.
 */
import { trapTab } from './modal-dialog'
import { t } from './i18n/locale'

export type CsvSaveChoice = 'csv' | 'xlsx' | 'cancel'

// ⌘S can be hammered; a second call joins the open dialog instead of
// stacking a new one.
let active: Promise<CsvSaveChoice> | null = null

export function showCsvKeepFormatConfirm(): Promise<CsvSaveChoice> {
  if (active) return active
  active = new Promise<CsvSaveChoice>((resolve) => {
    const opener = document.activeElement as HTMLElement | null
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    const card = document.createElement('div')
    card.className = 'format-cells-dialog recovery-dialog'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', t('appCsvKeepTitle'))
    card.addEventListener('click', (event) => event.stopPropagation())

    const body = document.createElement('section')
    body.className = 'dialog-body'
    const heading = document.createElement('div')
    heading.className = 'recovery-heading'
    const title = document.createElement('h2')
    title.textContent = t('appCsvKeepTitle')
    heading.append(title)
    const text = document.createElement('p')
    text.className = 'recovery-body'
    text.textContent = t('appCsvKeepBody')
    body.append(heading, text)

    const finish = (choice: CsvSaveChoice): void => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      active = null
      if (opener && opener !== document.body && opener.isConnected) opener.focus()
      resolve(choice)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish('cancel')
      } else if (event.key === 'Tab') {
        trapTab(card, event)
      }
    }

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    const button = (label: string, className: string, choice: CsvSaveChoice): HTMLButtonElement => {
      const el = document.createElement('button')
      el.className = className
      el.textContent = label
      el.addEventListener('click', () => finish(choice))
      return el
    }
    actions.append(
      button(t('appDialogCancel'), 'secondary', 'cancel'),
      button(t('appCsvKeepXlsx'), 'secondary', 'xlsx'),
      button(t('appCsvKeepCsv'), 'primary-action', 'csv'),
    )
    card.append(body, actions)
    backdrop.append(card)
    backdrop.addEventListener('click', () => finish('cancel'))
    document.addEventListener('keydown', onKey)
    document.body.append(backdrop)
    ;(actions.lastElementChild as HTMLButtonElement | null)?.focus()
  })
  return active
}
