/// Drag & drop a local document file anywhere in the app window to open it.
///
/// This module is the DOM-free half: the channel, the extension rules and the
/// payload classifier. Main-process code may import it (the shell classifies
/// what arrives on the channel); the preload-side bridge that touches
/// `window`/`DataTransfer` lives in `drop-open-bridge.ts`, so importing this
/// file never drags browser globals into a main-process program.

export const DROP_OPEN_CHANNEL = "app:open-dropped-files";

/** Extensions routed by apps/shell routeDocumentPath — keep in sync there and
 *  with OPEN_DIALOG_EXTENSIONS / OPEN_LOCAL_EXTENSIONS on the home screen. */
export const OPENABLE_DOC_RE =
  /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|pdf|md|markdown)$/i;

/** Recognized-but-unsupported formats: kept in the sent payload so the shell
 *  can show its "not supported" dialog instead of dropping them silently.
 *  Mirrors UNSUPPORTED_DOC_RE in apps/shell/src/main/index.ts. */
export const KNOWN_UNSUPPORTED_DOC_RE =
  /\.(doc|rtf|odt|ppt|pps|odp|ods|xlsb|pages|key|numbers)$/i;

/** upper bound on how many files one drop may ask to open */
export const MAX_DROPPED_FILES = 20;

/**
 * Sanitize + classify a raw IPC payload: strings only, trimmed, deduped,
 * capped, then split into directly-openable paths and known-unsupported
 * extensions (unique, first-seen order). Anything unrecognized (.png, .zip,
 * nonexistent junk from a hostile sender) falls out silently.
 */
export function partitionDropPayload(raw: unknown): {
  supported: string[];
  unsupportedExts: string[];
} {
  const supported: string[] = [];
  const unsupportedExts: string[] = [];
  if (!Array.isArray(raw)) return { supported, unsupportedExts };
  const seen = new Set<string>();
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "string") continue;
    const path = entry.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (OPENABLE_DOC_RE.test(path)) {
      // keep scanning for unsupported entries even after hitting the open cap
      if (supported.length < MAX_DROPPED_FILES) supported.push(path);
    } else if (KNOWN_UNSUPPORTED_DOC_RE.test(path)) {
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      if (!unsupportedExts.includes(ext)) unsupportedExts.push(ext);
    }
  }
  return { supported, unsupportedExts };
}
