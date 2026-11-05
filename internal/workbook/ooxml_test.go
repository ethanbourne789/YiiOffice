package workbook

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/xuri/excelize/v2"
)

func boolRef(v bool) *bool          { return &v }
func stringRef(v string) *string    { return &v }
func float64Ref(v float64) *float64 { return &v }

// geometryFixture builds a workbook that exercises every worksheet property the
// streaming scan has to reproduce: hidden/visible sheets, tab colour, frozen
// panes, view flags, column width/visibility/outline/style, a table, an empty
// sheet and sparse rows.
func geometryFixture(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.xlsx")
	f := excelize.NewFile()

	const sheet = "Sheet1"
	for _, cell := range []string{"A1", "B2", "D4", "J10"} {
		if err := f.SetCellValue(sheet, cell, "v-"+cell); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.SetColWidth(sheet, "B", "B", 25.5); err != nil {
		t.Fatal(err)
	}
	if err := f.SetColVisible(sheet, "C", false); err != nil {
		t.Fatal(err)
	}
	if err := f.SetColOutlineLevel(sheet, "D", 2); err != nil {
		t.Fatal(err)
	}
	if err := f.SetPanes(sheet, &excelize.Panes{
		Freeze: true, XSplit: 1, YSplit: 2,
		TopLeftCell: "B3", ActivePane: "bottomRight",
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.SetSheetView(sheet, 0, &excelize.ViewOptions{
		ShowGridLines:     boolRef(false),
		ShowFormulas:      boolRef(true),
		ShowRowColHeaders: boolRef(false),
		RightToLeft:       boolRef(true),
		ZoomScale:         float64Ref(150),
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.SetSheetProps(sheet, &excelize.SheetPropsOptions{
		TabColorRGB: stringRef("FF00FF00"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.AddTable(sheet, &excelize.Table{
		Range: "A1:D4", Name: "Sales", StyleName: "TableStyleMedium2",
		ShowRowStripes: boolRef(true),
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := f.NewSheet("Hidden"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Hidden", "A1", "x"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetSheetVisible("Hidden", false); err != nil {
		t.Fatal(err)
	}

	if _, err := f.NewSheet("Empty"); err != nil {
		t.Fatal(err)
	}

	// A sheet whose only cell sits far from the origin: the extent must follow
	// the r attributes, not the row count.
	if _, err := f.NewSheet("Sparse"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Sparse", "H40", "far"); err != nil {
		t.Fatal(err)
	}

	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestSheetGeometryMatchesExcelize is the safety net for the streaming scan:
// for every sheet of a workbook that exercises the full property surface, the
// scanned SheetMeta must equal the one the excelize getters produce, field for
// field. Any divergence here is a rendering regression.
func TestSheetGeometryMatchesExcelize(t *testing.T) {
	path := geometryFixture(t)

	f, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read-only fixture handle

	geometry, ok := readSheetGeometry(path)
	if !ok {
		t.Fatal("streaming scan declined a plain .xlsx; the fallback would hide a real regression")
	}

	names := f.GetSheetList()
	if len(geometry) != len(names) {
		t.Fatalf("scanned %d sheets, excelize lists %d", len(geometry), len(names))
	}
	for _, name := range names {
		geom, ok := geometry[name]
		if !ok {
			t.Fatalf("sheet %q missing from the scan", name)
		}

		want := SheetMeta{}
		applyWorksheetMetaFromExcelize(f, name, &want)

		got := SheetMeta{ShowGridLines: true}
		geom.applyWorksheetMeta(&got)

		if !reflect.DeepEqual(got, want) {
			t.Errorf("sheet %q metadata differs\n scan: %#v\nexcel: %#v", name, got, want)
		}
	}
}

// minimalXlsx writes the smallest package the E2E suite and other hand-rolled
// generators produce: one worksheet with a single row and no <sheetViews>,
// <sheetFormatPr>, <cols> or <dimension>. Those omissions are the point — a
// scan that assumes the optional elements are present crashes on exactly the
// files a third-party generator writes.
func minimalXlsx(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "minimal.xlsx")
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	parts := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
		"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
		"xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>seed</t></is></c></row></sheetData></worksheet>`,
	}
	for _, name := range []string{
		"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
		"xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml",
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(parts[name])); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestSheetGeometryMinimalPackage covers the "no optional elements" shape that
// the excelize-generated fixture never produces. It regressed once: the pane
// lookup indexed views[len-1] unconditionally, so a worksheet without
// <sheetViews> panicked and the document failed to open at all (E2E caught it,
// this test is the unit-level guard). The comparison against excelize is still
// the real assertion — not panicking is only half of "correct".
func TestSheetGeometryMinimalPackage(t *testing.T) {
	path := minimalXlsx(t, t.TempDir())

	f, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read-only fixture handle

	geometry, ok := readSheetGeometry(path)
	if !ok {
		t.Fatal("streaming scan declined a minimal package; it would silently cost the fast path")
	}
	geom, ok := geometry["Sheet1"]
	if !ok {
		t.Fatal("Sheet1 missing from the scan")
	}

	want := SheetMeta{}
	applyWorksheetMetaFromExcelize(f, "Sheet1", &want)

	got := SheetMeta{ShowGridLines: true}
	geom.applyWorksheetMeta(&got)

	if !reflect.DeepEqual(got, want) {
		t.Errorf("minimal package metadata differs\n scan: %#v\nexcel: %#v", got, want)
	}
	if !applyScannedMeta(geom, &SheetMeta{ShowGridLines: true}) {
		t.Error("applyScannedMeta reported a failure on a valid package")
	}
}

// TestSheetGeometryFallsBackForUnreadableContainers pins the contract the
// caller relies on: anything that is not a plain OOXML package must be
// declined so the excelize path takes over. Encrypted workbooks are OLE
// containers, and CSV files are not zip archives at all.
func TestSheetGeometryFallsBackForUnreadableContainers(t *testing.T) {
	t.Run("csv", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "plain.csv")
		if err := os.WriteFile(path, []byte("a,b\n1,2\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, ok := readSheetGeometry(path); ok {
			t.Fatal("scan accepted a CSV file; it must defer to excelize")
		}
	})

	t.Run("encrypted", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "secret.xlsx")
		f := excelize.NewFile()
		if err := f.SetCellValue(f.GetSheetName(0), "A1", "secret"); err != nil {
			t.Fatal(err)
		}
		if err := f.SaveAs(path, excelize.Options{Password: "pw"}); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
		if _, ok := readSheetGeometry(path); ok {
			t.Fatal("scan accepted an encrypted workbook; it must defer to excelize")
		}
	})

	t.Run("missing", func(t *testing.T) {
		if _, ok := readSheetGeometry(filepath.Join(t.TempDir(), "nope.xlsx")); ok {
			t.Fatal("scan accepted a missing file")
		}
	})
}

// TestEncryptedWorkbookStillOpens proves the fallback keeps encrypted sessions
// working end to end, not just that the scan declines them.
func TestEncryptedWorkbookStillOpens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret.xlsx")
	f := excelize.NewFile()
	if err := f.SetCellValue(f.GetSheetName(0), "A1", "secret"); err != nil {
		t.Fatal(err)
	}
	if err := f.SaveAs(path, excelize.Options{Password: "pw"}); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	e := NewEngine()
	info, err := e.OpenWithPassword(path, "pw")
	if err != nil {
		t.Fatalf("open with password: %v", err)
	}
	defer e.Close(info.SessionID) //nolint:errcheck // best-effort cleanup

	if len(info.Sheets) != 1 {
		t.Fatalf("expected 1 sheet, got %d", len(info.Sheets))
	}
	if got := info.Sheets[0].RowCount; got != 1 {
		t.Errorf("RowCount = %d, want 1 (fallback path)", got)
	}
	if got := info.Sheets[0].ColumnCount; got != 1 {
		t.Errorf("ColumnCount = %d, want 1 (fallback path)", got)
	}
}

func TestColumnFromCellRef(t *testing.T) {
	cases := map[string]int{
		"A1": 1, "B2": 2, "Z9": 26, "AA1": 27, "AZ3": 52, "BA1": 53, "AB12": 28,
		"": 0, "1": 0, "a1": 1, "C": 3,
	}
	for ref, want := range cases {
		if got := columnFromCellRef(ref); got != want {
			t.Errorf("columnFromCellRef(%q) = %d, want %d", ref, got, want)
		}
	}
}

func TestResolveRelativePart(t *testing.T) {
	cases := []struct{ owner, target, want string }{
		{"xl/worksheets/sheet1.xml", "../tables/table1.xml", "xl/tables/table1.xml"},
		{"xl/worksheets/sheet1.xml", "/xl/tables/table1.xml", "xl/tables/table1.xml"},
		{"xl/worksheets/sheet1.xml", "tables/table1.xml", "xl/worksheets/tables/table1.xml"},
		{"xl/workbook.xml", "worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"},
	}
	for _, tc := range cases {
		if got := resolveRelativePart(tc.owner, tc.target); got != tc.want {
			t.Errorf("resolveRelativePart(%q, %q) = %q, want %q", tc.owner, tc.target, got, tc.want)
		}
	}
}

func TestResolveOOXMLPart(t *testing.T) {
	cases := []struct{ target, want string }{
		{"worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"},
		{"/xl/worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"},
		{"./worksheets/sheet2.xml", "xl/worksheets/sheet2.xml"},
	}
	for _, tc := range cases {
		if got := resolveOOXMLPart(tc.target); got != tc.want {
			t.Errorf("resolveOOXMLPart(%q) = %q, want %q", tc.target, got, tc.want)
		}
	}
}

// TestColumnWidthsExpansionIsBounded ensures a <col min="1" max="16384"> entry
// does not pay for 16384 columns when the used range is small. The scan clamps
// the interval to the detected column count.
func TestColumnWidthsExpansionIsBounded(t *testing.T) {
	wide := 9.0
	g := &sheetGeometry{
		cols: 3,
		defs: []colDef{{min: 1, max: 16384, width: &wide}},
	}
	out := g.columnWidths()
	if len(out) != 3 {
		t.Fatalf("len = %d, want 3", len(out))
	}
	for i, cw := range out {
		if cw.Width == nil || *cw.Width != wide {
			t.Errorf("column %d width = %v, want %v", i, cw.Width, wide)
		}
	}
}

// TestColumnWidthsLastMatchWins mirrors excelize: overlapping <col> entries
// resolve to the last one that applies.
func TestColumnWidthsLastMatchWins(t *testing.T) {
	first, second := 10.0, 20.0
	g := &sheetGeometry{
		cols: 2,
		defs: []colDef{
			{min: 1, max: 2, width: &first},
			{min: 2, max: 2, width: &second},
		},
	}
	out := g.columnWidths()
	if out[0].Width == nil || *out[0].Width != first {
		t.Errorf("col 1 width = %v, want %v", out[0].Width, first)
	}
	if out[1].Width == nil || *out[1].Width != second {
		t.Errorf("col 2 width = %v, want %v (last match)", out[1].Width, second)
	}
}
