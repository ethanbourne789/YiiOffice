package workbook

import (
	"path/filepath"
	"testing"

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
