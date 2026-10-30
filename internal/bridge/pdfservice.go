package bridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"

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
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return fmt.Errorf("decode content: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "*.tmp")
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

// SaveAs atomically writes base64-decoded content to a new path and returns it.
func (s *PdfService) SaveAs(path string, content string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return "", fmt.Errorf("decode content: %w", err)
	}
	dir := filepath.Dir(path)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("create directory: %w", err)
		}
	}
	tmp, err := os.CreateTemp(dir, "*.tmp")
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
	if s.rm != nil {
		s.rm.AddRecent(path)
	}
	return path, nil
}

// --- PDF structural operations (backed by pdfengine) ---

type PdfPageImagesRequest struct {
	FilePath  string `json:"filePath"`
	PageIndex int    `json:"pageIndex"`
}

type PdfFormRequest struct {
	FilePath string `json:"filePath"`
}

type PdfExportImagesRequest struct {
	FilePath      string `json:"filePath"`
	SelectedPages []int  `json:"selectedPages"`
	TargetPath    string `json:"targetPath"`
}

type PdfInsertPdfRequest struct {
	FilePath string `json:"filePath"`
	Pdf2Path string `json:"pdf2Path"`
	Page     int    `json:"page"`
	Position string `json:"position"`
}

type PdfSplitPdfRequest struct {
	FilePath    string `json:"filePath"`
	TargetPath  string `json:"targetPath"`
	SplitString string `json:"splitString"`
}

type PdfMergePdfRequest struct {
	FilePaths  []string `json:"filePaths"`
	TargetPath string   `json:"targetPath"`
	OutName    string   `json:"outName"`
}

type PdfMergePagesRequest struct {
	FilePath      string `json:"filePath"`
	SelectedPages []int  `json:"selectedPages"`
	NupSpan       int    `json:"nupSpan"`
	TargetPath    string `json:"targetPath"`
}

type PdfSplitPagesRequest struct {
	FilePath      string `json:"filePath"`
	SelectedPages []int  `json:"selectedPages"`
	GridRows      int    `json:"gridRows"`
	GridCols      int    `json:"gridCols"`
	TargetPath    string `json:"targetPath"`
}

type PdfReplacePagesRequest struct {
	FilePath    string `json:"filePath"`
	ReplacePath string `json:"replacePath"`
	Page        int    `json:"page"`
}

type PdfSetPageSizeRequest struct {
	FilePath      string  `json:"filePath"`
	Width         float64 `json:"width"`
	Height        float64 `json:"height"`
	SelectedPages []int   `json:"selectedPages"`
}

type PdfCropPagesRequest struct {
	FilePath      string    `json:"filePath"`
	SelectedPages []int     `json:"selectedPages"`
	CropArea      [4]float64 `json:"cropArea"`
	TargetPath    string    `json:"targetPath"`
}

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