declare module '*.md?raw' {
  const content: string
  export default content
}

declare module '*.png' {
  const src: string
  export default src
}

import type { HomeBridge } from '@yiioffice/wails-bridge'
import type { DesktopApi } from '../shared/desktop-api'

declare global {
  interface Window {
    readonly desktop: HomeBridge
    readonly desktopApi: DesktopApi
  }
}

export {}
