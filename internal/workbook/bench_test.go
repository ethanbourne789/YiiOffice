package workbook

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

// benchWorkbook writes a dense workbook to a temp dir. Fixture creation is
// excluded from the measured region: only Open is timed.
func benchWorkbook(b *testing.B, sheets, rows, cols int) string {
	b.Helper()
	path := filepath.Join(b.TempDir(), "bench.xlsx")
	f := excelize.NewFile()
	first := f.GetSheetName(0)
	for s := 0; s < sheets; s++ {
		name := first
		if s > 0 {
			name = fmt.Sprintf("Sheet%d", s+1)
			if _, err := f.NewSheet(name); err != nil {
				b.Fatal(err)
			}
		}
		values := make([]any, 0, cols)
		for r := 1; r <= rows; r++ {
			values = values[:0]
			for c := 1; c <= cols; c++ {
				values = append(values, fmt.Sprintf("r%dc%d", r, c))
			}
			cell, err := excelize.CoordinatesToCellName(1, r)
			if err != nil {
				b.Fatal(err)
			}
			if err := f.SetSheetRow(name, cell, &values); err != nil {
				b.Fatal(err)
			}
		}
	}
	if err := f.SaveAs(path); err != nil {
		b.Fatal(err)
	}
	if err := f.Close(); err != nil {
		b.Fatal(err)
	}
	return path
}

// BenchmarkSheetMetadataPaths compares the two metadata implementations in one
// process, back to back, so the ratio is not distorted by machine load drifting
// between runs. Both sides open the file with excelize first, which is what the
// real open path does; only the metadata extraction differs.
func BenchmarkSheetMetadataPaths(b *testing.B) {
	path := benchWorkbook(b, 5, 2000, 20)

	run := func(b *testing.B, apply func(f *excelize.File, names []string)) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			f, err := excelize.OpenFile(path)
			if err != nil {
				b.Fatal(err)
			}
			apply(f, f.GetSheetList())
			if err := f.Close(); err != nil {
				b.Fatal(err)
			}
		}
	}

	// The library path decodes every worksheet twice per sheet (Rows() then the
	// first GetCol*). It is what this change replaced.
	b.Run("excelize_getters", func(b *testing.B) {
		run(b, func(f *excelize.File, names []string) {
			for _, name := range names {
				meta := SheetMeta{}
				applyWorksheetMetaFromExcelize(f, name, &meta)
			}
		})
	})

	// The streaming path reads each worksheet part once.
	b.Run("streaming_scan", func(b *testing.B) {
		run(b, func(_ *excelize.File, names []string) {
			geometry, ok := readSheetGeometry(path)
			if !ok {
				b.Fatal("scan declined the benchmark workbook")
			}
			for _, name := range names {
				meta := SheetMeta{ShowGridLines: true}
				geometry[name].applyWorksheetMeta(&meta)
			}
		})
	})
}

// BenchmarkEngineOpen measures the open path end to end: sniff, hash, zip
// entry count, excelize parse, per-sheet metadata. This is the number the
// Sheets tab waits on before it can render anything.
func BenchmarkEngineOpen(b *testing.B) {
	cases := []struct {
		name          string
		sheets        int
		rows, columns int
	}{
		{"small_1x100x10", 1, 100, 10},
		{"medium_5x2000x20", 5, 2000, 20},
	}
	for _, tc := range cases {
		path := benchWorkbook(b, tc.sheets, tc.rows, tc.columns)
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			e := NewEngine()
			for i := 0; i < b.N; i++ {
				info, err := e.Open(path)
				if err != nil {
					b.Fatal(err)
				}
				if err := e.Close(info.SessionID); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkHashAndCount quantifies the merged helper against the two calls it
// replaced: a streaming digest (one full read) plus a separate zip open (a
// second open and a second central-directory parse). The digest dominates, so
// the expected gain is modest — this benchmark exists to keep the claim honest
// rather than to advertise a speedup.
func BenchmarkHashAndCount(b *testing.B) {
	path := benchWorkbook(b, 5, 2000, 20)
	ctx := context.Background()

	b.Run("merged_single_open", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, _, _, err := hashAndCount(ctx, path); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("split_two_opens", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			fh, err := os.Open(path)
			if err != nil {
				b.Fatal(err)
			}
			h := sha256.New()
			if _, err := io.Copy(h, fh); err != nil {
				b.Fatal(err)
			}
			fh.Close() //nolint:errcheck // benchmark handle
			zr, err := zip.OpenReader(path)
			if err != nil {
				b.Fatal(err)
			}
			zr.Close() //nolint:errcheck // benchmark handle
		}
	})
}

// BenchmarkRecalc measures the cost the sheets editor pays after each formula
// edit (debounced, but on every edit). Recalc clones the whole workbook through
// WriteToBuffer + OpenReader before evaluating, so the number here is dominated
// by that clone rather than by the calculator.
func BenchmarkRecalc(b *testing.B) {
	path := benchWorkbook(b, 5, 2000, 20)
	eng := NewEngine()
	defer eng.CloseAll()

	info, err := eng.Open(path)
	if err != nil {
		b.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	req := RecalcRequest{
		SessionID: info.SessionID,
		Edits:     []RecalcEdit{{SheetID: sheet, Row: 1, Column: 1, Input: `=B1&"x"`}},
		Reads: []RecalcRead{{
			SheetID: sheet,
			Range:   CellArea{StartRow: 1, StartColumn: 1, EndRow: 100, EndColumn: 20},
		}},
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := eng.Recalc(req); err != nil {
			b.Fatal(err)
		}
	}
}
