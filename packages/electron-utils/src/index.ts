export {
  buildContextMenuItems,
  contextMenuLabels,
  installContextMenu,
  setContextMenuInterceptor,
  VIEW_IMAGE_CHANNEL,
  type ContextMenuInterceptor,
  type ContextMenuItem,
  type ContextMenuLabels,
} from "./context-menu";
export {
  decodeDataUrl,
  isSavableImageUrl,
  saveImageFromUrl,
  suggestImageFileName,
  type SaveImageResult,
} from "./save-image";
export {
  aboutMenuItem,
  appMenuLabels,
  editMenuTemplate,
  helpMenuTemplate,
  toggleDevToolsItem,
  viewMenuTemplate,
  windowMenuTemplate,
  type AppMenuLabels,
  type ViewMenuOptions,
} from "./app-menu";
export { GITHUB_REPO_URL } from "./github-menu";
export {
  saveAsSuggestion,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
} from "./dialog-memory";
export {
  DEFAULT_SAVE_DIR_KEY,
  configuredDefaultSaveDir,
  isUsableSaveDir,
  readDefaultSaveDirSetting,
  resolveDefaultSaveDir,
  type PathProvider,
} from "./default-save-dir";
export { installNavigationGuard } from "./navigation-guard";
// Deliberately not re-exported here: ./drop-open-bridge and friends carry
// DOM-shaped preload helpers, and this barrel is imported by every main
// process — re-exporting them made a DOM lib mandatory for main programs.
// Import the bridge through `@yiioffice/electron-utils/drop-open-bridge`.
export {
  safeExternalUrl,
  type SafeExternalUrlOptions,
} from "./safe-external-url";
export {
  fetchWithSsrfGuard,
  isBlockedAddress,
  isSafeRemoteUrl,
  type FetchWithSsrfGuardOptions,
} from "./safe-remote-url";
export {
  MAX_REMOTE_IMAGE_BYTES,
  ResponseTooLargeError,
  fetchRemoteImage,
  readBodyCapped,
  remoteImageHeaders,
} from "./remote-image";
export {
  GENERATED_IMAGE_DIR,
  readGeneratedImage,
  storeGeneratedImage,
} from "./generated-images";
export {
  buildPrintableHtml,
  printHtmlToPdf,
  sanitizePrintableBody,
  type PrintableHtml,
  type PrintWindow,
} from "./print-html-pdf";
export { isHeadlessMode, setHeadlessMode } from "./headless-mode";
export {
  HEADLESS_EXIT,
  HEADLESS_EXPORT_FLAG,
  HEADLESS_SUPPORTED_EXTENSIONS,
  HEADLESS_TARGETS,
  formatHeadlessEnvelope,
  headlessExitCode,
  headlessModuleFor,
  headlessSummary,
  parseHeadlessExportArgv,
  type HeadlessArgvParse,
  type HeadlessExitCode,
  type HeadlessExportFormat,
  type HeadlessExportModule,
  type HeadlessExportOutcome,
  type HeadlessExportRequest,
  type HeadlessExportTarget,
} from "./headless-export";
export {
  RENDERER_SCHEME,
  DOCX_MEDIA_SCHEME_PRIVILEGE,
  RENDERER_SCHEME_PRIVILEGE,
  rendererUrl,
  resolveRendererFile,
  type RendererHost,
} from "./renderer-scheme";
export {
  installRendererProtocol,
  registerRendererScheme,
} from "./renderer-protocol";
export { atomicWriteFile, writeJsonAtomic } from "./atomic-write";
export {
  PRINT_READY_SCRIPT,
  printHtmlDocument,
  type PrintDialogOutcome,
  type PrintDialogWindow,
  type PrintDocumentOptions,
} from "./print-window";
export { abortOnDestroyed, type DestroyableSender } from "./abort-on-destroyed";
