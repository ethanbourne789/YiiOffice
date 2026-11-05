package workbook

import (
	"archive/zip"
	"encoding/xml"
	"io"
	"path"
	"strconv"
	"strings"
)

// ooxmlDefaultColWidth mirrors excelize's unexported defaultColWidth so the
// streaming scan and the library fallback return byte-identical ColumnWidth
// values. GetColWidth reports this number for every column that carries no
// explicit <col width>, which is why the old code emitted a Width for every
// column, custom or not.
const ooxmlDefaultColWidth = 9.140625

const ooxmlRelationshipsNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

// colDef is one <col> element of a worksheet, kept in document order because
// excelize resolves a column by taking the LAST matching definition.
type colDef struct {
	min, max     int
	width        *float64
	hidden       bool
	outlineLevel int
	style        int
}

// paneProps is a frozen/split pane. excelize exposes XSplit/YSplit as ints.
type paneProps struct {
	xSplit float64
	ySplit float64
	state  string
}

// sheetViewProps mirrors the subset of <sheetView> this package reads.
// excelize keeps ShowGridLines and ShowRowColHeaders as *bool but RightToLeft,
// ShowFormulas and ZoomScale as plain values; the distinction decides whether a
// missing attribute means "default" or "false", so it is preserved here.
type sheetViewProps struct {
	showGridLines     *bool
	showFormulas      bool
	showRowColHeaders *bool
	rightToLeft       bool
	zoomScale         float64
	pane              *paneProps
}

// sheetGeometry is the result of one streaming pass over a worksheet part: the
// row/column extent, the raw <col> definitions, and every worksheet-level
// property SheetMeta needs. Producing all of it from a single decode is the
// point — excelize parsed the same XML twice (Rows() marshals and re-decodes an
// already parsed sheet, then the first GetCol* call parses it again) and its
// getters all forced that second parse.
type sheetGeometry struct {
	rows int
	cols int
	defs []colDef

	// state comes from workbook.xml (<sheet state="hidden|veryHidden">).
	state string
	// tabColorRGB is <sheetPr><tabColor rgb>; empty means "no colour".
	tabColorRGB string
	// sheetFormatPr values; nil when the element or attribute is absent.
	defaultRowHeight *float64
	defaultColWidth  *float64
	// views is <sheetViews><sheetView> in document order.
	views []sheetViewProps
	// tableRIDs are <tableParts><tablePart r:id> in document order.
	tableRIDs []string
	// tables are the resolved table parts, in the same order.
	tables []SheetTable
}

// columnWidths materialises the per-column records the renderer expects. The
// semantics deliberately match excelize.GetCol{Style,Width,Visible,OutlineLevel}
// column by column: a definition applies when min <= n <= max, the last match
// wins, and width keeps the previous value when the matching <col> has no
// width attribute.
func (g *sheetGeometry) columnWidths() []ColumnWidth {
	cols := g.cols
	out := make([]ColumnWidth, 0, cols)
	if cols <= 0 {
		return out
	}
	// One slot per column keeps expansion linear: <col min="1" max="16384">
	// must not allocate 16384 entries when the sheet only used 20 columns.
	style := make([]int, cols+1)
	width := make([]float64, cols+1)
	hidden := make([]bool, cols+1)
	level := make([]int, cols+1)
	for _, d := range g.defs {
		lo, hi := d.min, d.max
		if lo < 1 {
			lo = 1
		}
		if hi > cols {
			hi = cols
		}
		if hi < lo {
			continue
		}
		for n := lo; n <= hi; n++ {
			style[n] = d.style
			if d.width != nil {
				width[n] = *d.width
			}
			hidden[n] = d.hidden
			level[n] = d.outlineLevel
		}
	}
	for n := 1; n <= cols; n++ {
		cw := ColumnWidth{StartColumn: n - 1, EndColumn: n - 1, Hidden: hidden[n]}
		w := width[n]
		if w == 0 {
			w = ooxmlDefaultColWidth
		}
		if w > 0 {
			widthVal := w
			cw.Width = &widthVal
		}
		if level[n] > 0 {
			cw.OutlineLevel = level[n]
		}
		if style[n] > 0 {
			id := style[n]
			cw.StyleIndex = &id
		}
		out = append(out, cw)
	}
	return out
}

// applyWorksheetMeta fills every field of meta that comes from the worksheet
// part or from the <sheet> entry. It is the streaming equivalent of the
// GetSheetVisible/GetSheetProps/GetSheetView/GetPanes chain it replaced, and
// the defaults follow that chain exactly (grid lines on, no zoom override,
// rightToLeft false when absent).
func (g *sheetGeometry) applyWorksheetMeta(meta *SheetMeta) {
	meta.RowCount = g.rows
	meta.ColumnCount = g.cols
	meta.ColumnWidths = g.columnWidths()
	meta.Tables = g.tables
	if meta.Tables == nil {
		meta.Tables = []SheetTable{}
	}

	// GetSheetVisible: state "" or "visible" is visible; hidden/veryHidden are
	// not. VeryHidden is deliberately left false, as the library path did.
	if g.state != "" && g.state != "visible" {
		meta.Hidden = true
	}
	if g.tabColorRGB != "" {
		color := normalizeColor(g.tabColorRGB)
		meta.TabColor = &color
	}
	if g.defaultRowHeight != nil && *g.defaultRowHeight > 0 {
		meta.DefaultRowHeight = g.defaultRowHeight
	}
	if g.defaultColWidth != nil && *g.defaultColWidth > 0 {
		meta.DefaultColumnWidth = g.defaultColWidth
	}

	// GetSheetView reads view index 0; getPanes reads the last entry. Real
	// files carry one <sheetView>, but a file that carries several must keep
	// the same split as the library path.
	if len(g.views) > 0 {
		first := g.views[0]
		if first.showGridLines != nil {
			meta.ShowGridLines = *first.showGridLines
		}
		if first.showFormulas {
			show := true
			meta.ShowFormulas = &show
		}
		if first.showRowColHeaders != nil && !*first.showRowColHeaders {
			show := false
			meta.ShowRowColHeaders = &show
		}
		meta.RightToLeft = first.rightToLeft
		if zoom := int(first.zoomScale); zoom >= 10 && zoom <= 400 && zoom != 100 {
			meta.ZoomScale = zoom
		}
	}
	if len(g.views) > 0 {
		if last := g.views[len(g.views)-1]; last.pane != nil && last.pane.state != "" {
			// Only "frozen"/"frozenSplit" produce a freeze; "split" panes and
			// implicit splits leave Panes.Freeze false in excelize.
			if last.pane.state == "frozen" || last.pane.state == "frozenSplit" {
				meta.Freeze = &Freeze{
					FrozenColumns: int(last.pane.xSplit),
					FrozenRows:    int(last.pane.ySplit),
				}
			}
		}
	}
}

// readSheetGeometry reads geometry and worksheet properties for every sheet
// straight from the OOXML package. ok is false whenever the file cannot be
// handled this way — an encrypted workbook (an OLE container, not a zip), a
// CSV, a legacy .xls, or any unexpected package layout. The caller must then
// fall back to excelize, which is slower but handles all of those.
func readSheetGeometry(filePath string) (map[string]*sheetGeometry, bool) {
	zr, err := zip.OpenReader(filePath)
	if err != nil {
		return nil, false
	}
	defer zr.Close()

	files := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		files[f.Name] = f
	}
	refs, ok := readWorkbookSheetRefs(files)
	if !ok || len(refs) == 0 {
		return nil, false
	}
	rels, ok := readWorkbookRels(files)
	if !ok {
		return nil, false
	}
	out := make(map[string]*sheetGeometry, len(refs))
	for _, ref := range refs {
		target, ok := rels[ref.rid]
		if !ok {
			return nil, false
		}
		partName := resolveOOXMLPart(target)
		part, ok := files[partName]
		if !ok {
			return nil, false
		}
		geom, ok := scanSheetGeometry(part, files, partName)
		if !ok {
			return nil, false
		}
		geom.state = ref.state
		geom.tables = readSheetTables(files, partName, geom.tableRIDs)
		out[ref.name] = geom
	}
	return out, true
}

type sheetRef struct {
	name  string
	rid   string
	state string
}

// readWorkbookSheetRefs returns <sheet> entries in workbook order, which is the
// order excelize.GetSheetList reports. The tab colour lives on <sheetPr> inside
// the worksheet part, so it is collected by the per-sheet scan instead.
func readWorkbookSheetRefs(files map[string]*zip.File) ([]sheetRef, bool) {
	zf, ok := files["xl/workbook.xml"]
	if !ok {
		return nil, false
	}
	rc, err := zf.Open()
	if err != nil {
		return nil, false
	}
	defer rc.Close()

	dec := xml.NewDecoder(rc)
	var out []sheetRef
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, false
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "sheet" {
			continue
		}
		var ref sheetRef
		for _, a := range se.Attr {
			switch a.Name.Local {
			case "name":
				ref.name = a.Value
			case "state":
				ref.state = a.Value
			case "id":
				// sheetId also ends in "Id" but its local name is "sheetId",
				// so only the relationship attribute reaches here.
				if ref.rid == "" || a.Name.Space == ooxmlRelationshipsNS {
					ref.rid = a.Value
				}
			}
		}
		if ref.name != "" && ref.rid != "" {
			out = append(out, ref)
		}
	}
	return out, true
}

// readWorkbookRels maps relationship ids to their targets. Only worksheet
// relationships are kept here; table parts are resolved per sheet.
func readWorkbookRels(files map[string]*zip.File) (map[string]string, bool) {
	return readRels(files, "xl/_rels/workbook.xml.rels", "/worksheet")
}

// readRels parses a .rels part and keeps the relationships whose Type ends with
// typeSuffix. An empty suffix keeps every relationship.
func readRels(files map[string]*zip.File, part, typeSuffix string) (map[string]string, bool) {
	zf, ok := files[part]
	if !ok {
		return nil, false
	}
	rc, err := zf.Open()
	if err != nil {
		return nil, false
	}
	defer rc.Close()

	dec := xml.NewDecoder(rc)
	out := make(map[string]string, 8)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, false
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "Relationship" {
			continue
		}
		var id, target, typ string
		for _, a := range se.Attr {
			switch a.Name.Local {
			case "Id":
				id = a.Value
			case "Target":
				target = a.Value
			case "Type":
				typ = a.Value
			}
		}
		if id == "" || target == "" {
			continue
		}
		if typeSuffix != "" && !strings.HasSuffix(typ, typeSuffix) {
			continue
		}
		out[id] = target
	}
	return out, true
}

// resolveOOXMLPart turns a relationship target into a zip entry name. Targets
// are either package-absolute ("/xl/worksheets/sheet1.xml") or relative to the
// part owning the relationship (xl/workbook.xml).
func resolveOOXMLPart(target string) string {
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(path.Clean(target), "/")
	}
	return path.Clean(path.Join("xl", target))
}

// resolveRelativePart resolves a target relative to the part that owns the
// relationship, e.g. "../tables/table1.xml" from "xl/worksheets/sheet1.xml"
// resolves to "xl/tables/table1.xml".
func resolveRelativePart(ownerPart, target string) string {
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(path.Clean(target), "/")
	}
	return path.Clean(path.Join(path.Dir(ownerPart), target))
}

// scanSheetGeometry walks a worksheet part once. Cell contents are skipped
// wholesale (dec.Skip) rather than tokenised: only the r attributes matter, and
// a <v> payload per cell is what made the excelize path allocate megabytes.
func scanSheetGeometry(zf *zip.File, files map[string]*zip.File, partName string) (*sheetGeometry, bool) {
	rc, err := zf.Open()
	if err != nil {
		return nil, false
	}
	defer rc.Close()

	g := &sheetGeometry{}
	dec := xml.NewDecoder(rc)
	// currentRow tracks the running column inside the open <row> so a <c> with
	// no r attribute (some generators omit it) still advances the extent.
	currentRow := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, false
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "col":
				g.defs = append(g.defs, parseColDef(t.Attr))
			case "row":
				// excelize reports the row POSITION, not the number of <row>
				// elements: a sheet whose data starts at r=40 yields 40 rows
				// because the iterator synthesises the empty rows above it.
				row := 0
				for _, a := range t.Attr {
					if a.Name.Local == "r" {
						row = atoiOr(a.Value, 0)
						break
					}
				}
				if row == 0 {
					row = g.rows + 1
				}
				if row > g.rows {
					g.rows = row
				}
				currentRow = 0
			case "c":
				col := 0
				for _, a := range t.Attr {
					if a.Name.Local == "r" {
						col = columnFromCellRef(a.Value)
						break
					}
				}
				if col == 0 {
					col = currentRow + 1
				}
				currentRow = col
				if col > g.cols {
					g.cols = col
				}
				// Skip the <v>/<is>/<f> payload; nothing inside affects geometry.
				if err := dec.Skip(); err != nil {
					return nil, false
				}
			case "sheetPr":
				if err := readSheetPr(dec, g); err != nil {
					return nil, false
				}
			case "sheetFormatPr":
				g.defaultRowHeight, g.defaultColWidth = readSheetFormatPr(t.Attr)
			case "sheetView":
				g.views = append(g.views, parseSheetView(dec, t.Attr))
			case "tableParts":
				if err := readTableParts(dec, g); err != nil {
					return nil, false
				}
			}
		case xml.EndElement:
			// </sheetData> closes the only huge section. Everything after it
			// (merges, validations, hyperlinks, drawings) is skipped in bulk so
			// the walk does not tokenise thousands of irrelevant nodes.
			if t.Name.Local == "sheetData" {
				if err := skipToTableParts(dec, g); err != nil {
					return nil, false
				}
				return finishGeometry(g), true
			}
		}
	}
	return finishGeometry(g), true
}

// skipToTableParts fast-forwards from the end of <sheetData> to the end of the
// worksheet, keeping only <tablePart> elements.
func skipToTableParts(dec *xml.Decoder, g *sheetGeometry) error {
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "tableParts" {
				if err := readTableParts(dec, g); err != nil {
					return err
				}
				continue
			}
			if err := dec.Skip(); err != nil {
				return err
			}
		case xml.EndElement:
			if t.Name.Local == "worksheet" {
				return nil
			}
		}
	}
}

// readSheetPr walks <sheetPr> looking for <tabColor rgb>. The element is tiny,
// so a plain token walk is cheaper than Skip bookkeeping.
func readSheetPr(dec *xml.Decoder, g *sheetGeometry) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "tabColor" {
				for _, a := range t.Attr {
					if a.Name.Local == "rgb" {
						g.tabColorRGB = a.Value
					}
				}
				if err := dec.Skip(); err != nil {
					return err
				}
				continue
			}
			if err := dec.Skip(); err != nil {
				return err
			}
		case xml.EndElement:
			if t.Name.Local == "sheetPr" {
				return nil
			}
		}
	}
}

func readSheetFormatPr(attrs []xml.Attr) (defaultRowHeight, defaultColWidth *float64) {
	for _, a := range attrs {
		v, err := strconv.ParseFloat(a.Value, 64)
		if err != nil {
			continue
		}
		switch a.Name.Local {
		case "defaultRowHeight":
			defaultRowHeight = &v
		case "defaultColWidth":
			defaultColWidth = &v
		}
	}
	return defaultRowHeight, defaultColWidth
}

func readTableParts(dec *xml.Decoder, g *sheetGeometry) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "tablePart" {
				for _, a := range t.Attr {
					if a.Name.Local == "id" {
						g.tableRIDs = append(g.tableRIDs, a.Value)
						break
					}
				}
			}
			if err := dec.Skip(); err != nil {
				return err
			}
		case xml.EndElement:
			if t.Name.Local == "tableParts" {
				return nil
			}
		}
	}
}

// parseSheetView consumes one <sheetView> element, including a nested <pane>.
func parseSheetView(dec *xml.Decoder, attrs []xml.Attr) sheetViewProps {
	view := sheetViewProps{}
	for _, a := range attrs {
		switch a.Name.Local {
		case "showGridLines":
			v := isOOXMLTrue(a.Value)
			view.showGridLines = &v
		case "showFormulas":
			view.showFormulas = isOOXMLTrue(a.Value)
		case "showRowColHeaders":
			v := isOOXMLTrue(a.Value)
			view.showRowColHeaders = &v
		case "rightToLeft":
			view.rightToLeft = isOOXMLTrue(a.Value)
		case "zoomScale":
			if z, err := strconv.ParseFloat(a.Value, 64); err == nil {
				view.zoomScale = z
			}
		}
	}
	for {
		tok, err := dec.Token()
		if err != nil {
			return view
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "pane" {
				pane := &paneProps{}
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "xSplit":
						if v, err := strconv.ParseFloat(a.Value, 64); err == nil {
							pane.xSplit = v
						}
					case "ySplit":
						if v, err := strconv.ParseFloat(a.Value, 64); err == nil {
							pane.ySplit = v
						}
					case "state":
						pane.state = a.Value
					}
				}
				view.pane = pane
			}
			if err := dec.Skip(); err != nil {
				return view
			}
		case xml.EndElement:
			if t.Name.Local == "sheetView" {
				return view
			}
		}
	}
}

// readSheetTables loads the table parts a sheet references, in document order.
// A table part that is missing or malformed is dropped, matching GetTables,
// which silently skips relationships whose target is not in the package.
func readSheetTables(files map[string]*zip.File, ownerPart string, rids []string) []SheetTable {
	out := make([]SheetTable, 0, len(rids))
	if len(rids) == 0 {
		return out
	}
	relsPart := path.Join(path.Dir(ownerPart), "_rels", path.Base(ownerPart)+".rels")
	rels, ok := readRels(files, relsPart, "/table")
	if !ok {
		return out
	}
	for _, rid := range rids {
		target, ok := rels[rid]
		if !ok {
			continue
		}
		zf, ok := files[resolveRelativePart(ownerPart, target)]
		if !ok {
			continue
		}
		if table, ok := parseTablePart(zf); ok {
			out = append(out, table)
		}
	}
	return out
}

func parseTablePart(zf *zip.File) (SheetTable, bool) {
	rc, err := zf.Open()
	if err != nil {
		return SheetTable{}, false
	}
	defer rc.Close()

	var ref, name, styleName string
	var showRowStripes, showColumnStripes bool
	dec := xml.NewDecoder(rc)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return SheetTable{}, false
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "table":
			for _, a := range se.Attr {
				switch a.Name.Local {
				case "ref":
					ref = a.Value
				case "name":
					name = a.Value
				}
			}
		case "tableStyleInfo":
			for _, a := range se.Attr {
				switch a.Name.Local {
				case "name":
					styleName = a.Value
				case "showRowStripes":
					showRowStripes = isOOXMLTrue(a.Value)
				case "showColumnStripes":
					showColumnStripes = isOOXMLTrue(a.Value)
				}
			}
		}
	}
	if ref == "" {
		return SheetTable{}, false
	}
	area, err := parseArea(ref)
	if err != nil {
		return SheetTable{}, false
	}
	return SheetTable{
		Range:             area,
		HeaderRowCount:    1,
		ShowRowStripes:    showRowStripes,
		ShowColumnStripes: showColumnStripes,
		Name:              name,
		StyleName:         styleName,
	}, true
}

func finishGeometry(g *sheetGeometry) *sheetGeometry {
	if g.rows < 1 {
		g.rows = 1
	}
	if g.cols < 1 {
		g.cols = 1
	}
	return g
}

func parseColDef(attrs []xml.Attr) colDef {
	var d colDef
	for _, a := range attrs {
		switch a.Name.Local {
		case "min":
			d.min = atoiOr(a.Value, 0)
		case "max":
			d.max = atoiOr(a.Value, 0)
		case "width":
			if w, err := strconv.ParseFloat(a.Value, 64); err == nil {
				d.width = &w
			}
		case "hidden":
			d.hidden = isOOXMLTrue(a.Value)
		case "outlineLevel":
			d.outlineLevel = atoiOr(a.Value, 0)
		case "style":
			d.style = atoiOr(a.Value, 0)
		}
	}
	return d
}

func atoiOr(s string, fallback int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}

func isOOXMLTrue(s string) bool {
	return s == "1" || s == "true" || s == "TRUE"
}

// columnFromCellRef converts the leading letters of a cell reference ("AB12")
// to a 1-based column number, returning 0 when the reference has no letters.
func columnFromCellRef(ref string) int {
	n := 0
	for i := 0; i < len(ref); i++ {
		c := ref[i]
		switch {
		case c >= 'A' && c <= 'Z':
			n = n*26 + int(c-'A') + 1
		case c >= 'a' && c <= 'z':
			n = n*26 + int(c-'a') + 1
		default:
			return n
		}
	}
	return n
}
