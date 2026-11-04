package bridge

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// ── URL and path validation ──

// maxExternalURLLength keeps clipboard/URL-bar abuse out of the shell opener.
const maxExternalURLLength = 2048

// maxLocalImageSize limits image file reads to 50 MB to prevent memory exhaustion.
const maxLocalImageSize = 50 << 20

// ValidateLocalPath authorises path against the guard's root set and returns
// the canonical absolute path to read.
//
// The old rule was "must live under the user's home directory", which both
// rejected legitimate files in a folder root the user had added on another
// drive and waved through anything under the profile. Roots are now the set
// the app actually exposes (see localReadRoots), and the guard additionally
// rejects device names, alternate data streams and symlink escapes.
//
// Image extensions only: every caller embeds the bytes in a renderer.
func ValidateLocalPath(guard *fsutil.Guard, path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("empty path")
	}
	if guard == nil {
		return "", errors.New("no authorised roots configured")
	}
	abs, err := guard.Authorize(path)
	if err != nil {
		return "", err
	}
	ext := strings.ToLower(filepath.Ext(abs))
	if !isImageExt(ext) {
		return "", fmt.Errorf("extension not allowed: %s", ext)
	}
	return abs, nil
}

// isImageExt reports whether ext is on the image allowlist every local image
// read must satisfy — even for a path the user picked in a dialog.
func isImageExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff":
		return true
	}
	return false
}

// localReadRoots resolves the directories a renderer may pull local file bytes
// from: the folder roots the user configured (the default save folder plus any
// folder added to the sidebar) and the user profile, where files opened from
// Explorer, Downloads and Desktop live.
//
// Missing roots (unplugged drive, deleted folder) are dropped instead of
// failing: fsutil.NewGuard requires existing roots, and one stale entry must
// not disable every other root.
func localReadRoots(configured func() []string) []string {
	return localReadRootsWith(configured, nil)
}

// localReadRootsWith is localReadRoots plus caller-supplied extra directories.
//
// The extras exist for callers whose legitimate files sit outside the sidebar
// roots: a document opened from an arbitrary folder keeps its images next to
// itself, so that folder has to be readable too. They pass through the same
// "must still exist and be a directory" filter, which means a stale entry (the
// document was deleted) cannot widen the set.
func localReadRootsWith(configured func() []string, extra []string) []string {
	var candidates []string
	if configured != nil {
		candidates = append(candidates, configured()...)
	}
	candidates = append(candidates, extra...)
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, home)
	}
	seen := make(map[string]struct{}, len(candidates))
	out := make([]string, 0, len(candidates))
	for _, root := range candidates {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue
		}
		key := strings.ToLower(filepath.Clean(root))
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, root)
	}
	return out
}

// LocalImageFile builds the authoriser behind the /md-asset route: it applies
// the same policy as ShellService.ReadLocalImage (same roots, same extension
// allowlist, same symlink resolution) and hands back the canonical path the
// asset server streams.
//
// Two transports, one policy: the binding returns base64 for editor content,
// the HTTP route streams for `<img src>`. Sharing this function is what keeps
// them from drifting apart.
//
// The guard is rebuilt per call because the root set changes at runtime (add
// or remove a sidebar folder); it is a handful of stat/realpath calls.
func LocalImageFile(roots func() []string) func(string) (string, error) {
	return func(raw string) (string, error) {
		guard, err := fsutil.NewGuard(localReadRoots(roots))
		if err != nil {
			return "", err
		}
		return ValidateLocalPath(guard, raw)
	}
}

// ValidateExternalURL accepts only plain http(s) URLs with no embedded credentials.
func ValidateExternalURL(raw string) error {
	if raw == "" {
		return errors.New("empty url")
	}
	if len(raw) > maxExternalURLLength {
		return fmt.Errorf("url too long: %d", len(raw))
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("scheme not allowed: %s", parsed.Scheme)
	}
	if parsed.User != nil {
		return errors.New("credentials in url not allowed")
	}
	if parsed.Host == "" {
		return errors.New("missing host")
	}
	if strings.ContainsAny(raw, "\r\n\t") {
		return errors.New("control characters not allowed")
	}
	return nil
}

// ── Dialog helpers ──

// openSingleImageDialog opens a native file dialog for image selection.
// The chosen path is granted for reads and writes for the rest of the session.
func openSingleImageDialog() (string, error) {
	app := platform.App()
	if app == nil {
		return "", fmt.Errorf("app not available")
	}
	file, err := app.Dialog.OpenFile().
		SetTitle("Select Image").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if file != "" {
		GrantFile(file)
	}
	return file, nil
}

// saveFileDialog shows a native save dialog and returns the chosen path. The
// chosen path is granted for writes: the user picked that location explicitly,
// which is exactly what the write whitelist is meant to record.
func saveFileDialog(defaultName string) (path string, canceled bool, err error) {
	app := platform.App()
	if app == nil {
		return "", false, fmt.Errorf("app not available")
	}
	path, err = app.Dialog.SaveFile().
		SetFilename(defaultName).
		PromptForSingleSelection()
	if err != nil {
		return "", false, err
	}
	if path == "" {
		return "", true, nil
	}
	GrantFile(path)
	return path, false, nil
}

// openFileDialog shows a native open file dialog and returns the chosen path (single select).
// Chosen paths are granted so the editor can read and later save them.
func openFileDialog(title string, filterExt ...string) ([]string, error) {
	app := platform.App()
	if app == nil {
		return nil, fmt.Errorf("app not available")
	}
	dialog := app.Dialog.OpenFile().SetTitle(title)
	for _, ext := range filterExt {
		dialog.AddFilter(ext, ext)
	}
	dialog.AddFilter("All Files", "*.*")
	files, err := dialog.PromptForMultipleSelection()
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		GrantFile(f)
	}
	return files, nil
}

// pickFilesByKind opens a multi-select dialog restricted to the media kind
// ("image", "video", "audio", "pdf" or "" for any file).
func pickFilesByKind(title, kind string) ([]string, error) {
	app := platform.App()
	if app == nil {
		return nil, fmt.Errorf("app not available")
	}
	dialog := app.Dialog.OpenFile().SetTitle(title)
	switch strings.ToLower(kind) {
	case "image":
		dialog.AddFilter("Images", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg;*.tiff")
	case "video":
		dialog.AddFilter("Videos", "*.mp4;*.webm;*.mov;*.avi;*.mkv;*.m4v")
	case "audio":
		dialog.AddFilter("Audio", "*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.aac")
	case "pdf":
		dialog.AddFilter("PDF", "*.pdf")
	}
	dialog.AddFilter("All Files", "*.*")
	files, err := dialog.PromptForMultipleSelection()
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		GrantFile(f)
	}
	return files, nil
}

// imageMime maps an image extension to its MIME type. Unknown extensions fall
// back to PNG, which the editors accept for any raster payload.
func imageMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "image/png"
	}
}

// authoriseLocalImageRead returns the canonical path a local image read may
// open. A path a native dialog handed back this session wins even when it sits
// outside every root (the user picked it explicitly); everything else has to
// resolve inside roots ∪ extra, with the same device-name / alternate-stream /
// symlink checks the guard applies. This is the single policy shared by
// ReadImage, SaveImageAs and the /md-asset route so the transports cannot drift.
func authoriseLocalImageRead(roots func() []string, extra []string, path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("empty path")
	}
	if globalGrants.Allowed(trimmed) {
		if abs, err := canonicalWritePath(trimmed); err == nil {
			if info, err := os.Stat(abs); err == nil && !info.IsDir() {
				// The grant decides *where* a read may go; the image
				// allowlist still applies, so a granted .txt stays
				// unreadable through this entry point.
				if ext := strings.ToLower(filepath.Ext(abs)); !isImageExt(ext) {
					return "", fmt.Errorf("extension not allowed: %s", ext)
				}
				return abs, nil
			}
		}
	}
	guard, err := fsutil.NewGuard(localReadRootsWith(roots, extra))
	if err != nil {
		return "", err
	}
	return ValidateLocalPath(guard, trimmed)
}

// authoriseLocalFileRead is authoriseLocalImageRead without the image
// extension allowlist: it is the policy for document/media reads (open a file,
// read a dropped media asset). A granted path (dialog pick, or a file the Home
// open funnel accepted) passes; otherwise the path must resolve inside
// roots ∪ extra through the guard.
func authoriseLocalFileRead(roots func() []string, extra []string, path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("empty path")
	}
	if globalGrants.Allowed(trimmed) {
		if abs, err := canonicalWritePath(trimmed); err == nil {
			return abs, nil
		}
	}
	guard, err := fsutil.NewGuard(localReadRootsWith(roots, extra))
	if err != nil {
		return "", err
	}
	return guard.Authorize(trimmed)
}

// recentDocumentDirs returns the folders holding the most recent documents, so
// a note opened from anywhere outside the sidebar can still reach its own
// images. GetRecents skips entries that no longer stat.
func recentDocumentDirs(rm *host.RecentManager) []string {
	if rm == nil {
		return nil
	}
	entries := rm.GetRecents(0, 20)
	dirs := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Path == "" {
			continue
		}
		if dir := filepath.Dir(entry.Path); dir != "." && dir != string(filepath.Separator) {
			dirs = append(dirs, dir)
		}
	}
	return dirs
}

// saveImageSourceAs writes an editor image (local path or data: URL) to a
// user-chosen path.
//
// A local source is authorised exactly like ReadImage: "Save Image As" is
// reachable from a document link, so it must not become a way to read an
// arbitrary file and hand its bytes back under a name the user will later
// trust. roots/extra carry the per-service authorisation inputs (sidebar
// folders, recent-document folders).
func saveImageSourceAs(src string, roots func() []string, extra []string) SaveImageAsResult {
	var data []byte
	var defaultName string
	if strings.HasPrefix(src, "data:") {
		comma := strings.Index(src, ",")
		if comma < 0 {
			return SaveImageAsResult{Error: codedMessage(ErrOpenUnsupportedType, "malformed data url")}
		}
		header := src[:comma]
		decoded, err := base64.StdEncoding.DecodeString(src[comma+1:])
		if err != nil {
			return SaveImageAsResult{Error: codedMessage(ErrSaveDecodeFailed, err.Error())}
		}
		data = decoded
		ext := ".png"
		if strings.Contains(header, "image/jpeg") {
			ext = ".jpg"
		} else if strings.Contains(header, "image/gif") {
			ext = ".gif"
		} else if strings.Contains(header, "image/webp") {
			ext = ".webp"
		} else if strings.Contains(header, "image/svg") {
			ext = ".svg"
		}
		defaultName = "image" + ext
	} else {
		authorised, err := authoriseLocalImageRead(roots, extra, src)
		if err != nil {
			return SaveImageAsResult{Error: codedMessage(ErrOpenPathNotAuthorised, err.Error())}
		}
		read, err := os.ReadFile(authorised)
		if err != nil {
			return SaveImageAsResult{Error: codedMessage(ErrOpenReadFailed, err.Error())}
		}
		data = read
		defaultName = filepath.Base(authorised)
	}
	path, canceled, err := saveFileDialog(defaultName)
	if err != nil {
		return SaveImageAsResult{Error: codedMessage(ErrSaveDialogFailed, err.Error())}
	}
	if canceled {
		return SaveImageAsResult{Canceled: true}
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return SaveImageAsResult{Error: codedMessage(ErrSaveWriteFailed, err.Error())}
	}
	return SaveImageAsResult{OK: true, Path: path}
}

// writeAppManagedCopy writes data to a temp file in the app-managed directory
// and returns the path (used for "openInDocs" export flow).
func writeAppManagedCopy(name string, data []byte) (string, error) {
	dataDir, err := host.AppDataDir()
	if err != nil {
		return "", codedError(ErrExportWriteFailed, err)
	}
	defaultDir := filepath.Join(dataDir, "exports")
	if err := os.MkdirAll(defaultDir, 0o755); err != nil {
		return "", codedError(ErrExportWriteFailed, err)
	}
	// The name arrives from the renderer; strip any path components so a
	// "../.." cannot escape the exports directory.
	path := filepath.Join(defaultDir, sanitizeFileName(name))
	return path, codedError(ErrExportWriteFailed, os.WriteFile(path, data, 0o644))
}

// ── File name helpers ──

// defaultCreateDir returns the user's default save directory.
func defaultCreateDir() (string, error) {
	dataDir, err := host.AppDataDir()
	if err != nil {
		return "", err
	}
	saveDir := filepath.Join(dataDir, "documents")
	if err := os.MkdirAll(saveDir, 0o755); err != nil {
		return "", err
	}
	return saveDir, nil
}

// sanitizeFileName replaces characters that are invalid in file names.
var invalidFileChar = regexp.MustCompile(`[<>:"/\\|?*]`)

func sanitizeFileName(name string) string {
	// Strip path components before replacing separators, otherwise the
	// separators turn into underscores and the directory prefix survives.
	based := filepath.Base(name)
	sanitized := invalidFileChar.ReplaceAllString(based, "_")
	sanitized = replaceRunes(sanitized, func(r rune) bool {
		return r == 0 || unicode.IsControl(r)
	}, '_')
	if sanitized == "" || sanitized == "." || sanitized == ".." || strings.Trim(sanitized, "_") == "" {
		sanitized = "document"
	}
	return sanitized
}

// resolversListPrinters returns the list of installed system printers as PrinterInfo.
func resolversListPrinters() []PrinterInfo {
	names := platform.ListPrinterNames()
	out := make([]PrinterInfo, 0, len(names))
	for _, name := range names {
		out = append(out, PrinterInfo{Name: name, DisplayName: name})
	}
	return out
}

func replaceRunes(s string, fn func(rune) bool, replacement rune) string {
	runes := []rune(s)
	for i, r := range runes {
		if fn(r) {
			runes[i] = replacement
		}
	}
	return string(runes)
}
