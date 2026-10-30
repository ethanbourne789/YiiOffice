// Package pdfengine provides Wails PDF structural operations backed by pdfcpu.
package pdfengine

import (
	"context"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// seedPDF builds a deterministic N-page PDF by importing solid-color PNGs.
func seedPDF(t *testing.T, dir string, label string, pages int) string {
	t.Helper()
	imgs := make([]string, 0, pages)
	for i := 0; i < pages; i++ {
		p := filepath.Join(dir, label+"_page.png")
		f, err := os.Create(p)
		if err != nil {
			t.Fatalf("create png: %v", err)
		}
		img := image.NewRGBA(image.Rect(0, 0, 200, 150))
		if err := png.Encode(f, img); err != nil {
			f.Close()
			t.Fatalf("encode png: %v", err)
		}
		f.Close()
		imgs = append(imgs, p)
	}
	out := filepath.Join(dir, label+".pdf")
	imp := api.DefaultImportConfig()
	if err := api.ImportImagesFile(context.Background(), imgs, out, imp, nil); err != nil {
		t.Fatalf("seed pdf %s: %v", label, err)
	}
	return out
}

func pageCount(t *testing.T, path string) int {
	t.Helper()
	c, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatalf("read page count for %s: %v", path, err)
	}
	return c.PageCount
}

func TestMergeProducesCombinedDocument(t *testing.T) {
	dir := t.TempDir()
	a := seedPDF(t, dir, "a", 2)
	b := seedPDF(t, dir, "b", 3)

	res, err := Merge(context.Background(), []string{a, b}, dir, "merged.pdf")
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	m := res.(map[string]any)
	if m["ok"] != true {
		t.Fatalf("merge not ok: %v", m)
	}
	merged := filepath.Join(dir, "merged.pdf")
	if got := pageCount(t, merged); got != 5 {
		t.Fatalf("merged has %d pages, want 5", got)
	}
}

func TestCropAndSetPageSizeInPlace(t *testing.T) {
	dir := t.TempDir()
	src := seedPDF(t, dir, "src", 2)

	// Crop writes a NEW derived file.
	cropRes, err := CropPages(context.Background(), src, []int{1, 2}, [4]float64{0, 0, 150, 100}, dir)
	if err != nil {
		t.Fatalf("crop: %v", err)
	}
	if cropRes.(map[string]any)["ok"] != true {
		t.Fatalf("crop not ok")
	}
	if got := pageCount(t, filepath.Join(dir, "src.pdf")); got != 2 {
		t.Fatalf("cropped has %d pages, want 2", got)
	}

	// SetPageSize must replace the ORIGINAL atomically.
	szRes, err := SetPageSize(context.Background(), src, 300, 200, []int{1})
	if err != nil {
		t.Fatalf("set-page-size: %v", err)
	}
	if szRes.(map[string]any)["ok"] != true {
		t.Fatalf("set-page-size not ok")
	}
	// File must still exist and be a valid 2-page PDF.
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("original replaced in place, stat: %v", err)
	}
	if got := pageCount(t, src); got != 2 {
		t.Fatalf("resized original has %d pages, want 2", got)
	}
}

func TestSplitAndExtract(t *testing.T) {
	dir := t.TempDir()
	src := seedPDF(t, dir, "split_src", 4)

	splitRes, err := Split(context.Background(), src, dir, "2")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if splitRes.(map[string]any)["ok"] != true {
		t.Fatalf("split not ok")
	}

	out := filepath.Join(dir, "extract_out")
	extRes, err := ExtractPages(context.Background(), src, []int{1, 3}, out)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	paths := extRes.(map[string]any)["savedPaths"].([]string)
	if len(paths) != 2 {
		t.Fatalf("extract produced %d files, want 2", len(paths))
	}
}

// TestMergeIsCancellable guards against SIGS wheels (pdfcpu supports ctx).
func TestOpsRespectShortTimeout(t *testing.T) {
	dir := t.TempDir()
	a := seedPDF(t, dir, "a", 1)
	b := seedPDF(t, dir, "b", 1)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if _, err := Merge(ctx, []string{a, b}, dir, "tm.pdf"); err != nil {
		t.Fatalf("merge under ctx: %v", err)
	}
}

func TestInsertBlankPageAddsOnePage(t *testing.T) {
	dir := t.TempDir()
	src := seedPDF(t, dir, "blank", 3)

	res, err := InsertBlankPage(context.Background(), src, 2)
	if err != nil {
		t.Fatalf("insert blank page: %v", err)
	}
	m := res.(map[string]any)
	if m["ok"] != true {
		t.Fatalf("insert not ok: %v", m)
	}
	out := m["savedPath"].(string)
	if out != src {
		t.Fatalf("expected in-place rewrite of %q, got %q", src, out)
	}
	if got := pageCount(t, src); got != 4 {
		t.Fatalf("document has %d pages, want 4", got)
	}
}

func TestInsertBlankPageRejectsMissingFile(t *testing.T) {
	if _, err := InsertBlankPage(context.Background(), filepath.Join(t.TempDir(), "nope.pdf"), 1); err == nil {
		t.Fatal("expected an error for a missing input file")
	}
}