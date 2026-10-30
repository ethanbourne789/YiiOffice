package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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
}

// NewMarkdownService returns a MarkdownService.
func NewMarkdownService(rm *host.RecentManager) *MarkdownService {
	return &MarkdownService{rm: rm}
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
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "*.tmp")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("write temp: %w", err)
	}
	tmp.Close()
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename: %w", err)
	}
	if s.rm != nil {
		s.rm.AddRecent(path)
	}
	return nil
}

// SaveImage saves base64-encoded image data to file (atomic) and returns the path.
func (s *MarkdownService) SaveImage(path string, content string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "*.tmp")
	if err != nil {
		return "", fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", fmt.Errorf("write temp: %w", err)
	}
	tmp.Close()
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return "", fmt.Errorf("rename: %w", err)
	}
	return path, nil
}

// ReadImage reads an image file and returns its base64-encoded content.
func (s *MarkdownService) ReadImage(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// PickImage opens a native file dialog for image selection and returns the path.
func (s *MarkdownService) PickImage() (string, error) {
	return openSingleImageDialog()
}

// SaveImageAsResult is returned by SaveImageAs.
type SaveImageAsResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// SaveImageAs reads the source image and writes it via a save dialog.
func (s *MarkdownService) SaveImageAs(src string) SaveImageAsResult {
	data, err := os.ReadFile(src)
	if err != nil {
		return SaveImageAsResult{OK: false, Error: fmt.Sprintf("read source: %v", err)}
	}
	defaultName := filepath.Base(src)
	path, canceled, err := saveFileDialog(defaultName)
	if err != nil {
		return SaveImageAsResult{OK: false, Error: err.Error()}
	}
	if canceled {
		return SaveImageAsResult{OK: false, Canceled: true}
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return SaveImageAsResult{OK: false, Error: fmt.Sprintf("write: %v", err)}
	}
	return SaveImageAsResult{OK: true, Path: path}
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