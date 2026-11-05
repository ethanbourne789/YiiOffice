/// Gate for the automation globals (`__aidocs`, `__exportPdf`, `__docsParseStats`).
///
/// They exist so device verification and Playwright drivers can drive open,
/// edit, save and export without native dialogs. That is a powerful surface: a
/// same-origin iframe or an injected script could write files with it, so it
/// must not be present in a shipped build. Two ways in:
///
///   1. `import.meta.env.DEV` — the vite dev server (stripped from builds).
///   2. `window.__yiiofficeDebugHooks` — set by the shell before boot when
///      YIIOFFICE_DEBUG_HOOKS=1, which is how the built-app E2E run and manual
///      device checks opt in.
export function debugHooksEnabled(): boolean {
  if (import.meta.env.DEV) return true
  return (window as unknown as Record<string, unknown>).__yiiofficeDebugHooks === true
}

/** Publishes one automation global and returns an uninstaller. */
export function installDebugGlobal(name: string, value: unknown): () => void {
  const host = window as unknown as Record<string, unknown>
  host[name] = value
  return () => {
    delete host[name]
  }
}
