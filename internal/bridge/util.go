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

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// ── URL validation ──

// maxExternalURLLength keeps clipboard/URL-bar abuse out of the shell opener.
const maxExternalURLLength = 2048

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
	return file, nil
}

// saveFileDialog shows a native save dialog and returns the chosen path.
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
	return path, false, nil
}

// openFileDialog shows a native open file dialog and returns the chosen path (single select).
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
	return dialog.PromptForMultipleSelection()
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
	return dialog.PromptForMultipleSelection()
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

// saveImageSourceAs writes an editor image (local path or data: URL) to a
// user-chosen path.
func saveImageSourceAs(src string) SaveImageAsResult {
	var data []byte
	var defaultName string
	if strings.HasPrefix(src, "data:") {
		comma := strings.Index(src, ",")
		if comma < 0 {
			return SaveImageAsResult{Error: "malformed data url"}
		}
		header := src[:comma]
		decoded, err := base64.StdEncoding.DecodeString(src[comma+1:])
		if err != nil {
			return SaveImageAsResult{Error: fmt.Sprintf("decode data url: %v", err)}
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
		read, err := os.ReadFile(src)
		if err != nil {
			return SaveImageAsResult{Error: fmt.Sprintf("read source: %v", err)}
		}
		data = read
		defaultName = filepath.Base(src)
	}
	path, canceled, err := saveFileDialog(defaultName)
	if err != nil {
		return SaveImageAsResult{Error: err.Error()}
	}
	if canceled {
		return SaveImageAsResult{Canceled: true}
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return SaveImageAsResult{Error: fmt.Sprintf("write: %v", err)}
	}
	return SaveImageAsResult{OK: true, Path: path}
}

// writeAppManagedCopy writes data to a temp file in the app-managed directory
// and returns the path (used for "openInDocs" export flow).
func writeAppManagedCopy(name string, data []byte) (string, error) {
	dataDir, err := host.AppDataDir()
	if err != nil {
		return "", fmt.Errorf("app data dir: %w", err)
	}
	defaultDir := filepath.Join(dataDir, "exports")
	if err := os.MkdirAll(defaultDir, 0o755); err != nil {
		return "", fmt.Errorf("create export dir: %w", err)
	}
	path := filepath.Join(defaultDir, name)
	return path, os.WriteFile(path, data, 0o644)
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

func replaceRunes(s string, fn func(rune) bool, replacement rune) string {
	runes := []rune(s)
	for i, r := range runes {
		if fn(r) {
			runes[i] = replacement
		}
	}
	return string(runes)
}
