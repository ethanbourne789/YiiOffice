import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { SegmentedControl } from '@yiioffice/ui'
import type { FileAssocEntry } from '../../shared/home-api'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type { DocTheme, UiTheme } from '../../shared/home-api'
import './settings.css'

// ── Settings modal ─────────
// Two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '简体中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

// Document page theme (yiioffice#1811): the canvas/paper preference the editors follow;
// 'follow' keeps the pre-existing behavior of riding the UI theme
const DOC_THEME_OPTIONS = [
  { value: 'follow', labelKey: 'docThemeFollowApp' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: DocTheme; labelKey: StringKey }[]



export type SectionId = 'general' | 'fileassoc' | 'about'

const SECTIONS: readonly { id: SectionId; labelKey: StringKey }[] = [
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'fileassoc', labelKey: 'setSecFileAssoc' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  if (id === 'fileassoc') {
    // document + link: opening a file with this app
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 2.5h5l2.5 2.5v8.5h-7.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M9 2.5V5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path
          d="M1.5 8.5h3M14.5 8.5h-3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

/** where an outside entry point lands when it opens the modal */
export interface SettingsTarget {
  section: SectionId
}

export interface SettingsModalProps {
  onClose: () => void
  target?: SettingsTarget | null
}

export function SettingsModal({
  onClose,
  target,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>(target?.section ?? 'general')
  useEffect(() => {
    if (target) setSection(target.section)
  }, [target])
  const [theme, setTheme] = useState<UiTheme>('system')
  const [docTheme, setDocTheme] = useState<DocTheme>('follow')
  const [saveDir, setSaveDir] = useState('')
  
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [fileAssoc, setFileAssoc] = useState<FileAssocEntry[]>([])
  const [assocBusy, setAssocBusy] = useState<Record<string, boolean>>({})
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.aiOffice.getDocumentTheme?.().then((th) => {
      if (alive) setDocTheme(th)
    })
    void window.aiOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    
    void window.aiOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.aiOffice.getFileAssocStatus?.().then((list) => {
      if (alive && list) setFileAssoc(list)
    })
    void window.aiOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const applyDocumentTheme = (next: DocTheme) => {
    setDocTheme(next)
    void window.aiOffice.setDocumentTheme(next)
  }

  const changeSaveDir = () => {
    void window.aiOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  // The registry is the source of truth; re-read it when the window regains
  // focus (e.g. returning from the system settings) so the switches never lie.
  useEffect(() => {
    const refresh = () => {
      void window.aiOffice.getFileAssocStatus?.().then((list) => {
        if (list) setFileAssoc(list)
      })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const toggleAssoc = (ext: string, enabled: boolean) => {
    setAssocBusy((m) => ({ ...m, [ext]: true }))
    void window.aiOffice
      .setFileAssocEnabled?.(ext, enabled)
      .then(() => window.aiOffice.getFileAssocStatus?.())
      .then((list) => {
        if (list) setFileAssoc(list)
      })
      .catch(() => {})
      .finally(() => setAssocBusy((m) => ({ ...m, [ext]: false })))
  }

  const openSystemDefaultApps = () => {
    void window.aiOffice.openDefaultAppSettings?.()
  }

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {t(s.labelKey)}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('language')}</label>
                  </div>
                  <SegmentedControl
                    className="set-seg"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('theme')}</label>
                  </div>
                  <SegmentedControl
                    className="set-seg"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('documentTheme')}</label>
                  </div>
                  <SegmentedControl
                    className="set-seg"
                    value={docTheme}
                    ariaLabel={t('documentTheme')}
                    options={DOC_THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyDocumentTheme(v as DocTheme)}
                  />
                </div>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoSave')}</div>
                      <div className="set-field-desc">{t('setAutoSaveDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoSaveOn}
                    aria-label={t('setAutoSave')}
                    onClick={() => {
                      const next = !autoSaveOn
                      setAutoSaveOn(next)
                      void window.aiOffice.setAutoSaveDefault?.(next).catch(() => {})
                    }}
                  />
                </div>
                
              </>
            )}
            {section === 'fileassoc' && (
              <>
                <h3 className="set-pane-title">{t('setSecFileAssoc')}</h3>
                <p className="set-assoc-desc">{t('fileAssocDesc')}</p>
                {fileAssoc.map((entry) => (
                  <div className="set-field" key={entry.ext}>
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{entry.ext}</div>
                        <div className="set-field-desc">
                          {entry.registered
                            ? t('fileAssocRegistered')
                            : t('fileAssocNotRegistered')}
                          {' · '}
                          {entry.isDefault
                            ? t('fileAssocIsDefault')
                            : entry.defaultApp
                              ? t('fileAssocDefaultOther', { app: entry.defaultApp })
                              : t('fileAssocDefaultUnknown')}
                        </div>
                      </div>
                    </div>
                    <button
                      className="set-switch"
                      role="switch"
                      aria-checked={entry.registered}
                      aria-label={t('fileAssocSwitchLabel', { ext: entry.ext })}
                      disabled={Boolean(assocBusy[entry.ext])}
                      onClick={() => toggleAssoc(entry.ext, !entry.registered)}
                    />
                  </div>
                ))}
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setDefaultApp')}</div>
                      <div className="set-field-desc">{t('fileAssocSetDefaultHint')}</div>
                    </div>
                  </div>
                  <button className="set-btn" onClick={openSystemDefaultApps}>
                    {t('fileAssocSetDefault')}
                  </button>
                </div>
              </>
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}