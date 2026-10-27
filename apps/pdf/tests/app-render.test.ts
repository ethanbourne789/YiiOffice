/** First real guardrails for the pdf editor component: it renders at all, and the
    ribbon / empty state answer the document state it was mounted with. Kept
    deliberately shallow -- the point is a rollback signal for refactoring the
    component's state domains, not behavioural coverage the e2e suite already has. */

import { afterEach, describe, expect, it } from 'vitest'
import { t } from '../src/renderer/i18n/locale'
import { mountPdfApp, stubPdfApi, type MountedApp } from './helpers/render-app'

let mounted: MountedApp | null = null

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe('pdf editor mount', () => {
  it('renders without a document', async () => {
    stubPdfApi()
    mounted = await mountPdfApp()
    await mounted.settle()
    expect(mounted.container.childElementCount).toBeGreaterThan(0)
  })

  it('asks the main process for the path queued at tab creation', async () => {
    const calls: string[] = []
    stubPdfApi({
      consumePending: async () => {
        calls.push('consumePending')
        return null
      },
    })
    mounted = await mountPdfApp()
    await mounted.settle()
    expect(calls).toEqual(['consumePending'])
  })

  it('shows the no-document state rather than a page', async () => {
    stubPdfApi()
    mounted = await mountPdfApp()
    await mounted.settle()
    // no canvas: nothing was rendered as a page
    expect(mounted.container.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('reports a failed pending-path lookup instead of hanging on the spinner', async () => {
    // the effect used to let this rejection escape, leaving status at its
    // 'loading' initial value: the view never left the spinner and the renderer
    // logged an unhandled rejection
    stubPdfApi({
      consumePending: async () => {
        throw new Error('no view registered')
      },
    })
    mounted = await mountPdfApp()
    await mounted.settle()
    const text = mounted.container.textContent ?? ''
    expect(text).toContain(t('loadError'))
    expect(text).not.toContain(t('loading'))
  })
})
