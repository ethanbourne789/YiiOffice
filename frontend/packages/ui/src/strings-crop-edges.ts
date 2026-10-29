import type { Lang } from '@yiioffice/i18n'
import type { CropEdge } from './image-dialogs'

// Shared accessible names for the crop edge handles, so every edge is reachable
// by keyboard and still announced in the editor's own language.
export const CROP_EDGE_LABELS: Record<Lang, Record<CropEdge, string>> = {
  zh: {
    nw: '左上边缘',
    n: '上边缘',
    ne: '右上边缘',
    e: '右边缘',
    se: '右下边缘',
    s: '下边缘',
    sw: '左下边缘',
    w: '左边缘',
  },
  en: {
    nw: 'Top left edge',
    n: 'Top edge',
    ne: 'Top right edge',
    e: 'Right edge',
    se: 'Bottom right edge',
    s: 'Bottom edge',
    sw: 'Bottom left edge',
    w: 'Left edge',
  },
}
