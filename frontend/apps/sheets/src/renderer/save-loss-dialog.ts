/**
 * Pre-save confirmation when the workbook holds changes the Go engine cannot
 * persist. Mirrors the React dialogs' markup contract (.dialog-backdrop /
 * .format-cells-dialog / .dialog-actions) to inherit their styling, and reuses
 * the shared Tab trap. Escape and backdrop clicks mean cancel.
 */
import { installModalBehavior } from '@yiioffice/ui'
import type { StringKey } from './i18n/locale'
import { t } from './i18n/locale'
import type { UnpersistedSaveCategory } from './save-loss'

const CATEGORY_LABELS: Record<UnpersistedSaveCategory, StringKey> = {
  charts: 'appUnpersistedCharts',
  visuals: 'appUnpersistedVisuals',
  pivots: 'appUnpersistedPivots',
  tables: 'appUnpersistedTables',
  notes: 'appUnpersistedNotes',
  conditionalFormatting: 'appUnpersistedConditionalFormatting',
  dataValidation: 'appUnpersistedDataValidation',
  pageSetup: 'appUnpersistedPageSetup',
  filters: 'appUnpersistedFilters',
  sparklines: 'appUnpersistedSparklines',
  sheets: 'appUnpersistedSheets',
  definedNames: 'appUnpersistedNames',
  theme: 'appUnpersistedTheme',
  protection: 'appUnpersistedProtection',
}

// ⌘S can be hammered; a second call joins the open dialog instead of
// stacking a new one.
let active: Promise<boolean> | null = null

export function showUnpersistedSaveConfirm(categories: UnpersistedSaveCategory[]): Promise<boolean> {
  if (categories.length === 0) return Promise.resolve(true)
  if (active) return active
  active = new Promise<boolean>((resolve) => {
    const opener = document.activeElement as HTMLElement | null
    const backdrop = document.createElement('div')
    backdrop.className = 'dialog-backdrop'
    const card = document.createElement('div')
    card.className = 'format-cells-dialog recovery-dialog'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', t('appUnpersistedTitle'))
    card.addEventListener('click', (event) => event.stopPropagation())

    const body = document.createElement('section')
    body.className = 'dialog-body'
    const heading = document.createElement('div')
    heading.className = 'recovery-heading'
    const title = document.createElement('h2')
    title.textContent = t('appUnpersistedTitle')
    heading.append(title)
    const text = document.createElement('p')
    text.className = 'recovery-body'
    text.textContent = t('appUnpersistedBody')
    const list = document.createElement('ul')
    list.className = 'recovery-list'
    for (const category of categories) {
      const item = document.createElement('li')
      item.textContent = t(CATEGORY_LABELS[category])
      list.append(item)
    }
    const hint = document.createElement('p')
    hint.className = 'recovery-body'
    hint.textContent = t('appUnpersistedHint')
    body.append(heading, text, list, hint)

    let stopModal: () => void = () => {}
    const finish = (confirmed: boolean): void => {
      stopModal()
      backdrop.remove()
      active = null
      resolve(confirmed)
    }

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'
    const button = (label: string, className: string, confirmed: boolean): HTMLButtonElement => {
      const el = document.createElement('button')
      el.className = className
      el.textContent = label
      el.addEventListener('click', () => finish(confirmed))
      return el
    }
    actions.append(
      button(t('appDialogCancel'), 'secondary', false),
      button(t('appUnpersistedContinue'), 'primary-action', true),
    )
    card.append(body, actions)
    backdrop.append(card)
    backdrop.addEventListener('click', () => finish(false))
    document.body.append(backdrop)
    stopModal = installModalBehavior(card, {
      onClose: () => finish(false),
      // Focus the safe choice: cancelling keeps the whole journal pending.
      initialFocus: actions.firstElementChild as HTMLElement | null,
      restoreFocus: true,
      opener,
    })
  })
  return active
}
