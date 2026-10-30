package pdfengine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// The functions below expose the editor-facing semantics of the PDF page
// operations on top of the pdfcpu primitives already used by pdfengine.go:
// a single chosen output file for derived documents and write-back in place
// where the editor expects the open document to change.

// ExtractRangeToFile keeps selectedPages (1-based) and writes one PDF to outFile.
func ExtractRangeToFile(ctx context.Context, inFile, outFile string, pages []int) (int, error) {
	if err := requireFile(inFile); err != nil {
		return 0, err
	}
	if len(pages) == 0 {
		return 0, fmt.Errorf("no pages selected")
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, err
	}
	if err := api.TrimFile(ctx, inFile, outFile, pageSelection(pages), nil); err != nil {
		return 0, fmt.Errorf("extract pages: %w", err)
	}
	return len(pages), nil
}

// InsertPdfToFile inserts every page of otherFile after afterPage (0-based,
// -1 inserts at the front) and writes the merged document to outFile.
// Returns the number of inserted pages.
func InsertPdfToFile(ctx context.Context, inFile, otherFile string, afterPage int, outFile string) (int, error) {
	if err := requireFile(inFile); err != nil {
		return 0, err
	}
	if err := requireFile(otherFile); err != nil {
		return 0, err
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, err
	}
	n, err := sizeof(ctx, inFile)
	if err != nil {
		return 0, err
	}
	inserted, err := sizeof(ctx, otherFile)
	if err != nil {
		return 0, err
	}
	before := afterPage + 1
	if before < 0 {
		before = 0
	}
	if before > n {
		before = n
	}

	p1, err := makeRangePart(ctx, inFile, 1, before)
	if err != nil {
		return 0, err
	}
	if p1 != "" {
		defer os.Remove(p1)
	}
	p2, err := makeRangePart(ctx, inFile, before+1, n)
	if err != nil {
		return 0, err
	}
	if p2 != "" {
		defer os.Remove(p2)
	}
	if err := assembleMerge(ctx, []string{p1, otherFile, p2}, outFile); err != nil {
		return 0, fmt.Errorf("insert pdf: %w", err)
	}
	return inserted, nil
}

// ReplaceWithPdfToFile replaces the pages of inFile whose 1-based numbers are
// in pages with all pages of otherFile, writing the result to outFile. A
// non-contiguous selection is replaced as the range from its lowest to its
// highest page. Returns the removed page count and the inserted page count.
func ReplaceWithPdfToFile(ctx context.Context, inFile, otherFile string, pages []int, outFile string) (int, int, error) {
	if err := requireFile(inFile); err != nil {
		return 0, 0, err
	}
	if err := requireFile(otherFile); err != nil {
		return 0, 0, err
	}
	if len(pages) == 0 {
		return 0, 0, fmt.Errorf("no pages selected")
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, 0, err
	}
	n, err := sizeof(ctx, inFile)
	if err != nil {
		return 0, 0, err
	}
	inserted, err := sizeof(ctx, otherFile)
	if err != nil {
		return 0, 0, err
	}
	sorted := append([]int(nil), pages...)
	sort.Ints(sorted)
	lo, hi := sorted[0], sorted[len(sorted)-1]
	if lo < 1 {
		lo = 1
	}
	if hi > n {
		hi = n
	}
	if lo > hi {
		return 0, 0, fmt.Errorf("invalid page range %d-%d", lo, hi)
	}

	p1, err := makeRangePart(ctx, inFile, 1, lo-1)
	if err != nil {
		return 0, 0, err
	}
	if p1 != "" {
		defer os.Remove(p1)
	}
	p2, err := makeRangePart(ctx, inFile, hi+1, n)
	if err != nil {
		return 0, 0, err
	}
	if p2 != "" {
		defer os.Remove(p2)
	}
	if err := assembleMerge(ctx, []string{p1, otherFile, p2}, outFile); err != nil {
		return 0, 0, fmt.Errorf("replace pages: %w", err)
	}
	return hi - lo + 1, inserted, nil
}

// SplitToDir writes consecutive page-span files into targetDir (pdfcpu names
// them after the input) and returns the written paths.
func SplitToDir(ctx context.Context, inFile string, span int, targetDir string) ([]string, error) {
	if err := requireFile(inFile); err != nil {
		return nil, err
	}
	if span <= 0 {
		return nil, fmt.Errorf("invalid split span %d", span)
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return nil, fmt.Errorf("create target dir: %w", err)
	}
	if err := api.SplitFile(ctx, inFile, targetDir, span, nil); err != nil {
		return nil, fmt.Errorf("split: %w", err)
	}
	base := baseName(inFile)
	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return nil, fmt.Errorf("read split output: %w", err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".pdf") {
			continue
		}
		if strings.HasPrefix(e.Name(), base) {
			out = append(out, filepath.Join(targetDir, e.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

// MergeFiles merges inFiles into outFile and returns the page count.
func MergeFiles(ctx context.Context, inFiles []string, outFile string) (int, error) {
	if len(inFiles) == 0 {
		return 0, fmt.Errorf("no input files to merge")
	}
	for _, f := range inFiles {
		if err := requireFile(f); err != nil {
			return 0, err
		}
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, err
	}
	if err := api.MergeCreateFile(ctx, inFiles, outFile, false, nil); err != nil {
		return 0, fmt.Errorf("merge: %w", err)
	}
	return sizeof(ctx, outFile)
}

// NUpToFile places perSheet source pages onto each output page and writes the
// result to outFile. desc carries optional pdfcpu n-up parameters (orientation,
// border); an empty desc uses the default grid. Returns the output page count.
func NUpToFile(ctx context.Context, inFile string, pages []int, perSheet int, desc, outFile string) (int, error) {
	if err := requireFile(inFile); err != nil {
		return 0, err
	}
	if perSheet < 2 {
		return 0, fmt.Errorf("pages per sheet must be at least 2, got %d", perSheet)
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, err
	}
	nup, err := api.PDFNUpConfig(perSheet, desc, nil)
	if err != nil {
		return 0, fmt.Errorf("n-up config: %w", err)
	}
	sel := pageSelection(pages)
	if err := api.NUpFile(ctx, []string{inFile}, outFile, sel, nup, nil); err != nil {
		return 0, fmt.Errorf("merge pages: %w", err)
	}
	return sizeof(ctx, outFile)
}

// CutToFile splits each selected page into rows x cols tiles and writes the
// tiles as consecutive pages of outFile. Only the tile counts pdfcpu's "ndown"
// templates cover are accepted (2, 3, 4, 6, 8, 9, 12, 16).
func CutToFile(ctx context.Context, inFile string, pages []int, rows, cols int, outFile string) (int, error) {
	if err := requireFile(inFile); err != nil {
		return 0, err
	}
	if rows < 1 || cols < 1 {
		return 0, fmt.Errorf("invalid grid %dx%d", rows, cols)
	}
	if err := prepareOutputDir(outFile); err != nil {
		return 0, err
	}
	cut, err := pdfcpu.ParseCutConfigForN(rows*cols, "", types.POINTS)
	if err != nil {
		return 0, fmt.Errorf("split pages: %w", err)
	}
	dir := filepath.Dir(outFile)
	if err := api.CutFile(ctx, inFile, dir, filepath.Base(outFile), pageSelection(pages), cut, nil); err != nil {
		return 0, fmt.Errorf("split pages: %w", err)
	}
	return sizeof(ctx, outFile)
}

// CropFractionInPlace shrinks the CropBox of each selected page (1-based) to
// the given fractional rectangle of that page (left, top, right, bottom; y runs
// down from the top of the displayed page).
func CropFractionInPlace(ctx context.Context, inFile string, pages []int, rect [4]float64) error {
	if err := requireFile(inFile); err != nil {
		return err
	}
	if len(pages) == 0 {
		return fmt.Errorf("no pages selected")
	}
	l, t, r, b := rect[0], rect[1], rect[2], rect[3]
	if l < 0 || t < 0 || r > 1 || b > 1 || r <= l || b <= t {
		return fmt.Errorf("invalid crop rectangle %.3f %.3f %.3f %.3f", l, t, r, b)
	}
	dims, err := api.PageDimsFile(ctx, inFile)
	if err != nil {
		return fmt.Errorf("page dimensions: %w", err)
	}
	for _, page := range pages {
		if page < 1 || page > len(dims) {
			continue
		}
		w, h := dims[page-1].Width, dims[page-1].Height
		// CropBox coordinates are points from the bottom-left corner; the editor
		// rectangle is a fraction from the top-left, so the vertical axis flips.
		box, berr := api.Box(boxSpec(l*w, (1-b)*h, r*w, (1-t)*h), types.POINTS)
		if berr != nil {
			return fmt.Errorf("crop box: %w", berr)
		}
		if cerr := cropInPlace(ctx, inFile, []string{strconv.Itoa(page)}, box); cerr != nil {
			return fmt.Errorf("crop page %d: %w", page, cerr)
		}
	}
	return nil
}

// prepareOutputDir makes sure the parent directory of outFile exists.
func prepareOutputDir(outFile string) error {
	if outFile == "" {
		return fmt.Errorf("missing output file path")
	}
	if err := os.MkdirAll(filepath.Dir(outFile), 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	return nil
}
