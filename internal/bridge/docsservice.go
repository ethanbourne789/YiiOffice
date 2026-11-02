package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// DocsService exposes the Docs editor real operations as an official Wails V3
// named binding service. Stub channels (export-pdf, print, spell, context-menu,
// mcp, etc.) remain on the legacy Router and are not generated here.
type DocsService struct {
	rm    *host.RecentManager
	idxLc *index.Lifecycle
}

// NewDocsService returns a DocsService.
func NewDocsService(rm *host.RecentManager, idxLc *index.Lifecycle) *DocsService {
	return &DocsService{rm: rm, idxLc: idxLc}
}

// docsFileSave atomically writes base64-decoded content to path (temp + rename).
func docsFileSave(path, content string, idxLc *index.Lifecycle) error {
	return atomicBase64Save(path, content, func() {
		if idxLc != nil {
			idxLc.Refresh()
		}
	})
}

// OpenPath reads a file and returns its base64-encoded content.
func (s *DocsService) OpenPath(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// Save atomically writes base64-decoded content to the given path.
func (s *DocsService) Save(path string, content string) error {
	return docsFileSave(path, content, s.idxLc)
}

// SaveAs atomically writes base64-decoded content to a new path and returns it.
func (s *DocsService) SaveAs(path string, content string) (string, error) {
	if err := docsFileSave(path, content, s.idxLc); err != nil {
		return "", err
	}
	return path, nil
}

// SaveTo atomically writes base64-decoded content to the given path.
func (s *DocsService) SaveTo(path string, content string) error {
	return docsFileSave(path, content, s.idxLc)
}

// Opened records the file in the recent list.
func (s *DocsService) Opened(path string) {
	if s.rm != nil {
		s.rm.AddRecent(path)
	}
}

// PickFiles opens a native multi-select dialog filtered by media kind and
// returns the chosen paths. A canceled dialog yields an empty slice.
func (s *DocsService) PickFiles(kind string) ([]string, error) {
	files, err := pickFilesByKind("Insert Media", kind)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []string{}
	}
	return files, nil
}

// PickedImage carries an image chosen through the insert-image dialog.
type PickedImage struct {
	Base64 string `json:"base64"`
	Mime   string `json:"mime"`
	Name   string `json:"name"`
}

// PickImage opens a native image picker and returns the file base64-encoded.
// A canceled dialog yields (nil, nil).
func (s *DocsService) PickImage() (*PickedImage, error) {
	path, err := openSingleImageDialog()
	if err != nil || path == "" {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read image: %w", err)
	}
	return &PickedImage{
		Base64: base64.StdEncoding.EncodeToString(data),
		Mime:   imageMime(path),
		Name:   filepath.Base(path),
	}, nil
}

// SaveImageAs writes the given image to a user-chosen path. src may be a local
// path or a data: URL produced by the editor. The result type is shared with
// MarkdownService.
func (s *DocsService) SaveImageAs(src string) SaveImageAsResult {
	return saveImageSourceAs(src)
}

// Renamed emits the file-renamed event and refreshes the index.
func (s *DocsService) Renamed(path string, title string) {
	platform.Emit("home:file-renamed", map[string]any{
		"path":  path,
		"title": title,
	})
	if s.idxLc != nil {
		s.idxLc.Refresh()
	}
}

// ExportPdf renders the editor's HTML to a PDF file. An empty outPath asks
// the user for a location; widthIn/heightIn (inches) select the sheet size,
// zero values keep the document's own @page settings.
func (s *DocsService) ExportPdf(html string, outPath string, suggestedName string, widthIn float64, heightIn float64) ExportResult {
	return exportPdf(html, outPath, suggestedName, widthIn, heightIn)
}

// DocxOpenResult carries the path and base64 content of an opened docx, or an error.
type DocxOpenResult struct {
	Path   string `json:"path,omitempty"`
	Base64 string `json:"base64,omitempty"`
	Error  string `json:"error,omitempty"`
}

// DocxSaveResult reports whether a save succeeded, and the final path.
type DocxSaveResult struct {
	Path  string `json:"path,omitempty"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// OpenDocx opens a docx file via a native dialog and returns the base64 content.
func (s *DocsService) OpenDocx() DocxOpenResult {
	files, err := openFileDialog("Open Document", "*.docx")
	if err != nil || len(files) == 0 {
		return DocxOpenResult{}
	}
	path := files[0]
	data, err := os.ReadFile(path)
	if err != nil {
		return DocxOpenResult{Error: fmt.Sprintf("read file: %v", err)}
	}
	s.Opened(path)
	return DocxOpenResult{Path: path, Base64: base64.StdEncoding.EncodeToString(data)}
}

// OpenDocxPath reads a docx file at the given path and returns base64 content.
func (s *DocsService) OpenDocxPath(path string) DocxOpenResult {
	if path == "" {
		return DocxOpenResult{Error: "empty path"}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return DocxOpenResult{Error: fmt.Sprintf("read file: %v", err)}
	}
	s.Opened(path)
	return DocxOpenResult{Path: path, Base64: base64.StdEncoding.EncodeToString(data)}
}

// OpenDocxDecrypt reads a potentially encrypted docx file.
// Password-protected docx decryption is handled by the frontend docx-engine.
// Go reads and returns the raw bytes; frontend decrypts.
func (s *DocsService) OpenDocxDecrypt(path, _password string) DocxOpenResult {
	return s.OpenDocxPath(path)
}

// SaveDocx writes base64-decoded content to the given path.
func (s *DocsService) SaveDocx(path, content string, _auto bool) DocxSaveResult {
	if path == "" {
		return DocxSaveResult{Error: "empty path"}
	}
	if err := docsFileSave(path, content, s.idxLc); err != nil {
		return DocxSaveResult{Error: err.Error()}
	}
	return DocxSaveResult{Path: path, OK: true}
}

// SaveDocxAs prompts the user for a save location and writes the content.
func (s *DocsService) SaveDocxAs(suggestedName, content, srcPath string) DocxSaveResult {
	ext := ".docx"
	name := suggestedName
	if strings.TrimSpace(name) == "" {
		name = "document.docx"
	}
	if !strings.HasSuffix(strings.ToLower(name), ext) {
		name += ext
	}
	path, canceled, err := saveFileDialog(name)
	if err != nil {
		return DocxSaveResult{Error: err.Error()}
	}
	if canceled {
		return DocxSaveResult{}
	}
	if err := docsFileSave(path, content, s.idxLc); err != nil {
		return DocxSaveResult{Error: err.Error()}
	}
	s.rm.AddRecent(path)
	return DocxSaveResult{Path: path, OK: true}
}

// SaveDocxNew creates a new document file via a save dialog.
func (s *DocsService) SaveDocxNew(suggestedName, content string) DocxSaveResult {
	return s.SaveDocxAs(suggestedName, content, "")
}

// SaveDocxTo writes content directly to the given path.
func (s *DocsService) SaveDocxTo(path, content string, _overwrite bool) DocxSaveResult {
	if err := docsFileSave(path, content, s.idxLc); err != nil {
		return DocxSaveResult{Error: err.Error()}
	}
	return DocxSaveResult{Path: path, OK: true}
}

// WriteRecoveryCopy saves a recovery copy of the document.
func (s *DocsService) WriteRecoveryCopy(path, content string) error {
	dataDir, err := host.AppDataDir()
	if err != nil {
		return fmt.Errorf("app data dir: %w", err)
	}
	recoveryDir := filepath.Join(dataDir, "documents", "recovery")
	if err := os.MkdirAll(recoveryDir, 0o755); err != nil {
		return fmt.Errorf("create recovery dir: %w", err)
	}
	base := filepath.Base(path)
	if base == "" {
		base = "untitled"
	}
	recoveryPath := filepath.Join(recoveryDir, base)
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return fmt.Errorf("decode content: %w", err)
	}
	return os.WriteFile(recoveryPath, data, 0o644)
}

// SetDocPassword is a no-op stub for frontend API compatibility.
// Document password state is entirely managed by the frontend; the backend
// does not store or enforce passwords.
func (s *DocsService) SetDocPassword(_path, _password string) error {
	return nil
}

// DocPasswordIntentRevision is a no-op stub for frontend API compatibility.
// Always returns 0 because password intent tracking is a frontend-only concern.
func (s *DocsService) DocPasswordIntentRevision() int {
	return 0
}

// DiscardDocPasswordIntents is a no-op stub for frontend API compatibility.
// There are no server-side password intents to discard.
func (s *DocsService) DiscardDocPasswordIntents(_rev int) {
}

// ConfirmDocumentReplace is a no-op stub for frontend API compatibility.
// Always returns true; the frontend handles actual replacement confirmation.
func (s *DocsService) ConfirmDocumentReplace() bool {
	return true
}

// GetSystemLocale returns the system locale for the editor. Detection (and the
// LANG fallback) lives in internal/platform so both the docs and pdf editors
// answer the same way on every OS.
func (s *DocsService) GetSystemLocale() string {
	return platform.SystemLocale()
}

// ConsumePendingOpenDocx returns the pending file open path (no-op at Go level;
// renderer resolves path from Tab.Path via currentTabPath()).
func (s *DocsService) ConsumePendingOpenDocx() DocxOpenResult {
	return DocxOpenResult{}
}

// ConsumeNewBlankDoc returns whether the tab requested a blank document (no-op at Go level).
func (s *DocsService) ConsumeNewBlankDoc() bool {
	return false
}