import { Injector, ThemeService } from '@univerjs/core'

/**
 * Univer 1.x 的 `SpreadsheetSkeleton` 构造时向注入器索取 `ThemeService`
 * （网格线颜色随主题变化），0.x 不需要。测试里手搓 skeleton 时必须给一个
 * 真注入器，否则 `new SpreadsheetSkeleton(...)` 在 `_injector.get(ThemeService)`
 * 上直接抛 `Cannot read properties of undefined (reading 'get')`。
 */
export function createThemeInjector(): Injector {
  return new Injector([[ThemeService, { useClass: ThemeService }]])
}
