package bridge

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// SaveDocumentResult is returned by SaveDocument.
type SaveDocumentResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// SaveDocument writes markdown text to docPath, asking for a path when the
// document is untitled or saveAs is set (Save As / silent first save).
func (s *MarkdownService) SaveDocument(text string, docPath string, suggestedName string, saveAs bool) SaveDocumentResult {
	path := docPath
	if saveAs || strings.TrimSpace(path) == "" {
		name := sanitizeFileName(suggestedName)
		if strings.TrimSpace(name) == "" {
			name = "document"
		}
		if ext := strings.ToLower(filepath.Ext(name)); ext != ".md" && ext != ".markdown" {
			name += ".md"
		}
		selected, canceled, err := saveFileDialog(name)
		if err != nil {
			return SaveDocumentResult{Error: err.Error()}
		}
		if canceled {
			return SaveDocumentResult{OK: true, Canceled: true}
		}
		path = selected
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return SaveDocumentResult{Error: fmt.Sprintf("create directory: %v", err)}
	}
	if err := s.Save(path, base64.StdEncoding.EncodeToString([]byte(text))); err != nil {
		return SaveDocumentResult{Error: err.Error()}
	}
	return SaveDocumentResult{OK: true, Path: path}
}

// SaveImageBeside stores a pasted image in the assets directory next to
// docPath and returns the path relative to the document (empty for untitled
// documents, which have no assets directory yet).
func (s *MarkdownService) SaveImageBeside(docPath string, base64Data string, ext string) (string, error) {
	if strings.TrimSpace(docPath) == "" {
		return "", nil
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	cleanExt := strings.ToLower(strings.TrimPrefix(ext, "."))
	switch cleanExt {
	case "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg":
	default:
		cleanExt = "png"
	}
	assetsDir := filepath.Join(filepath.Dir(docPath), "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		return "", fmt.Errorf("create assets directory: %w", err)
	}
	name := fmt.Sprintf("image-%d.%s", time.Now().UnixNano(), cleanExt)
	if _, err := s.SaveImage(filepath.Join(assetsDir, name), base64.StdEncoding.EncodeToString(data)); err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join("assets", name)), nil
}

// MarkdownService exposes the Markdown editor real operations as an official
// Wails V3 named binding service.
type MarkdownService struct {
	rm *host.RecentManager
	// roots reports the folder roots the app exposes in the sidebar. ReadImage
	// authorises against them (plus the folder of a recently opened document),
	// so a link inside a document cannot turn into an arbitrary file read.
	roots func() []string

	mu      sync.Mutex
	granted []string // absolute paths a native dialog handed back, oldest first
}

// maxGrantedDialogPaths bounds the dialog grants. The set only has to cover the
// images inserted during one editing session, so it never needs to grow.
const maxGrantedDialogPaths = 64

// NewMarkdownService returns a MarkdownService. roots may be nil, in which case
// only the user profile and recent-document folders are readable.
func NewMarkdownService(rm *host.RecentManager, roots func() []string) *MarkdownService {
	return &MarkdownService{rm: rm, roots: roots}
}

// ReadFile reads a markdown file and returns its text content.
func (s *MarkdownService) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return string(data), nil
}

// Save atomically writes content (base64 or plain text) to the given path.
func (s *MarkdownService) Save(path string, content string) error {
	var data []byte
	if decoded, err := base64.StdEncoding.DecodeString(content); err == nil {
		data = decoded
	} else {
		data = []byte(content)
	}
	return atomicSaveBytes(path, data, func() {
		if s.rm != nil {
			s.rm.AddRecent(path)
		}
	})
}

// SaveImage saves base64-encoded image data to file (atomic) and returns the path.
func (s *MarkdownService) SaveImage(path string, content string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	if err := atomicSaveBytes(path, data, nil); err != nil {
		return "", err
	}
	return path, nil
}

// ReadImage reads an image file and returns its base64-encoded content.
//
// The path is untrusted: the renderer resolves `![](assets/x.png)` against the
// document, so a crafted file could otherwise ask for any path the user can
// read and get its bytes back. ReadImage therefore requires the path to be
// covered by a dialog grant, an authorised root or a recent document's folder.
func (s *MarkdownService) ReadImage(path string) (string, error) {
	authorised, err := s.authoriseImageRead(path)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// authoriseImageRead returns the canonical path ReadImage is allowed to open.
//
// Order matters. A path a native dialog just handed back wins even when it sits
// outside every root — the user picked that file explicitly — and it is checked
// for existence rather than re-authorised by location. Everything else has to
// resolve inside roots ∪ folders of recent documents.
func (s *MarkdownService) authoriseImageRead(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("empty path")
	}
	if granted := s.grantedDialogPath(trimmed); granted != "" {
		if info, err := os.Stat(granted); err == nil && !info.IsDir() {
			return granted, nil
		}
	}
	guard, err := fsutil.NewGuard(localReadRootsWith(s.roots, s.recentDocumentDirs()))
	if err != nil {
		return "", err
	}
	return ValidateLocalPath(guard, trimmed)
}

// recentDocumentDirs returns the folders holding the most recent documents, so
// a note opened from anywhere outside the sidebar can still reach its own
// images. GetRecents skips entries that no longer stat.
func (s *MarkdownService) recentDocumentDirs() []string {
	if s.rm == nil {
		return nil
	}
	entries := s.rm.GetRecents(0, 20)
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

// grantDialogPath remembers a file the user chose in a native dialog.
func (s *MarkdownService) grantDialogPath(path string) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return
	}
	key := strings.ToLower(abs)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.granted {
		if strings.ToLower(existing) == key {
			return
		}
	}
	s.granted = append(s.granted, abs)
	if len(s.granted) > maxGrantedDialogPaths {
		s.granted = s.granted[len(s.granted)-maxGrantedDialogPaths:]
	}
}

// grantedDialogPath reports the granted form of path, or "" when it was never
// handed back by a dialog.
func (s *MarkdownService) grantedDialogPath(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	key := strings.ToLower(abs)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, granted := range s.granted {
		if strings.ToLower(granted) == key {
			return granted
		}
	}
	return ""
}

// PickImage opens a native file dialog for image selection and returns the path.
func (s *MarkdownService) PickImage() (string, error) {
	path, err := openSingleImageDialog()
	if err != nil || strings.TrimSpace(path) == "" {
		return path, err
	}
	s.grantDialogPath(path)
	return path, nil
}

// SaveImageAsResult is returned by SaveImageAs.
type SaveImageAsResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// SaveImageAs reads the source image (local path or data: URL) and writes it via a save dialog.
//
// A local source is authorised exactly like ReadImage: "Save Image As" is
// reachable from a document link, so it must not become a way to copy an
// arbitrary file to a destination the user will later trust.
func (s *MarkdownService) SaveImageAs(src string) SaveImageAsResult {
	if strings.HasPrefix(src, "data:") ||
		strings.HasPrefix(src, "http://") ||
		strings.HasPrefix(src, "https://") {
		return saveImageSourceAs(src)
	}
	authorised, err := s.authoriseImageRead(src)
	if err != nil {
		return SaveImageAsResult{Error: err.Error()}
	}
	return saveImageSourceAs(authorised)
}

// ExportDocxResult is returned by ExportDocx.
type ExportDocxResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// ExportDocx decodes base64 .docx bytes and writes them.
// mode "openInDocs" writes to a temp dir; otherwise uses a save dialog.
func (s *MarkdownService) ExportDocx(base64Data string, suggestedName string, mode string) ExportDocxResult {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ExportDocxResult{OK: false, Error: fmt.Sprintf("decode base64: %v", err)}
	}
	name := suggestedName
	if !strings.HasSuffix(strings.ToLower(name), ".docx") {
		name += ".docx"
	}
	var path string
	if mode == "openInDocs" {
		path, err = writeAppManagedCopy(name, data)
	} else {
		var canceled bool
		path, canceled, err = saveFileDialog(name)
		if err == nil && !canceled {
			err = os.WriteFile(path, data, 0o644)
		} else if err == nil && canceled {
			return ExportDocxResult{OK: true, Canceled: true}
		}
	}
	if err != nil {
		return ExportDocxResult{OK: false, Error: err.Error()}
	}
	return ExportDocxResult{OK: true, Path: path}
}

// ExportPdfResult is returned by ExportPdf.
type ExportPdfResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// ExportPdf renders HTML to a PDF via Edge headless.
func (s *MarkdownService) ExportPdf(html string, suggestedName string, outPath string) ExportPdfResult {
	name := suggestedName
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	var path string
	if outPath != "" {
		path = outPath
	} else {
		var canceled bool
		var err error
		path, canceled, err = saveFileDialog(name)
		if err != nil {
			return ExportPdfResult{OK: false, Error: err.Error()}
		}
		if canceled {
			return ExportPdfResult{OK: true, Canceled: true}
		}
	}
	if err := platform.PrintHTMLToPdf(html, path, platform.PrintOptions{}); err != nil {
		return ExportPdfResult{OK: false, Error: fmt.Sprintf("export pdf: %v", err)}
	}
	return ExportPdfResult{OK: true, Path: path}
}