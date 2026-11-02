package bridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// ExportService renders editor HTML into PDF files and merges the per-group
// PDF parts produced by mixed-paper exports. Rendering goes through the Edge
// headless pipeline in internal/platform, which uses the same Blink engine as
// WebView2.
type ExportService struct{}

// NewExportService returns an ExportService.
func NewExportService() *ExportService { return &ExportService{} }

// ExportResult is the outcome of an export operation. Canceled means the user
// dismissed the save dialog.
type ExportResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Canceled bool   `json:"canceled,omitempty"`
	Error    string `json:"error,omitempty"`
}

// ExportFolder is a picked export directory plus a temp PDF path that the
// renderer may write to without a second dialog.
type ExportFolder struct {
	Dir     string `json:"dir"`
	PdfPath string `json:"pdfPath"`
}

// ExportPdf renders html to a PDF. An empty outPath opens a save dialog;
// widthIn/heightIn (inches) set the sheet size, and zero values fall back to
// the document's own @page rule.
func (s *ExportService) ExportPdf(html string, outPath string, suggestedName string, widthIn float64, heightIn float64) ExportResult {
	return exportPdf(html, outPath, suggestedName, widthIn, heightIn)
}

// exportPdf is the shared HTML→PDF path used by every editor service.
func exportPdf(html string, outPath string, suggestedName string, widthIn float64, heightIn float64) ExportResult {
	if strings.TrimSpace(html) == "" {
		return ExportResult{Error: "empty document"}
	}
	path, canceled, err := resolveExportTarget(suggestedName, outPath, ".pdf")
	if err != nil {
		return ExportResult{Error: err.Error()}
	}
	if canceled {
		return ExportResult{Canceled: true}
	}
	if err := platform.PrintHTMLToPdf(html, path, pageOptions(widthIn, heightIn)); err != nil {
		return ExportResult{Error: fmt.Sprintf("export pdf: %v", err)}
	}
	return ExportResult{OK: true, Path: path}
}

// ExportHtml writes an HTML document to disk through a save dialog (or outPath
// when the caller already owns one).
func (s *ExportService) ExportHtml(html string, outPath string, suggestedName string) ExportResult {
	if strings.TrimSpace(html) == "" {
		return ExportResult{Error: "empty document"}
	}
	path, canceled, err := resolveExportTarget(suggestedName, outPath, ".html")
	if err != nil {
		return ExportResult{Error: err.Error()}
	}
	if canceled {
		return ExportResult{Canceled: true}
	}
	if err := os.WriteFile(path, []byte(html), 0o644); err != nil {
		return ExportResult{Error: fmt.Sprintf("write html: %v", err)}
	}
	return ExportResult{OK: true, Path: path}
}

// RenderPdfBase64 renders html and returns the PDF bytes base64-encoded. Used
// by mixed-paper exports that merge several per-group PDFs afterwards.
func (s *ExportService) RenderPdfBase64(html string, widthIn float64, heightIn float64) (string, error) {
	if strings.TrimSpace(html) == "" {
		return "", fmt.Errorf("empty document")
	}
	tmp, err := os.CreateTemp("", "yiioffice-render-*.pdf")
	if err != nil {
		return "", fmt.Errorf("create temp pdf: %w", err)
	}
	path := tmp.Name()
	tmp.Close()
	os.Remove(path)
	defer os.Remove(path)

	if err := platform.PrintHTMLToPdf(html, path, pageOptions(widthIn, heightIn)); err != nil {
		return "", fmt.Errorf("render pdf: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read rendered pdf: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// MergePdfParts concatenates base64-encoded PDF parts in order and writes the
// result to outPath (a save dialog opens when outPath is empty).
func (s *ExportService) MergePdfParts(parts []string, outPath string, suggestedName string) ExportResult {
	if len(parts) == 0 {
		return ExportResult{Error: "no pdf parts to merge"}
	}
	dir, err := os.MkdirTemp("", "yiioffice-merge-*")
	if err != nil {
		return ExportResult{Error: fmt.Sprintf("create temp dir: %v", err)}
	}
	defer os.RemoveAll(dir)

	files := make([]string, 0, len(parts))
	for i, part := range parts {
		data, derr := base64.StdEncoding.DecodeString(part)
		if derr != nil {
			return ExportResult{Error: fmt.Sprintf("decode part %d: %v", i, derr)}
		}
		file := filepath.Join(dir, fmt.Sprintf("part-%03d.pdf", i))
		if werr := os.WriteFile(file, data, 0o644); werr != nil {
			return ExportResult{Error: fmt.Sprintf("write part %d: %v", i, werr)}
		}
		files = append(files, file)
	}

	merged := filepath.Join(dir, "merged.pdf")
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	if err := api.MergeCreateFile(ctx, files, merged, false, nil); err != nil {
		return ExportResult{Error: fmt.Sprintf("merge pdf: %v", err)}
	}

	path, canceled, err := resolveExportTarget(suggestedName, outPath, ".pdf")
	if err != nil {
		return ExportResult{Error: err.Error()}
	}
	if canceled {
		return ExportResult{Canceled: true}
	}
	data, err := os.ReadFile(merged)
	if err != nil {
		return ExportResult{Error: fmt.Sprintf("read merged pdf: %v", err)}
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ExportResult{Error: fmt.Sprintf("write pdf: %v", err)}
	}
	return ExportResult{OK: true, Path: path}
}

// PickExportFolder opens a folder picker for "Export as Images" and returns the
// chosen directory together with a temp PDF path the renderer may write to.
// Both are granted: the directory subtree (image exports write files into it)
// and the temp PDF path (TakeTempPdf reads it back).
func (s *ExportService) PickExportFolder(title string) (ExportFolder, error) {
	app := platform.App()
	if app == nil {
		return ExportFolder{}, fmt.Errorf("app not available")
	}
	if title == "" {
		title = "Export as Images"
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return ExportFolder{}, err
	}
	if dir == "" {
		return ExportFolder{}, nil
	}
	GrantDir(dir)
	tmp, err := os.CreateTemp("", "yiioffice-export-*.pdf")
	if err != nil {
		return ExportFolder{}, fmt.Errorf("create temp pdf: %w", err)
	}
	pdfPath := tmp.Name()
	tmp.Close()
	os.Remove(pdfPath)
	GrantFile(pdfPath)
	return ExportFolder{Dir: dir, PdfPath: pdfPath}, nil
}

// PickSaveFile opens a save dialog and returns the chosen path. An empty
// result means the user canceled.
func (s *ExportService) PickSaveFile(defaultName string, ext string) (string, error) {
	name := sanitizeFileName(defaultName)
	if strings.TrimSpace(name) == "" {
		name = "document"
	}
	if ext != "" && !strings.HasSuffix(strings.ToLower(name), strings.ToLower(ext)) {
		name += ext
	}
	path, canceled, err := saveFileDialog(name)
	if err != nil {
		return "", err
	}
	if canceled {
		return "", nil
	}
	return path, nil
}

// TakeTempPdf reads a temp PDF written for an image export and deletes it.
// Only paths handed out by PickExportFolder (or otherwise granted) are
// accepted, so this cannot become a way to read and delete arbitrary files.
func (s *ExportService) TakeTempPdf(path string) (string, error) {
	authorised, err := AuthoriseWrite(path)
	if err != nil {
		return "", fmt.Errorf("temp pdf path: %w", err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", fmt.Errorf("read pdf: %w", err)
	}
	os.Remove(authorised)
	return base64.StdEncoding.EncodeToString(data), nil
}

// WriteBase64File writes base64-encoded bytes to path and returns the path.
// The path must be granted (inside a picked export folder, or a file the user
// opened/picked this session); arbitrary paths are rejected.
func (s *ExportService) WriteBase64File(path string, content string) ExportResult {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return ExportResult{Error: fmt.Sprintf("decode content: %v", err)}
	}
	authorised, err := AuthoriseWrite(path)
	if err != nil {
		return ExportResult{Error: err.Error()}
	}
	if err := os.MkdirAll(filepath.Dir(authorised), 0o755); err != nil {
		return ExportResult{Error: fmt.Sprintf("create directory: %v", err)}
	}
	if err := os.WriteFile(authorised, data, 0o644); err != nil {
		return ExportResult{Error: fmt.Sprintf("write file: %v", err)}
	}
	return ExportResult{OK: true, Path: authorised}
}

// ListPrinters returns the names of the installed system printers.
func (s *ExportService) ListPrinters() []PrinterInfo {
	return resolversListPrinters()
}

// pageOptions builds the print options for a sheet size given in inches.
func pageOptions(widthIn, heightIn float64) platform.PrintOptions {
	if widthIn <= 0 || heightIn <= 0 {
		return platform.PrintOptions{}
	}
	return platform.PrintOptions{PageSize: &platform.PageSizeInches{Width: widthIn, Height: heightIn}}
}

// resolveExportTarget normalizes the file name and resolves the write target.
// An empty outPath opens a save dialog (whose result is granted). A supplied
// outPath must already be granted — a save-dialog pick, an opened file, or a
// path inside a picked export folder — otherwise the export is rejected rather
// than written to an arbitrary location.
func resolveExportTarget(suggestedName, outPath, ext string) (string, bool, error) {
	name := sanitizeFileName(suggestedName)
	if strings.TrimSpace(name) == "" {
		name = "document"
	}
	if !strings.HasSuffix(strings.ToLower(name), ext) {
		name += ext
	}
	if outPath != "" {
		authorised, err := AuthoriseWrite(outPath)
		if err != nil {
			return "", false, err
		}
		if err := os.MkdirAll(filepath.Dir(authorised), 0o755); err != nil {
			return "", false, fmt.Errorf("create output directory: %w", err)
		}
		return authorised, false, nil
	}
	return saveFileDialog(name)
}
