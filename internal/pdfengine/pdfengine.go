// Package pdfengine wraps the pdfcpu api package to provide high-level PDF
// structural operations for the bridge layer. Every exported func returns a
// JSON-serialisable result (map[string]any) plus an optional error that carries
// a human-readable message.
//
// Note: pdfcpu APIs only write to NEW output files; in-place operations (crop /
// set-page-size) are performed by writing to a temp file and then atomically
// renaming over the original.
package pdfengine

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// requireFile guards against missing inputs.
func requireFile(path string) error {
	if path == "" {
		return fmt.Errorf("missing input file path")
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("input file not found: %s", path)
	}
	return nil
}

// pageSelection converts 1-based page numbers into the []string selection
// format pdfcpu expects (one page-number token per entry, e.g. "1","3","5").
func pageSelection(pages []int) []string {
	if len(pages) == 0 {
		return nil
	}
	sel := make([]string, 0, len(pages))
	for _, p := range pages {
		sel = append(sel, strconv.Itoa(p))
	}
	return sel
}

// baseName returns the output file name used for derived documents.
func baseName(inFile string) string {
	return strings.TrimSuffix(filepath.Base(inFile), filepath.Ext(inFile))
}

// outNameFor returns a default output path next to targetDir for input inFile.
func outNameFor(targetPath, inFile string) string {
	return filepath.Join(targetPath, baseName(inFile)+".pdf")
}

// sizeof returns the page count of a PDF by reading its context.
func sizeof(ctx context.Context, inFile string) (int, error) {
	c, err := api.ReadContextFile(ctx, inFile)
	if err != nil {
		return 0, fmt.Errorf("read page count: %w", err)
	}
	return c.PageCount, nil
}

// pagePdfsInDir lists the "_page_N.pdf" files produced by ExtractPagesFile,
// sorted numerically by their trailing page number.
func pagePdfsInDir(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read extracted pages dir: %w", err)
	}
	type item struct {
		n   int
		nm  string
	}
	var items []item
	for _, e := range entries {
		nm := e.Name()
		if !strings.Contains(nm, "_page_") || !strings.HasSuffix(nm, ".pdf") {
			continue
		}
		numStr := strings.TrimSuffix(strings.SplitN(nm, "_page_", 2)[1], ".pdf")
		n, err := strconv.Atoi(numStr)
		if err != nil {
			continue
		}
		items = append(items, item{n: n, nm: filepath.Join(dir, nm)})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].n < items[j].n })
	files := make([]string, 0, len(items))
	for _, it := range items {
		files = append(files, it.nm)
	}
	return files, nil
}

// extractRangeToFile extracts pages [start..end] (1-based) into a single tmp
// PDF file at outFile. If the range is empty no file is written and nil is
// returned (used as an "empty part").
func extractRangeToFile(ctx context.Context, inFile, outFile string, start, end int) error {
	if start > end {
		return nil
	}
	tmpDir, err := os.MkdirTemp("", "pdfrange-")
	if err != nil {
		return fmt.Errorf("create tmp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if _, err := os.Stat(outFile); err == nil {
		if err := os.Remove(outFile); err != nil {
			return fmt.Errorf("remove stale output: %w", err)
		}
	}

	sel := []string{fmt.Sprintf("%d-%d", start, end)}
	if err := api.ExtractPagesFile(ctx, inFile, tmpDir, sel, nil); err != nil {
		return fmt.Errorf("extract range %d-%d: %w", start, end, err)
	}
	files, err := pagePdfsInDir(tmpDir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("no pages extracted for range %d-%d", start, end)
	}
	if err := api.MergeCreateFile(ctx, files, outFile, false, nil); err != nil {
		return fmt.Errorf("merge range %d-%d: %w", start, end, err)
	}
	return nil
}

func makeRangePart(ctx context.Context, inFile string, start, end int) (string, error) {
	if start > end {
		return "", nil
	}
	f, err := os.CreateTemp("", "part-*.pdf")
	if err != nil {
		return "", fmt.Errorf("create part tmp: %w", err)
	}
	partPath := f.Name()
	f.Close()
	if err := extractRangeToFile(ctx, inFile, partPath, start, end); err != nil {
		os.Remove(partPath)
		return "", err
	}
	return partPath, nil
}

// assembleMerge merges the given file parts into outFile, skipping empty ones.
func assembleMerge(ctx context.Context, parts []string, outFile string) error {
	var files []string
	for _, p := range parts {
		if p == "" {
			continue
		}
		files = append(files, p)
	}
	if len(files) == 0 {
		return fmt.Errorf("no content to assemble")
	}
	return api.MergeCreateFile(ctx, files, outFile, false, nil)
}

//
// ---- Channel operations ---------------------------------------------------
//

// Merge concatenates filePaths into a single PDF at targetPath/outName.
func Merge(ctx context.Context, filePaths []string, targetPath, outName string) (any, error) {
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("no input files to merge")
	}
	for _, f := range filePaths {
		if err := requireFile(f); err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	if outName == "" {
		outName = "merged.pdf"
	}
	outFile := filepath.Join(targetPath, outName)
	if err := api.MergeCreateFile(ctx, filePaths, outFile, false, nil); err != nil {
		return nil, fmt.Errorf("merge: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// Split splits filePath into consecutive page-span files inside targetPath.
// splitString is parsed as a span integer (number of pages per output file).
func Split(ctx context.Context, filePath, targetPath, splitString string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	span, err := strconv.Atoi(strings.TrimSpace(splitString))
	if err != nil || span <= 0 {
		return nil, fmt.Errorf("invalid split span: %q", splitString)
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	if err := api.SplitFile(ctx, filePath, targetPath, span, nil); err != nil {
		return nil, fmt.Errorf("split: %w", err)
	}
	entries, err := os.ReadDir(targetPath)
	if err != nil {
		return nil, fmt.Errorf("read split output: %w", err)
	}
	base := baseName(filePath)
	var saved []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".pdf") {
			continue
		}
		if strings.HasPrefix(e.Name(), base) {
			saved = append(saved, filepath.Join(targetPath, e.Name()))
		}
	}
	sort.Strings(saved)
	return map[string]any{"ok": true, "savedPaths": saved}, nil
}

// ExtractPages extracts each selected page into its own PDF inside targetPath.
func ExtractPages(ctx context.Context, filePath string, selectedPages []int, targetPath string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	if err := api.ExtractPagesFile(ctx, filePath, targetPath, pageSelection(selectedPages), nil); err != nil {
		return nil, fmt.Errorf("extract pages: %w", err)
	}
	files, err := pagePdfsInDir(targetPath)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "savedPaths": files}, nil
}

// InsertPdf merges filePath with pdf2Path by inserting pdf2 at page index
// `page` (1-based). Returns the path of a new document.
func InsertPdf(ctx context.Context, filePath, pdf2Path string, page int, position string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if err := requireFile(pdf2Path); err != nil {
		return nil, err
	}
	n, err := sizeof(ctx, filePath)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if page > n {
		page = n
	}

	var before int
	switch strings.ToLower(position) {
	case "after":
		before = page
	default: // "before" / "at"
		before = page - 1
	}

	var parts []string
	p1, err := makeRangePart(ctx, filePath, 1, before)
	if err != nil {
		return nil, err
	}
	p2, err := makeRangePart(ctx, filePath, before+1, n)
	if err != nil {
		os.Remove(p1)
		return nil, err
	}
	parts = append(parts, p1, pdf2Path, p2)
	defer os.Remove(p1)
	defer os.Remove(p2)

	dir := filepath.Dir(filePath)
	outFile := filepath.Join(dir, baseName(filePath)+"_modified.pdf")
	if err := assembleMerge(ctx, parts, outFile); err != nil {
		return nil, fmt.Errorf("insert pdf: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// ReplacePages removes page `page` (1-based) from filePath and inserts
// replacePath in its place, writing a new document.
func ReplacePages(ctx context.Context, filePath, replacePath string, page int) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if err := requireFile(replacePath); err != nil {
		return nil, err
	}
	n, err := sizeof(ctx, filePath)
	if err != nil {
		return nil, err
	}

	p1, err := makeRangePart(ctx, filePath, 1, page-1)
	if err != nil {
		return nil, err
	}
	p2, err := makeRangePart(ctx, filePath, page+1, n)
	if err != nil {
		os.Remove(p1)
		return nil, err
	}
	parts := []string{p1, replacePath, p2}
	defer os.Remove(p1)
	defer os.Remove(p2)

	dir := filepath.Dir(filePath)
	outFile := filepath.Join(dir, baseName(filePath)+"_replaced.pdf")
	if err := assembleMerge(ctx, parts, outFile); err != nil {
		return nil, fmt.Errorf("replace pages: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// NUp merges selected pages of filePath onto output pages with nupSpan source
// pages per sheet, writing to targetPath.
func NUp(ctx context.Context, filePath string, selectedPages []int, nupSpan int, targetPath string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if nupSpan <= 0 {
		nupSpan = 2
	}
	nup, err := api.PDFNUpConfig(nupSpan, "", nil)
	if err != nil {
		return nil, fmt.Errorf("n-up config: %w", err)
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	outFile := outNameFor(targetPath, filePath)
	if err := api.NUpFile(ctx, []string{filePath}, outFile, pageSelection(selectedPages), nup, nil); err != nil {
		return nil, fmt.Errorf("n-up: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// SplitPages rearranges selected pages of filePath into a grid of
// rows x cols per output page, writing to targetPath.
func SplitPages(ctx context.Context, filePath string, selectedPages []int, gridRows, gridCols int, targetPath string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if gridRows <= 0 || gridCols <= 0 {
		return nil, fmt.Errorf("invalid grid dimensions %dx%d", gridRows, gridCols)
	}
	nup, err := api.PDFGridConfig(gridRows, gridCols, "", nil)
	if err != nil {
		return nil, fmt.Errorf("grid config: %w", err)
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	outFile := outNameFor(targetPath, filePath)
	if err := api.GridFile(ctx, []string{filePath}, outFile, pageSelection(selectedPages), nup, nil); err != nil {
		return nil, fmt.Errorf("split pages (grid): %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// CropPages crops the selected pages of filePath to cropArea, writing a new
// document to targetPath. cropArea uses the box order {x1,y1,x2,y2} in points.
func CropPages(ctx context.Context, filePath string, selectedPages []int, cropArea [4]float64, targetPath string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	box, err := api.Box(boxSpec(cropArea[0], cropArea[1], cropArea[2], cropArea[3]), types.POINTS)
	if err != nil {
		return nil, fmt.Errorf("crop box: %w", err)
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	outFile := outNameFor(targetPath, filePath)
	if err := cropToFile(ctx, filePath, outFile, pageSelection(selectedPages), box); err != nil {
		return nil, fmt.Errorf("crop: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": outFile}, nil
}

// SetPageSize resizes the selected pages of filePath to width x height points,
// writing the result back to the same file (atomic temp + rename).
func SetPageSize(ctx context.Context, filePath string, width, height float64, selectedPages []int) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("invalid page size %.2f x %.2f", width, height)
	}
	box, err := api.Box(boxSpec(0, 0, width, height), types.POINTS)
	if err != nil {
		return nil, fmt.Errorf("page size box: %w", err)
	}
	if err := cropInPlace(ctx, filePath, pageSelection(selectedPages), box); err != nil {
		return nil, fmt.Errorf("set page size: %w", err)
	}
	return map[string]any{"ok": true}, nil
}

// cropToFile crops selected pages of inFile writing to outFile (pdfcpu
// stages the output and atomically renames it into place).
func cropToFile(ctx context.Context, inFile, outFile string, selectedPages []string, b *model.Box) error {
	return api.CropFile(ctx, inFile, outFile, selectedPages, b, nil)
}

// cropInPlace crops inFile and atomically replaces it via pdfcpu's staged
// output handling.
func cropInPlace(ctx context.Context, inFile string, selectedPages []string, b *model.Box) error {
	return api.CropFile(ctx, inFile, inFile, selectedPages, b, nil)
}

func boxSpec(a, b, c, d float64) string {
	return fmt.Sprintf("%.2f %.2f %.2f %.2f", a, b, c, d)
}

// imageExt returns a filesystem extension for an extracted image.
func imageExt(fileType string) string {
	switch strings.ToLower(fileType) {
	case "jpeg":
		return ".jpg"
	case "":
		return ""
	default:
		return "." + strings.ToLower(fileType)
	}
}

// ExportImages extracts image resources from the selected pages of filePath
// and writes each to its own file in targetPath.
func ExportImages(ctx context.Context, filePath string, selectedPages []int, targetPath string) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	in, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open input: %w", err)
	}
	defer in.Close()

	perPage, err := api.ExtractImagesRaw(ctx, in, pageSelection(selectedPages), nil)
	if err != nil {
		return nil, fmt.Errorf("extract images: %w", err)
	}

	count := 0
	for _, pageMap := range perPage {
		for _, img := range pageMap {
			data, err := io.ReadAll(img.Reader)
			if err != nil {
				continue
			}
			name := strings.ReplaceAll(img.Name, " ", "_")
			if name == "" {
				name = strconv.Itoa(img.ObjNr)
			}
			outFile := filepath.Join(
				targetPath,
				fmt.Sprintf("image_%d_%s%s", img.PageNr, name, imageExt(img.FileType)),
			)
			if err := os.WriteFile(outFile, data, 0o644); err != nil {
				return nil, fmt.Errorf("write image: %w", err)
			}
			count++
		}
	}

	return map[string]any{"ok": true, "count": count}, nil
}

// ListPageImages returns a flattened reference list of images on a single page.
func ListPageImages(ctx context.Context, filePath string, pageIndex int) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	in, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open input: %w", err)
	}
	defer in.Close()

	perPage, err := api.ExtractImagesRaw(ctx, in, []string{strconv.Itoa(pageIndex)}, nil)
	if err != nil {
		return nil, fmt.Errorf("list page images: %w", err)
	}

	var refs []map[string]any
	for _, pageMap := range perPage {
		for objNr := range pageMap {
			refs = append(refs, map[string]any{
				"id":    objNr,
				"index": objNr,
			})
		}
	}
	sort.Slice(refs, func(i, j int) bool {
		li := refs[i]["index"].(int)
		lj := refs[j]["index"].(int)
		return li < lj
	})
	return refs, nil
}

// InsertBlankPage inserts one blank A4 page before `page` (1-based) and rewrites
// the input in place (temp file + rename), matching the editor's structural-edit
// flow. A page past the end appends at the back.
func InsertBlankPage(ctx context.Context, filePath string, page int) (any, error) {
	if err := requireFile(filePath); err != nil {
		return nil, err
	}
	n, err := sizeof(ctx, filePath)
	if err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	if page > n+1 {
		page = n + 1
	}

	dir := filepath.Dir(filePath)
	tmp, err := os.CreateTemp(dir, "insert-*.pdf")
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	tmp.Close()
	os.Remove(tmpName)

	if err := api.InsertPagesFile(ctx, filePath, tmpName, []string{strconv.Itoa(page)}, true,
		pdfcpu.DefaultPageConfiguration(), nil); err != nil {
		os.Remove(tmpName)
		return nil, fmt.Errorf("insert blank page: %w", err)
	}
	if err := os.Rename(tmpName, filePath); err != nil {
		os.Remove(tmpName)
		return nil, fmt.Errorf("replace original: %w", err)
	}
	return map[string]any{"ok": true, "savedPath": filePath}, nil
}