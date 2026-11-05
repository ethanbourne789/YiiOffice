package workbook

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// fixture builds a small workbook with values, a formula and a merge.
func fixture(t *testing.T) string {
	t.Helper()
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	if err := f.SetCellValue(sheet, "A1", "Name"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue(sheet, "B1", "Amount"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue(sheet, "A2", "Apple"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellFloat(sheet, "B2", 12.5, -1, 64); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue(sheet, "A3", "Pear"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellFloat(sheet, "B3", 7, -1, 64); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellFormula(sheet, "B4", "SUM(B2:B3)"); err != nil {
		t.Fatal(err)
	}
	if err := f.MergeCell(sheet, "A5", "B5"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue(sheet, "A5", "Merged"); err != nil {
		t.Fatal(err)
	}
	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellStyle(sheet, "A1", "B1", bold); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "fixture.xlsx")
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return path
}

func TestOpenReportsMetadata(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	path := fixture(t)
	info, err := eng.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if len(info.SessionID) != 36 {
		t.Errorf("session id %q is not a uuid", info.SessionID)
	}
	if len(info.SHA256) != 64 {
		t.Errorf("sha256 length = %d", len(info.SHA256))
	}
	if info.Name != "fixture.xlsx" || info.Path != path {
		t.Errorf("name/path = %q/%q", info.Name, info.Path)
	}
	if len(info.Sheets) != 1 {
		t.Fatalf("sheets = %d", len(info.Sheets))
	}
	sheet := info.Sheets[0]
	if sheet.RowCount < 5 || sheet.ColumnCount < 2 {
		t.Errorf("dimensions = %d x %d", sheet.RowCount, sheet.ColumnCount)
	}
	if sheet.Tables == nil || sheet.Comments == nil || sheet.PivotRanges == nil {
		t.Error("metadata slices must be non-nil for the renderer schema")
	}
	if len(info.Styles) == 0 {
		t.Fatal("styles table is empty")
	}
	if !info.Styles[len(info.Styles)-1].Bold && !info.Styles[1].Bold {
		t.Error("bold xf missing from the style table")
	}
}

func TestReadRangeReturnsValuesFormulasAndMerges(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	result, err := eng.ReadRange(info.SessionID, sheet, CellArea{StartRow: 0, EndRow: 4, StartColumn: 0, EndColumn: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Cells == nil || result.Rows == nil || result.Merges == nil {
		t.Fatal("range result slices must be non-nil")
	}
	if !result.IndexingComplete {
		t.Error("indexingComplete must be true")
	}
	found := map[string]CellRecord{}
	for _, cell := range result.Cells {
		found[cellRef(cell.Row, cell.Column)] = cell
	}
	if v, ok := found["A1"]; !ok || v.Value != "Name" {
		t.Errorf("A1 = %#v", found["A1"])
	}
	if v, ok := found["B2"]; !ok || v.Value != 12.5 {
		t.Errorf("B2 = %#v", found["B2"])
	}
	if v, ok := found["B4"]; !ok || v.Formula != "=SUM(B2:B3)" {
		t.Errorf("B4 formula = %#v", found["B4"])
	}
	if len(result.Merges) != 1 {
		t.Fatalf("merges = %#v", result.Merges)
	}
	// A5:B5 is row index 4, columns 0..1 in zero-based file coordinates.
	merge := result.Merges[0]
	if merge.StartRow != 4 || merge.EndRow != 4 || merge.StartColumn != 0 || merge.EndColumn != 1 {
		t.Errorf("merge = %#v", merge)
	}
}

func TestFindCellsMatchesWithUnlessCaseAndPaging(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	result, err := eng.FindCells(FindRequest{
		SessionID: info.SessionID,
		Query:     "a",
		LookIn:    "values",
		Limit:     2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 2 || result.Complete {
		t.Fatalf("matches = %d complete = %v", len(result.Matches), result.Complete)
	}
	if result.Matches[0].ValueText == nil {
		t.Error("valueText must be set")
	}
	cursor := result.NextCursor
	if cursor == nil {
		t.Fatal("nextCursor missing on a partial page")
	}
	page2, err := eng.FindCells(FindRequest{
		SessionID: info.SessionID,
		Query:     "a",
		LookIn:    "values",
		Limit:     2,
		ResumeAt:  cursor,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Matches) == 0 {
		t.Error("second page should still find the remaining hits")
	}
	exact, err := eng.FindCells(FindRequest{
		SessionID:       info.SessionID,
		Query:           "Name",
		LookIn:          "values",
		MatchEntireCell: true,
		Limit:           10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(exact.Matches) != 1 {
		t.Errorf("entire-cell matches = %d", len(exact.Matches))
	}
}

func TestSaveAppliesEditsAndReloadsMetadata(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	result, err := eng.Save(SaveRequest{
		SessionID: info.SessionID,
		Mode:      "save",
		Edits: []CellEdit{
			{SheetID: sheet, Row: 1, Column: 0, WriteValue: true, Value: 99.0},
			{SheetID: sheet, Row: 2, Column: 0, WriteValue: true, Value: "Banana"},
			{SheetID: sheet, Row: 3, Column: 1, WriteValue: true, Formula: "=B2+B3"},
		},
		StructuralOps: []StructuralOp{
			{SheetID: sheet, Kind: "insert-rows", Index: 5, Count: 2},
		},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if result.Canceled || result.File == nil {
		t.Fatalf("save result = %#v", result)
	}
	if result.File.SHA256 == info.SHA256 {
		t.Error("sha256 should change after save")
	}
	rangeResult, err := eng.ReadRange(info.SessionID, sheet, CellArea{StartRow: 1, EndRow: 3, StartColumn: 0, EndColumn: 1})
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]any{}
	for _, cell := range rangeResult.Cells {
		values[cellRef(cell.Row, cell.Column)] = cell.Value
	}
	if values["A2"] != 99.0 {
		t.Errorf("A2 = %#v", values["A2"])
	}
	if values["A3"] != "Banana" {
		t.Errorf("A3 = %#v", values["A3"])
	}
}

// TestReloadFailureKeepsSessionUsable: a failed reload must not leave the
// session with a closed workbook handle.
func TestReloadFailureKeepsSessionUsable(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	path := fixture(t)
	info, err := eng.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	s, err := eng.acquire(info.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	defer s.mu.Unlock()

	// A file that hashes fine but is not a workbook: the reload parse fails
	// after hashFile and before the handle would be swapped.
	bad := filepath.Join(t.TempDir(), "bad.xlsx")
	if err := os.WriteFile(bad, []byte("not a workbook"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := eng.reloadLocked(s, bad); err == nil {
		t.Fatal("expected the reload to fail on a non-workbook file")
	}

	// The original handle must still serve reads.
	sheet := s.file.GetSheetList()[0]
	if got, err := s.file.GetCellValue(sheet, "A1"); err != nil || got != "Name" {
		t.Fatalf("session handle unusable after a failed reload: %q (err %v)", got, err)
	}
}

// TestSavePersistsLargeEditSetAcrossReopen covers the renderer's large-paste
// path: 20,000 cell edits (above the former transfer threshold) must reach the
// file, survive closing the session, and read back unchanged after a fresh
// open.
func TestSavePersistsLargeEditSetAcrossReopen(t *testing.T) {
	const rows, columns = 200, 100 // 20,000 cells
	path := filepath.Join(t.TempDir(), "large.xlsx")
	f := excelize.NewFile()
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	sheetID := info.Sheets[0].ID
	edits := make([]CellEdit, 0, rows*columns)
	for row := 0; row < rows; row++ {
		for column := 0; column < columns; column++ {
			edits = append(edits, CellEdit{
				SheetID:    sheetID,
				Row:        row,
				Column:     column,
				WriteValue: true,
				Value:      float64(row*columns + column),
			})
		}
	}
	saved, err := eng.Save(SaveRequest{SessionID: info.SessionID, Mode: "save", Edits: edits})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.Canceled || saved.File == nil {
		t.Fatalf("save result = %#v", saved)
	}
	if err := eng.Close(info.SessionID); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := eng.Open(saved.File.Path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	result, err := eng.ReadRange(reopened.SessionID, reopened.Sheets[0].ID, CellArea{
		StartRow:    0,
		StartColumn: 0,
		EndRow:      rows - 1,
		EndColumn:   columns - 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cells) != rows*columns {
		t.Fatalf("reopened cells = %d, want %d", len(result.Cells), rows*columns)
	}
	for _, cell := range result.Cells {
		want := float64(cell.Row*columns + cell.Column)
		if cell.Value != want {
			t.Fatalf("cell (%d,%d) = %#v, want %#v", cell.Row, cell.Column, cell.Value, want)
		}
	}
}

// TestSaveAppliesCellEditsToWorkbookWithComments guards the loss-warning
// boundary: a workbook carrying objects the engine cannot create (here a
// comment) still saves ordinary cell edits, and the untouched object survives
// the package rewrite.
func TestSaveAppliesCellEditsToWorkbookWithComments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commented.xlsx")
	f := excelize.NewFile()
	sheetName := f.GetSheetName(0)
	if err := f.SetCellValue(sheetName, "A1", "before"); err != nil {
		t.Fatal(err)
	}
	if err := f.AddComment(sheetName, excelize.Comment{
		Cell:      "A1",
		Author:    "YiiOffice",
		Paragraph: []excelize.RichTextRun{{Text: "keep this note"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	sheetID := info.Sheets[0].ID
	saved, err := eng.Save(SaveRequest{
		SessionID: info.SessionID,
		Mode:      "save",
		Edits: []CellEdit{{
			SheetID: sheetID, Row: 0, Column: 0, WriteValue: true, Value: "after",
		}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.File == nil {
		t.Fatalf("save result = %#v", saved)
	}
	if err := eng.Close(info.SessionID); err != nil {
		t.Fatalf("close: %v", err)
	}

	check, err := excelize.OpenFile(saved.File.Path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer check.Close()
	value, err := check.GetCellValue(sheetName, "A1")
	if err != nil {
		t.Fatal(err)
	}
	if value != "after" {
		t.Errorf("A1 = %q, want \"after\"", value)
	}
	comments, err := check.GetComments(sheetName)
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 {
		t.Fatalf("comments = %#v", comments)
	}
	var text string
	for _, paragraph := range comments[0].Paragraph {
		text += paragraph.Text
	}
	if text != "keep this note" {
		t.Errorf("comment text = %q", text)
	}
}

// TestSavePreservesExistingChartWhileApplyingCellEdits pins the other half of
// the loss boundary: workbook parts the engine cannot model (a chart) must
// survive the save's package rewrite even though only cell edits are applied.
func TestSavePreservesExistingChartWhileApplyingCellEdits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "charted.xlsx")
	f := excelize.NewFile()
	sheetName := f.GetSheetName(0)
	for row := 1; row <= 3; row++ {
		if err := f.SetCellValue(sheetName, fmt.Sprintf("A%d", row), row); err != nil {
			t.Fatal(err)
		}
	}
	chart := &excelize.Chart{
		Type: excelize.Col,
		Series: []excelize.ChartSeries{{
			Name:       sheetName + "!$A$1",
			Categories: sheetName + "!$A$1:$A$3",
			Values:     sheetName + "!$A$1:$A$3",
		}},
	}
	if err := f.AddChart(sheetName, "C1", chart); err != nil {
		t.Fatal(err)
	}
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	before := sheetPackageEntries(t, path)
	if !slices.Contains(before, "xl/charts/chart1.xml") {
		t.Fatalf("fixture has no chart part: %v", before)
	}

	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := eng.Save(SaveRequest{
		SessionID: info.SessionID,
		Mode:      "save",
		Edits: []CellEdit{{
			SheetID: info.Sheets[0].ID, Row: 1, Column: 0, WriteValue: true, Value: "edited",
		}},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.File == nil {
		t.Fatalf("save result = %#v", saved)
	}
	if err := eng.Close(info.SessionID); err != nil {
		t.Fatalf("close: %v", err)
	}

	after := sheetPackageEntries(t, saved.File.Path)
	if !slices.Contains(after, "xl/charts/chart1.xml") {
		t.Fatalf("chart part disappeared after save: %v", after)
	}
	check, err := excelize.OpenFile(saved.File.Path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer check.Close()
	value, err := check.GetCellValue(sheetName, "A2")
	if err != nil {
		t.Fatal(err)
	}
	if value != "edited" {
		t.Errorf("A2 = %q, want \"edited\"", value)
	}
}

// TestSavePersistsHyperlinksAcrossReopen covers the three hyperlink shapes the
// renderer sends: an external URL, a workbook-internal "#Sheet!A1" anchor and a
// removal (empty target). All three must survive SaveAs plus a fresh open.
func TestSavePersistsHyperlinksAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "links.xlsx")
	f := excelize.NewFile()
	sheetName := f.GetSheetName(0)
	// Pre-existing link that the request below removes.
	if err := f.SetCellHyperLink(sheetName, "C3", "https://old.example.com", "External"); err != nil {
		t.Fatal(err)
	}
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	sheetID := info.Sheets[0].ID
	display, tooltip := "Example", "Example site"
	saved, err := eng.Save(SaveRequest{
		SessionID: info.SessionID,
		Mode:      "save",
		// The value lands first so the link is attached to the final cell.
		Edits: []CellEdit{{SheetID: sheetID, Row: 0, Column: 0, WriteValue: true, Value: "example"}},
		HyperlinkEdits: []HyperlinkEdit{
			{SheetID: sheetID, Row: 0, Column: 0, Target: "https://example.com", Display: &display, Tooltip: &tooltip},
			{SheetID: sheetID, Row: 1, Column: 1, Target: "#" + sheetName + "!A1"},
			{SheetID: sheetID, Row: 2, Column: 2},
		},
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.File == nil {
		t.Fatalf("save result = %#v", saved)
	}
	if err := eng.Close(info.SessionID); err != nil {
		t.Fatal(err)
	}

	reopened, err := eng.Open(saved.File.Path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	check, err := excelize.OpenFile(saved.File.Path)
	if err != nil {
		t.Fatalf("open saved: %v", err)
	}
	defer check.Close()

	if ok, target, err := check.GetCellHyperLink(sheetName, "A1"); err != nil || !ok || target != "https://example.com" {
		t.Fatalf("A1 link = (%v, %q, %v)", ok, target, err)
	}
	if value, err := check.GetCellValue(sheetName, "A1"); err != nil || value != "example" {
		t.Fatalf("A1 value = %q (err %v)", value, err)
	}
	if ok, location, err := check.GetCellHyperLink(sheetName, "B2"); err != nil || !ok || location != sheetName+"!A1" {
		t.Fatalf("B2 link = (%v, %q, %v)", ok, location, err)
	}
	if ok, target, err := check.GetCellHyperLink(sheetName, "C3"); err != nil || ok || target != "" {
		t.Fatalf("C3 link not removed: (%v, %q, %v)", ok, target, err)
	}
	if cells, err := check.GetHyperLinkCells(sheetName, "External"); err != nil || !slices.Contains(cells, "A1") || slices.Contains(cells, "C3") {
		t.Fatalf("external cells = %v (err %v)", cells, err)
	}
	if cells, err := check.GetHyperLinkCells(sheetName, "Location"); err != nil || !slices.Contains(cells, "B2") {
		t.Fatalf("location cells = %v (err %v)", cells, err)
	}

	// The renderer reads internal anchors back with the '#' prefix it sends.
	result, err := eng.ReadRange(reopened.SessionID, sheetName, CellArea{StartRow: 0, StartColumn: 0, EndRow: 2, EndColumn: 2})
	if err != nil {
		t.Fatal(err)
	}
	targets := map[string]string{}
	for _, link := range result.Hyperlinks {
		targets[cellRef(link.Row, link.Column)] = link.Target
	}
	if targets["A1"] != "https://example.com" || targets["B2"] != "#"+sheetName+"!A1" {
		t.Fatalf("read-back hyperlinks = %#v", targets)
	}
	if _, ok := targets["C3"]; ok {
		t.Fatalf("C3 still has a link: %#v", targets)
	}
}

func sheetPackageEntries(t *testing.T, path string) []string {
	t.Helper()
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	names := make([]string, 0, len(archive.File))
	for _, entry := range archive.File {
		names = append(names, entry.Name)
	}
	return names
}

func TestRecalcEvaluatesFormulaCells(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	result, err := eng.Recalc(RecalcRequest{
		SessionID: info.SessionID,
		Reads: []RecalcRead{{
			SheetID: sheet,
			Range:   CellArea{StartRow: 0, EndRow: 9, StartColumn: 0, EndColumn: 1},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cells) != 1 {
		t.Fatalf("recalc cells = %#v", result.Cells)
	}
	cell := result.Cells[0]
	if cell.SheetID != sheet || cell.Row != 3 || cell.Column != 1 {
		t.Errorf("recalc cell = %#v", cell)
	}
	if cell.Formatted != "19.5" && cell.Formatted != "20" {
		t.Errorf("formatted = %q", cell.Formatted)
	}
}

// TestConcurrentReadersAndWriters hammers one session the way the Wails
// bindings do: every call arrives on its own goroutine, so reads and saves
// interleave freely. Run with -race to catch excelize state corruption.
func TestConcurrentReadersAndWriters(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	area := CellArea{StartRow: 0, EndRow: 5, StartColumn: 0, EndColumn: 1}
	const readers, writers = 8, 4
	errCh := make(chan error, readers+writers)
	var wg sync.WaitGroup
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 20; n++ {
				res, err := eng.ReadRange(info.SessionID, sheet, area)
				if err != nil {
					errCh <- fmt.Errorf("read: %w", err)
					return
				}
				if !res.IndexingComplete {
					errCh <- fmt.Errorf("read: indexing incomplete")
					return
				}
			}
		}()
	}
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for k := 0; k < 5; k++ {
				res, err := eng.Save(SaveRequest{
					SessionID: info.SessionID,
					Mode:      "save",
					Edits: []CellEdit{
						{SheetID: sheet, Row: 6, Column: 0, WriteValue: true,
							Value: fmt.Sprintf("w%d-%d", w, k)},
					},
				})
				if err != nil {
					errCh <- fmt.Errorf("save: %w", err)
					return
				}
				if res.File == nil {
					errCh <- fmt.Errorf("save: no file info")
					return
				}
			}
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
	// The session must still serve a consistent snapshot after the storm.
	res, err := eng.ReadRange(info.SessionID, sheet, area)
	if err != nil {
		t.Fatalf("read after storm: %v", err)
	}
	if len(res.Cells) == 0 {
		t.Error("expected cells after concurrent storm")
	}
}

// TestOperationsAfterCloseFail verifies every session entry point reports
// the session as unknown once Close released it.
func TestOperationsAfterCloseFail(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.Open(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	sheet := info.Sheets[0].ID
	if err := eng.Close(info.SessionID); err != nil {
		t.Fatalf("close: %v", err)
	}

	area := CellArea{StartRow: 0, EndRow: 1, StartColumn: 0, EndColumn: 1}
	calls := map[string]func() error{
		"Info":      func() error { _, err := eng.Info(info.SessionID); return err },
		"SheetName": func() error { _, err := eng.SheetName(info.SessionID, sheet); return err },
		"ReadRange": func() error { _, err := eng.ReadRange(info.SessionID, sheet, area); return err },
		"ReadFormulas": func() error {
			_, err := eng.ReadFormulas(info.SessionID, sheet)
			return err
		},
		"ReadRowOutline": func() error {
			_, err := eng.ReadRowOutline(info.SessionID, sheet)
			return err
		},
		"FindCells": func() error {
			_, err := eng.FindCells(FindRequest{SessionID: info.SessionID, Query: "x"})
			return err
		},
		"Recalc": func() error {
			_, err := eng.Recalc(RecalcRequest{SessionID: info.SessionID,
				Reads: []RecalcRead{{SheetID: sheet, Range: area}}})
			return err
		},
		"ReadMedia": func() error {
			_, err := eng.ReadMedia(info.SessionID, "missing")
			return err
		},
		"Save": func() error {
			_, err := eng.Save(SaveRequest{SessionID: info.SessionID, Mode: "save"})
			return err
		},
	}
	for name, call := range calls {
		err := call()
		if err == nil || !strings.Contains(err.Error(), "unknown session") {
			t.Errorf("%s after close: want unknown session, got %v", name, err)
		}
	}
}

// TestCloseRacesWithReaders is a regression for the session TOCTOU window:
// a reader that resolved the session pointer just before Close ran must
// never touch the released excelize file. Without the closed-flag recheck
// under s.mu the readers below panic or surface raw excelize errors instead
// of "unknown session".
func TestCloseRacesWithReaders(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	const rounds, racers = 10, 8
	area := CellArea{StartRow: 0, EndRow: 5, StartColumn: 0, EndColumn: 1}

	for r := 0; r < rounds; r++ {
		info, err := eng.Open(fixture(t))
		if err != nil {
			t.Fatal(err)
		}
		sheet := info.Sheets[0].ID
		sid := info.SessionID

		var wg sync.WaitGroup
		errCh := make(chan error, racers)
		stop := make(chan struct{})
		for i := 0; i < racers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for {
					select {
					case <-stop:
						return
					default:
					}
					if _, err := eng.ReadRange(sid, sheet, area); err != nil {
						if !strings.Contains(err.Error(), "unknown session") {
							errCh <- fmt.Errorf("reader: %w", err)
						}
						return
					}
				}
			}()
		}
		if err := eng.Close(sid); err != nil {
			t.Fatalf("round %d close: %v", r, err)
		}
		close(stop)
		wg.Wait()
		close(errCh)
		for err := range errCh {
			t.Fatalf("round %d: %v", r, err)
		}
	}
}

func TestCloseDropsSession(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	path := fixture(t)
	if _, err := eng.Open(path); err != nil {
		t.Fatal(err)
	}
	if eng.SessionCount() != 1 {
		t.Fatalf("sessions = %d", eng.SessionCount())
	}
	eng.CloseAll()
	if eng.SessionCount() != 0 {
		t.Fatalf("sessions after close = %d", eng.SessionCount())
	}
}

// TestHashAndCountMatchesSplitImplementation pins the merged single-pass helper
// to the two calls it replaced: same digest, same byte count, same entry count.
// The entry count is the part worth guarding — a zip that fails to open must
// still yield a digest, because the caller records SHA256 for every file it
// can read, zip or not.
func TestHashAndCountMatchesSplitImplementation(t *testing.T) {
	path := fixture(t)

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	wantSum := sha256.Sum256(raw)
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	wantEntries := len(zr.File)
	zr.Close() //nolint:errcheck // read-only fixture handle

	sum, size, entries, err := hashAndCount(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if sum != wantSum {
		t.Errorf("digest = %x, want %x", sum, wantSum)
	}
	if size != int64(len(raw)) {
		t.Errorf("size = %d, want %d", size, len(raw))
	}
	if entries != wantEntries {
		t.Errorf("entries = %d, want %d", entries, wantEntries)
	}
}

func TestHashAndCountNonZipDegradesToZeroEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plain.csv")
	const body = "a,b\n1,2\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	sum, size, entries, err := hashAndCount(context.Background(), path)
	if err != nil {
		t.Fatalf("a non-zip must not fail the digest: %v", err)
	}
	if want := sha256.Sum256([]byte(body)); sum != want {
		t.Errorf("digest = %x, want %x", sum, want)
	}
	if size != int64(len(body)) {
		t.Errorf("size = %d, want %d", size, len(body))
	}
	if entries != 0 {
		t.Errorf("entries = %d, want 0", entries)
	}
}

func TestOpenContextHonoursDeadline(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	path := fixture(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := eng.OpenContext(ctx, path, ""); !errors.Is(err, ErrOpenTimeout) {
		t.Fatalf("err = %v, want ErrOpenTimeout", err)
	}
	if eng.SessionCount() != 0 {
		t.Fatalf("a timed-out open must not leave a session behind: %d", eng.SessionCount())
	}
}

func TestOpenContextWithoutDeadlineOpens(t *testing.T) {
	eng := NewEngine()
	defer eng.CloseAll()
	path := fixture(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	info, err := eng.OpenContext(ctx, path, "")
	if err != nil {
		t.Fatalf("open with a live deadline: %v", err)
	}
	if info == nil || len(info.Sheets) == 0 {
		t.Fatal("expected sheet metadata")
	}
}

func TestHashAndCountStopsOnCancelledContext(t *testing.T) {
	path := fixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, _, _, err := hashAndCount(ctx, path); !errors.Is(err, ErrOpenTimeout) {
		t.Fatalf("err = %v, want ErrOpenTimeout", err)
	}
}
