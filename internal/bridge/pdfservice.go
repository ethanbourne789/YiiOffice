package bridge

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

// authoriseRead validates a PDF source path for reading: granted this session
// (dialog pick or Home open funnel) or inside the guard roots.
func (s *PdfService) authoriseRead(path string) (string, error) {
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	return authorised, codedError(ErrOpenPathNotAuthorised, err)
}

// authoriseTarget validates an in-place write target against the session
// grants: the document must have been opened or picked through a trusted flow.
func (s *PdfService) authoriseTarget(path string) (string, error) {
	authorised, err := AuthoriseWrite(path)
	return authorised, codedError(ErrPdfOpNotAuthorised, err)
}

// authoriseTargetDir validates a folder write target (split / export-to-folder).
func (s *PdfService) authoriseTargetDir(dir string) (string, error) {
	authorised, err := AuthoriseWriteDir(dir)
	return authorised, codedError(ErrPdfOpNotAuthorised, err)
}

// derivedSiblingPath mirrors pdfengine's derived-output naming (the source's
// directory + base name + a fixed suffix) so the bridge can pre-grant the
// result file. The renderer cannot steer the output beyond the authorised
// source path.
func derivedSiblingPath(inFile, suffix string) string {
	base := strings.TrimSuffix(filepath.Base(inFile), filepath.Ext(inFile))
	return filepath.Join(filepath.Dir(inFile), base+suffix)
}

// ReadFile reads a PDF file and returns its base64-encoded content. The path
// must be granted (dialog pick or Home open funnel) or inside the authorised
// roots.
func (s *PdfService) ReadFile(path string) (string, error) {
	authorised, err := s.authoriseRead(path)
	if err != nil {
		return "", codedError(ErrOpenPathNotAuthorised, err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", codedError(ErrOpenReadFailed, err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// Save atomically writes base64-decoded content to the given path.
func (s *PdfService) Save(path string, content string) error {
	if path == "." || path == "" {
		return codedError(ErrSavePathInvalid, fmt.Errorf("invalid save path: %q", path))
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
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.ExtractPages(context.Background(), src, selectedPages, dir)
}

func (s *PdfService) InsertPdf(filePath string, pdf2Path string, page int, position string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	other, err := s.authoriseRead(pdf2Path)
	if err != nil {
		return nil, err
	}
	GrantFile(derivedSiblingPath(src, "_modified.pdf"))
	return pdfengine.InsertPdf(context.Background(), src, other, page, position)
}

func (s *PdfService) SplitPdf(filePath string, targetPath string, splitString string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.Split(context.Background(), src, dir, splitString)
}

func (s *PdfService) MergePdf(filePaths []string, targetPath string, outName string) (any, error) {
	srcs := make([]string, 0, len(filePaths))
	for _, f := range filePaths {
		src, err := s.authoriseRead(f)
		if err != nil {
			return nil, err
		}
		srcs = append(srcs, src)
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	name := outName
	if strings.TrimSpace(name) != "" {
		name = sanitizeFileName(name)
	}
	return pdfengine.Merge(context.Background(), srcs, dir, name)
}

func (s *PdfService) MergePages(filePath string, selectedPages []int, nupSpan int, targetPath string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.NUp(context.Background(), src, selectedPages, nupSpan, dir)
}

func (s *PdfService) ReplacePages(filePath string, replacePath string, page int) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	other, err := s.authoriseRead(replacePath)
	if err != nil {
		return nil, err
	}
	GrantFile(derivedSiblingPath(src, "_replaced.pdf"))
	return pdfengine.ReplacePages(context.Background(), src, other, page)
}

func (s *PdfService) SetPageSize(filePath string, width float64, height float64, selectedPages []int) (any, error) {
	target, err := s.authoriseTarget(filePath)
	if err != nil {
		return nil, err
	}
	return pdfengine.SetPageSize(context.Background(), target, width, height, selectedPages)
}

func (s *PdfService) SplitPages(filePath string, selectedPages []int, gridRows int, gridCols int, targetPath string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.SplitPages(context.Background(), src, selectedPages, gridRows, gridCols, dir)
}

func (s *PdfService) CropPages(filePath string, selectedPages []int, cropArea [4]float64, targetPath string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.CropPages(context.Background(), src, selectedPages, cropArea, dir)
}

func (s *PdfService) ExportImages(filePath string, selectedPages []int, targetPath string) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	dir, err := s.authoriseTargetDir(targetPath)
	if err != nil {
		return nil, err
	}
	return pdfengine.ExportImages(context.Background(), src, selectedPages, dir)
}

func (s *PdfService) ListPageImages(filePath string, pageIndex int) (any, error) {
	src, err := s.authoriseRead(filePath)
	if err != nil {
		return nil, err
	}
	return pdfengine.ListPageImages(context.Background(), src, pageIndex)
}

// InsertBlankPage inserts one blank page before `page` (1-based) and returns the
// path of the new document. The rewrite is in place, so the document must be
// granted for writing.
func (s *PdfService) InsertBlankPage(filePath string, page int) (any, error) {
	target, err := s.authoriseTarget(filePath)
	if err != nil {
		return nil, err
	}
	return pdfengine.InsertBlankPage(context.Background(), target, page)
}
