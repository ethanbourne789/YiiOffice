import { Component, type ReactNode, type ErrorInfo } from 'react'
import { createI18n, type Lang } from '@yiioffice/i18n'
import { strings } from './strings'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

const translate = createI18n(strings)

function currentLang(): Lang {
  try {
    const l = (window as any).aiOffice?.getLanguage?.()
    if (l === 'zh' || l === 'en') return l
  } catch { /* runtime already broken */ }
  return 'en'
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
    this.setState({ hasError: true })
  }

  render() {
    if (this.state.hasError) {
      const lang = currentLang()
      const t = (key: 'errorBoundaryTitle' | 'errorBoundaryReload') =>
        translate(lang, key, undefined)
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            backgroundColor: 'var(--bg, #f5f5f5)',
            color: 'var(--fg, #333)',
            fontFamily: 'sans-serif',
          }}
        >
          <p style={{ fontSize: 16, marginBottom: 16 }}>
            {t('errorBoundaryTitle')}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              cursor: 'pointer',
              borderRadius: 4,
              border: '1px solid var(--border, #ccc)',
              backgroundColor: 'var(--bg-secondary, #fff)',
              color: 'var(--fg, #333)',
            }}
          >
            {t('errorBoundaryReload')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
