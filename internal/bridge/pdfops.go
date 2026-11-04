package bridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/pdfengine"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// PdfOpResult is the outcome of an editor-facing PDF page operation. Canceled
// means the user dismissed a file or folder dialog.
type PdfOpResult struct {
	OK       bool   `json:"ok"`
	Canceled bool   `json:"canceled,omitempty"`
	Path     string `json:"path,omitempty"`
	SavedDir string `json:"savedDir,omitempty"`
	Count    int    `json:"count,omitempty"`
	Pages    int    `json:"pages,omitempty"`
	Error    string `json:"error,omitempty"`
}

// pdfOpTimeout bounds pdfcpu work on large documents.
const pdfOpTimeout = 120 * time.Second

// pickFolder opens the native folder picker and returns "" when canceled.
func pickFolder(title string) (string, error) {
	app := platform.App()
	if app == nil {
		return "", fmt.Errorf("%s", ErrAppUnavailable)
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return "", codedError(ErrPdfOpDialogFailed, err)
	}
	if dir != "" {
		GrantDir(dir)
	}
	return dir, nil
}

// pickOtherPdf opens a PDF picker; the returned list is empty when canceled.
func pickOtherPdf(title string) ([]string, error) {
	files, err := pickFilesByKind(title, "pdf")
	if err != nil {
		return nil, codedError(ErrPdfOpDialogFailed, err)
	}
	return files, nil
}

// savePdfDialog asks for the output file of a derived document.
func savePdfDialog(suggestedName string) (string, bool, error) {
	name := sanitizeFileName(suggestedName)
	if strings.TrimSpace(name) == "" {
		name = "document"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	path, canceled, err := saveFileDialog(name)
	return path, canceled, codedError(ErrPdfOpDialogFailed, err)
}

// tempPdfNear reserves a temp PDF path in the directory of near, so an in-place
// rewrite can finish with a same-volume atomic rename.
func tempPdfNear(near string) (string, error) {
	f, err := os.CreateTemp(filepath.Dir(near), "pdfop-*.pdf")
	if err != nil {
		return "", codedError(ErrPdfOpFailed, err)
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return name, nil
}

// replaceWithTemp moves the finished temp document over target.
func replaceWithTemp(tmp, target string) error {
	if err := os.Rename(tmp, target); err != nil {
		os.Remove(tmp)
		return codedError(ErrPdfOpFailed, err)
	}
	return nil
}

// ── Page extraction / insertion / replacement ──

// ExtractPagesToFile keeps the selected pages in one new PDF (save dialog).
func (s *PdfService) ExtractPagesToFile(filePath string, pages []int, suggestedName string) PdfOpResult {
	out, canceled, err := savePdfDialog(suggestedName)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if canceled {
		return PdfOpResult{Canceled: true}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	count, err := pdfengine.ExtractRangeToFile(ctx, src, out, pages)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: out, Count: count}
}

// InsertPdfFromDialog asks for a PDF and inserts all of its pages after
// afterPageIndex (0-based, -1 = front), rewriting the open document in place.
func (s *PdfService) InsertPdfFromDialog(filePath string, afterPageIndex int) PdfOpResult {
	files, err := pickOtherPdf("Insert PDF")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if len(files) == 0 {
		return PdfOpResult{Canceled: true}
	}
	if _, err := s.authoriseTarget(filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	tmp, err := tempPdfNear(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	inserted, err := pdfengine.InsertPdfToFile(ctx, filePath, files[0], afterPageIndex, tmp)
	if err != nil {
		os.Remove(tmp)
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	if err := replaceWithTemp(tmp, filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	return PdfOpResult{OK: true, Path: filePath, Pages: inserted}
}

// ReplacePagesFromDialog replaces the selected pages with a picked PDF's pages,
// rewriting the open document in place.
func (s *PdfService) ReplacePagesFromDialog(filePath string, pages []int) PdfOpResult {
	files, err := pickOtherPdf("Replace With PDF")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if len(files) == 0 {
		return PdfOpResult{Canceled: true}
	}
	if _, err := s.authoriseTarget(filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	tmp, err := tempPdfNear(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	removed, inserted, err := pdfengine.ReplaceWithPdfToFile(ctx, filePath, files[0], pages, tmp)
	if err != nil {
		os.Remove(tmp)
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	if err := replaceWithTemp(tmp, filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	return PdfOpResult{OK: true, Path: filePath, Count: removed, Pages: inserted}
}

// ── Merge / split ──

// MergePdfFromDialog appends picked PDFs to the open document.
func (s *PdfService) MergePdfFromDialog(filePath string, suggestedName string) PdfOpResult {
	files, err := pickOtherPdf("Merge PDF")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if len(files) == 0 {
		return PdfOpResult{Canceled: true}
	}
	out, canceled, err := savePdfDialog(suggestedName)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if canceled {
		return PdfOpResult{Canceled: true}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	inFiles := append([]string{src}, files...)
	pageCount, err := pdfengine.MergeFiles(ctx, inFiles, out)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: out, Pages: pageCount}
}

// SplitPdfToFolder writes consecutive page-span files into a picked folder.
func (s *PdfService) SplitPdfToFolder(filePath string, chunkSize int) PdfOpResult {
	dir, err := pickFolder("Split PDF")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if dir == "" {
		return PdfOpResult{Canceled: true}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	files, err := pdfengine.SplitToDir(ctx, src, chunkSize, dir)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, SavedDir: dir, Count: len(files)}
}

// MergePagesToFile lays pagesPerSheet pages onto each output page. direction is
// "horizontal" or "vertical"; separator draws cell borders.
func (s *PdfService) MergePagesToFile(filePath string, pages []int, pagesPerSheet int, direction string, separator bool, suggestedName string) PdfOpResult {
	out, canceled, err := savePdfDialog(suggestedName)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if canceled {
		return PdfOpResult{Canceled: true}
	}
	var opts []string
	if strings.EqualFold(direction, "vertical") {
		opts = append(opts, "orient:dr")
	} else {
		opts = append(opts, "orient:rd")
	}
	if separator {
		opts = append(opts, "border:on")
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	pageCount, err := pdfengine.NUpToFile(ctx, src, pages, pagesPerSheet, strings.Join(opts, ","), out)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: out, Pages: pageCount}
}

// SplitPagesToFile splits each selected page into a rows x cols grid.
func (s *PdfService) SplitPagesToFile(filePath string, pages []int, rows, cols int, suggestedName string) PdfOpResult {
	out, canceled, err := savePdfDialog(suggestedName)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if canceled {
		return PdfOpResult{Canceled: true}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	pageCount, err := pdfengine.CutToFile(ctx, src, pages, rows, cols, out)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: out, Pages: pageCount}
}

// ── Crop / page size / images ──

// InsertBlankPageAfter inserts one blank page after afterPageIndex (0-based,
// -1 = front) and rewrites the open document in place.
func (s *PdfService) InsertBlankPageAfter(filePath string, afterPageIndex int) PdfOpResult {
	if _, err := s.authoriseTarget(filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	// InsertBlankPage inserts before a 1-based page number.
	page := afterPageIndex + 2
	if _, err := pdfengine.InsertBlankPage(ctx, filePath, page); err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: filePath}
}

// CropPagesFractional shrinks the selected pages to a fractional rectangle of
// each page and rewrites the open document in place.
func (s *PdfService) CropPagesFractional(filePath string, pages []int, left, top, right, bottom float64) PdfOpResult {
	if _, err := s.authoriseTarget(filePath); err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	if err := pdfengine.CropFractionInPlace(ctx, filePath, pages, [4]float64{left, top, right, bottom}); err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	return PdfOpResult{OK: true, Path: filePath}
}

// ExportImagesToFolder writes embedded images of the selected pages to a picked
// folder. Pages are 1-based; an empty selection exports every page.
func (s *PdfService) ExportImagesToFolder(filePath string, pages []int) PdfOpResult {
	dir, err := pickFolder("Export Images")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if dir == "" {
		return PdfOpResult{Canceled: true}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pdfOpTimeout)
	defer cancel()
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	result, err := pdfengine.ExportImages(ctx, src, pages, dir)
	if err != nil {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, err.Error())}
	}
	count := 0
	if m, ok := result.(map[string]any); ok {
		if c, ok := m["count"].(int); ok {
			count = c
		}
	}
	return PdfOpResult{OK: true, SavedDir: dir, Count: count}
}

// ExportPageImages writes renderer-rasterised page bitmaps (base64 PNG, no
// data: prefix) into a picked folder as `<baseName>-<page>.png`.
func (s *PdfService) ExportPageImages(images []string, pageNumbers []int, baseName string) PdfOpResult {
	if len(images) == 0 {
		return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, "no page images to export")}
	}
	dir, err := pickFolder("Export Pages as Images")
	if err != nil {
		return PdfOpResult{Error: err.Error()}
	}
	if dir == "" {
		return PdfOpResult{Canceled: true}
	}
	base := sanitizeFileName(baseName)
	if base == "" {
		base = "page"
	}
	written := 0
	for i, encoded := range images {
		data, derr := base64.StdEncoding.DecodeString(encoded)
		if derr != nil {
			return PdfOpResult{Error: codedMessage(ErrPdfOpDecodeFailed, fmt.Sprintf("page %d: %v", i+1, derr))}
		}
		pageNr := i + 1
		if i < len(pageNumbers) && pageNumbers[i] > 0 {
			pageNr = pageNumbers[i]
		}
		path := filepath.Join(dir, fmt.Sprintf("%s-%03d.png", base, pageNr))
		if werr := os.WriteFile(path, data, 0o644); werr != nil {
			return PdfOpResult{Error: codedMessage(ErrPdfOpFailed, fmt.Sprintf("write page %d: %v", pageNr, werr))}
		}
		written++
	}
	return PdfOpResult{OK: true, SavedDir: dir, Count: written}
}
