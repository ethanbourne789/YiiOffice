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
			return SaveDocumentResult{Error: codedMessage(ErrSaveDialogFailed, err.Error())}
		}
		if canceled {
			return SaveDocumentResult{OK: true, Canceled: true}
		}
		path = selected
	}
	// Authorise before touching the filesystem: a rejected path must not even
	// get its parent directory created.
	if _, err := AuthoriseWrite(path); err != nil {
		return SaveDocumentResult{Error: codedMessage(ErrSavePathNotAuthorised, err.Error())}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return SaveDocumentResult{Error: codedMessage(ErrSaveDirectoryFailed, err.Error())}
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
		return "", codedError(ErrSaveDecodeFailed, err)
	}
	cleanExt := strings.ToLower(strings.TrimPrefix(ext, "."))
	switch cleanExt {
	case "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg":
	default:
		cleanExt = "png"
	}
	// The assets directory belongs to the document, so writing into it is
	// allowed exactly when the document itself was opened through a granted
	// path (a dialog pick or the Home open funnel).
	if _, err := AuthoriseWrite(docPath); err != nil {
		return "", codedError(ErrSavePathNotAuthorised, err)
	}
	assetsDir := filepath.Join(filepath.Dir(docPath), "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		return "", codedError(ErrSaveDirectoryFailed, err)
	}
	GrantDir(assetsDir)
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
}

// NewMarkdownService returns a MarkdownService. roots may be nil, in which case
// only the user profile and recent-document folders are readable.
func NewMarkdownService(rm *host.RecentManager, roots func() []string) *MarkdownService {
	return &MarkdownService{rm: rm, roots: roots}
}

// ReadFile reads a markdown file and returns its text content. The path must
// have been granted (dialog pick or Home open funnel) or sit inside the
// authorised roots, so a crafted document cannot name any file it likes.
func (s *MarkdownService) ReadFile(path string) (string, error) {
	authorised, err := authoriseLocalFileRead(s.roots, recentDocumentDirs(s.rm), path)
	if err != nil {
		return "", codedError(ErrOpenPathNotAuthorised, err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", codedError(ErrOpenReadFailed, err)
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
		return "", codedError(ErrSaveDecodeFailed, err)
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
		return "", codedError(ErrOpenPathNotAuthorised, err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", codedError(ErrOpenReadFailed, err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// authoriseImageRead returns the canonical path ReadImage is allowed to open
// (shared policy: dialog grants first, then roots ∪ recent-document folders).
func (s *MarkdownService) authoriseImageRead(path string) (string, error) {
	return authoriseLocalImageRead(s.roots, recentDocumentDirs(s.rm), path)
}

// PickImage opens a native file dialog for image selection and returns the
// path. The dialog helper records the grant used by later reads and writes.
func (s *MarkdownService) PickImage() (string, error) {
	path, err := openSingleImageDialog()
	return path, codedError(ErrOpenDialogFailed, err)
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
// A local source is authorised exactly like ReadImage inside
// saveImageSourceAs: "Save Image As" is reachable from a document link, so it
// must not become a way to copy an arbitrary file to a destination the user
// will later trust.
func (s *MarkdownService) SaveImageAs(src string) SaveImageAsResult {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return SaveImageAsResult{Error: codedMessage(ErrOpenUnsupportedType, "remote image sources are not supported")}
	}
	return saveImageSourceAs(src, s.roots, recentDocumentDirs(s.rm))
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
		return ExportDocxResult{OK: false, Error: codedMessage(ErrExportDecodeFailed, err.Error())}
	}
	// The name is renderer-supplied: sanitize before it reaches any
	// filepath.Join (openInDocs) or dialog default.
	name := sanitizeFileName(suggestedName)
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
			if werr := os.WriteFile(path, data, 0o644); werr != nil {
				return ExportDocxResult{OK: false, Error: codedMessage(ErrExportWriteFailed, werr.Error())}
			}
		} else if err == nil && canceled {
			return ExportDocxResult{OK: true, Canceled: true}
		} else if err != nil {
			return ExportDocxResult{OK: false, Error: codedMessage(ErrExportDialogFailed, err.Error())}
		}
	}
	if err != nil {
		return ExportDocxResult{OK: false, Error: codedMessage(ErrExportWriteFailed, err.Error())}
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
//
// outPath must be a path the user already chose this session (a save-dialog
// result or an opened file); anything else is rejected instead of being
// written silently. An empty outPath opens the dialog, which grants the path.
func (s *MarkdownService) ExportPdf(html string, suggestedName string, outPath string) ExportPdfResult {
	name := sanitizeFileName(suggestedName)
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	path := outPath
	if outPath != "" {
		authorised, err := AuthoriseWrite(outPath)
		if err != nil {
			return ExportPdfResult{OK: false, Error: codedMessage(ErrExportTargetNotAuthorised, err.Error())}
		}
		path = authorised
	} else {
		var canceled bool
		var err error
		path, canceled, err = saveFileDialog(name)
		if err != nil {
			return ExportPdfResult{OK: false, Error: codedMessage(ErrExportDialogFailed, err.Error())}
		}
		if canceled {
			return ExportPdfResult{OK: true, Canceled: true}
		}
	}
	if err := platform.PrintHTMLToPdf(html, path, platform.PrintOptions{}); err != nil {
		return ExportPdfResult{OK: false, Error: codedMessage(ErrExportRenderFailed, err.Error())}
	}
	return ExportPdfResult{OK: true, Path: path}
}
