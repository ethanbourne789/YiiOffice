package bridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/pdfengine"
)

// PdfService exposes the PDF editor real operations (file I/O + structural
// editing) as an official Wails V3 named binding service.
type PdfService struct {
	rm *host.RecentManager
}

// NewPdfService returns a PdfService.
func NewPdfService(rm *host.RecentManager) *PdfService {
	return &PdfService{rm: rm}
}

// ReadFile reads a PDF file and returns its base64-encoded content.
func (s *PdfService) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// Save atomically writes base64-decoded content to the given path.
func (s *PdfService) Save(path string, content string) error {
	if path == "." || path == "" {
		return fmt.Errorf("invalid save path: %q", path)
	}
	return atomicBase64Save(path, content, func() {
		if s.rm != nil {
			s.rm.AddRecent(path)
		}
	})
}

// SaveAs atomically writes base64-decoded content to a new path and returns it.
func (s *PdfService) SaveAs(path string, content string) (string, error) {
	if err := atomicBase64Save(path, content, func() {
		if s.rm != nil {
			s.rm.AddRecent(path)
		}
	}); err != nil {
		return "", err
	}
	return path, nil
}

// --- PDF structural operations (backed by pdfengine) ---

func (s *PdfService) ExtractPages(filePath string, selectedPages []int, targetPath string) (any, error) {
	return pdfengine.ExtractPages(context.Background(), filePath, selectedPages, targetPath)
}

func (s *PdfService) InsertPdf(filePath string, pdf2Path string, page int, position string) (any, error) {
	return pdfengine.InsertPdf(context.Background(), filePath, pdf2Path, page, position)
}

func (s *PdfService) SplitPdf(filePath string, targetPath string, splitString string) (any, error) {
	return pdfengine.Split(context.Background(), filePath, targetPath, splitString)
}

func (s *PdfService) MergePdf(filePaths []string, targetPath string, outName string) (any, error) {
	return pdfengine.Merge(context.Background(), filePaths, targetPath, outName)
}

func (s *PdfService) MergePages(filePath string, selectedPages []int, nupSpan int, targetPath string) (any, error) {
	return pdfengine.NUp(context.Background(), filePath, selectedPages, nupSpan, targetPath)
}

func (s *PdfService) ReplacePages(filePath string, replacePath string, page int) (any, error) {
	return pdfengine.ReplacePages(context.Background(), filePath, replacePath, page)
}

func (s *PdfService) SetPageSize(filePath string, width float64, height float64, selectedPages []int) (any, error) {
	return pdfengine.SetPageSize(context.Background(), filePath, width, height, selectedPages)
}

func (s *PdfService) SplitPages(filePath string, selectedPages []int, gridRows int, gridCols int, targetPath string) (any, error) {
	return pdfengine.SplitPages(context.Background(), filePath, selectedPages, gridRows, gridCols, targetPath)
}

func (s *PdfService) CropPages(filePath string, selectedPages []int, cropArea [4]float64, targetPath string) (any, error) {
	return pdfengine.CropPages(context.Background(), filePath, selectedPages, cropArea, targetPath)
}

func (s *PdfService) ExportImages(filePath string, selectedPages []int, targetPath string) (any, error) {
	return pdfengine.ExportImages(context.Background(), filePath, selectedPages, targetPath)
}

func (s *PdfService) ListPageImages(filePath string, pageIndex int) (any, error) {
	return pdfengine.ListPageImages(context.Background(), filePath, pageIndex)
}

// InsertBlankPage inserts one blank page before `page` (1-based) and returns the
// path of the new document.
func (s *PdfService) InsertBlankPage(filePath string, page int) (any, error) {
	return pdfengine.InsertBlankPage(context.Background(), filePath, page)
}