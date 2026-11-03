package workbook

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/xuri/excelize/v2"
)

// Engine owns open workbook sessions. It is safe for concurrent use.
type Engine struct {
	mu       sync.Mutex
	sessions map[string]*session
}

type session struct {
	// mu serialises every access to file and info. excelize.File is not
	// safe for concurrent use even for reads: GetCellValue and friends
	// lazily parse sheets into shared caches, so an RWMutex would still
	// race inside excelize itself. A plain Mutex keeps the writers (Save,
	// reload, Close) and every reader mutually exclusive.
	//
	// Engine.mu is never held while a session lock is taken, and no
	// session method calls another, so the two locks cannot deadlock.
	mu   sync.Mutex
	info FileInfo
	file *excelize.File
	// closed marks a session whose file has been (or is being) released.
	// It is only ever set with mu held, so acquire can reject a session
	// that was closed between the map lookup and the lock acquisition.
	closed bool
}

// NewEngine returns an empty engine.
func NewEngine() *Engine {
	return &Engine{sessions: map[string]*session{}}
}

// SessionCount reports how many sessions are open (used by tests and diagnostics).
func (e *Engine) SessionCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.sessions)
}

// CloseAll drops every open session and releases its workbook.
func (e *Engine) CloseAll() {
	e.mu.Lock()
	sessions := e.sessions
	e.sessions = map[string]*session{}
	e.mu.Unlock()
	for _, s := range sessions {
		s.mu.Lock()
		s.closed = true
		s.file.Close()
		s.mu.Unlock()
	}
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000-0000-4000-8000-000000000000"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]), hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]), hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]))
}

// Open loads the workbook at path and registers a session.
//
// Memory note: the SHA-256 is computed by streaming the file, so peak
// residency is excelize's single in-memory copy. The previous os.ReadFile
// of the whole workbook added a second full copy on top. excelize.OpenFile
// is used instead of OpenReader(bytes) because OpenReader io.ReadAll-copies
// its input, reintroducing the extra buffer; countZipEntries only reads the
// zip central directory.
func (e *Engine) Open(path string) (*FileInfo, error) {
	sum, size, err := hashFile(path)
	if err != nil {
		return nil, err
	}
	f, err := excelize.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("parse workbook: %w", err)
	}
	entryCount := countZipEntries(path)
	info := FileInfo{
		SessionID:  newUUID(),
		Name:       filepath.Base(path),
		Path:       path,
		SHA256:     hex.EncodeToString(sum[:]),
		FileBytes:  size,
		EntryCount: entryCount,
		ReadOnly:   isReadOnly(path),
		Sheets:     sheetMetadata(f),
		ActiveTab:  clampActiveTab(f.GetActiveSheetIndex(), len(f.GetSheetList())),
		Styles:     styleTable(f),
		DxfStyles:  []CellStyle{},
		Visuals:    []any{},
		DefinedNames: definedNames(f),
	}
	e.mu.Lock()
	e.sessions[info.SessionID] = &session{info: info, file: f}
	e.mu.Unlock()
	return &info, nil
}

// Close drops the session and releases the underlying workbook.
func (e *Engine) Close(sessionID string) error {
	e.mu.Lock()
	s, ok := e.sessions[sessionID]
	delete(e.sessions, sessionID)
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("unknown session %q", sessionID)
	}
	// Wait out any in-flight read/write before releasing the file. The
	// closed flag is set under s.mu, so an operation that already holds
	// the lock finishes against a live file, and any later acquire sees
	// closed and reports the session as unknown.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.file.Close()
}

// acquire returns a session with s.mu held, or an error. The caller must
// unlock s.mu when done. Re-checking closed under s.mu closes the TOCTOU
// window where Close deletes the session between a map lookup and the
// caller taking the lock, which would otherwise use a closed excelize
// file. Engine.mu is released before s.mu is taken, preserving the rule
// that Engine.mu is never held while a session lock is acquired.
func (e *Engine) acquire(sessionID string) (*session, error) {
	e.mu.Lock()
	s, ok := e.sessions[sessionID]
	e.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	return s, nil
}

// SheetName resolves a renderer sheet id (which equals the sheet name) to a
// worksheet the excelize file accepts.
func (e *Engine) SheetName(sessionID, sheetID string) (string, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return "", err
	}
	defer s.mu.Unlock()
	if _, err := s.file.GetSheetIndex(sheetID); err != nil {
		return "", fmt.Errorf("unknown sheet %q", sheetID)
	}
	return sheetID, nil
}

// Info returns the metadata snapshot of an open session.
func (e *Engine) Info(sessionID string) (*FileInfo, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	info := s.info
	return &info, nil
}

// ── metadata helpers ──

// hashFile streams path through SHA-256 and returns the digest plus the
// byte count, without holding the file contents in memory.
func hashFile(path string) ([sha256.Size]byte, int64, error) {
	fh, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, 0, fmt.Errorf("read workbook: %w", err)
	}
	defer fh.Close()
	h := sha256.New()
	n, err := io.Copy(h, fh)
	if err != nil {
		return [sha256.Size]byte{}, 0, fmt.Errorf("hash workbook: %w", err)
	}
	var sum [sha256.Size]byte
	copy(sum[:], h.Sum(nil))
	return sum, n, nil
}

func countZipEntries(path string) int {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return 0
	}
	defer zr.Close()
	return len(zr.File)
}

func isReadOnly(path string) bool {
	fh, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return true
	}
	fh.Close()
	return false
}

func clampActiveTab(index, total int) int {
	if total == 0 || index < 0 || index >= total {
		return 0
	}
	return index
}

func sheetMetadata(f *excelize.File) []SheetMeta {
	names := f.GetSheetList()
	out := make([]SheetMeta, 0, len(names))
	for _, name := range names {
		rows, cols := sheetDimensions(f, name)
		meta := SheetMeta{
			ID:            name,
			Name:          name,
			RowCount:      rows,
			ColumnCount:   cols,
			ColumnWidths:  columnWidths(f, name, cols),
			ShowGridLines: true,
			Tables:        sheetTables(f, name),
			Comments:      []Comment{},
			PivotRanges:   []CellArea{},
			PivotTables:   []any{},
			Sparklines:    []any{},
			CellImages:    []any{},
		}
		if visible, err := f.GetSheetVisible(name); err == nil && !visible {
			meta.Hidden = true
		}
		if props, err := f.GetSheetProps(name); err == nil {
			if props.TabColorRGB != nil && *props.TabColorRGB != "" {
				color := normalizeColor(*props.TabColorRGB)
				meta.TabColor = &color
			}
			// The renderer schema wants null rather than 0 for "default".
			if props.DefaultRowHeight != nil && *props.DefaultRowHeight > 0 {
				meta.DefaultRowHeight = props.DefaultRowHeight
			}
			if props.DefaultColWidth != nil && *props.DefaultColWidth > 0 {
				meta.DefaultColumnWidth = props.DefaultColWidth
			}
		}
		if view, err := f.GetSheetView(name, 0); err == nil {
			if view.ShowGridLines != nil {
				meta.ShowGridLines = *view.ShowGridLines
			}
			if view.ShowFormulas != nil && *view.ShowFormulas {
				show := true
				meta.ShowFormulas = &show
			}
			if view.ShowRowColHeaders != nil && !*view.ShowRowColHeaders {
				show := false
				meta.ShowRowColHeaders = &show
			}
			if view.RightToLeft != nil {
				meta.RightToLeft = *view.RightToLeft
			}
			if view.ZoomScale != nil {
				zoom := int(*view.ZoomScale)
				if zoom >= 10 && zoom <= 400 && zoom != 100 {
					meta.ZoomScale = zoom
				}
			}
		}
		if panes, err := f.GetPanes(name); err == nil && panes.Freeze {
			meta.Freeze = &Freeze{FrozenColumns: panes.XSplit, FrozenRows: panes.YSplit}
		}
		out = append(out, meta)
	}
	return out
}

// sheetDimensions derives the used range from the stored rows because the
// sheet-level <dimension> element is frequently stale in real workbooks.
func sheetDimensions(f *excelize.File, sheet string) (rows, cols int) {
	iter, err := f.Rows(sheet)
	if err != nil {
		return 1, 1
	}
	defer iter.Close()
	for iter.Next() {
		rows++
		cells, cerr := iter.Columns()
		if cerr == nil && len(cells) > cols {
			cols = len(cells)
		}
	}
	return maxInt(rows, 1), maxInt(cols, 1)
}

func columnWidths(f *excelize.File, sheet string, cols int) []ColumnWidth {
	out := make([]ColumnWidth, 0, cols)
	for col := 1; col <= cols; col++ {
		styleID, _ := f.GetColStyle(sheet, columnName(col))
		width, _ := f.GetColWidth(sheet, columnName(col))
		visible, _ := f.GetColVisible(sheet, columnName(col))
		level, _ := f.GetColOutlineLevel(sheet, columnName(col))
		cw := ColumnWidth{StartColumn: col - 1, EndColumn: col - 1, Hidden: !visible}
		if width > 0 {
			w := width
			cw.Width = &w
		}
		if level > 0 {
			cw.OutlineLevel = int(level)
		}
		if styleID > 0 {
			id := styleID
			cw.StyleIndex = &id
		}
		out = append(out, cw)
	}
	return out
}

func sheetTables(f *excelize.File, sheet string) []SheetTable {
	tables, err := f.GetTables(sheet)
	if err != nil {
		return []SheetTable{}
	}
	out := make([]SheetTable, 0, len(tables))
	for _, t := range tables {
		area, err := parseArea(t.Range)
		if err != nil {
			continue
		}
		st := SheetTable{
			Range:             area,
			HeaderRowCount:    1,
			ShowRowStripes:    t.ShowRowStripes != nil && *t.ShowRowStripes,
			ShowColumnStripes: t.ShowColumnStripes,
			Name:              t.Name,
			StyleName:         t.StyleName,
		}
		out = append(out, st)
	}
	return out
}

func styleTable(f *excelize.File) []CellStyle {
	out := make([]CellStyle, 0, 64)
	for i := 0; i < 4096; i++ {
		st, err := f.GetStyle(i)
		if err != nil || st == nil {
			break
		}
		out = append(out, convertStyle(st))
	}
	if len(out) == 0 {
		out = append(out, CellStyle{})
	}
	return out
}

func convertStyle(st *excelize.Style) CellStyle {
	cs := CellStyle{}
	if st.Font != nil {
		cs.FontFamily = st.Font.Family
		if st.Font.Size > 0 {
			size := st.Font.Size
			cs.FontSize = &size
		}
		cs.Bold = st.Font.Bold
		cs.Italic = st.Font.Italic
		cs.Underline = st.Font.Underline != ""
		cs.Strikethrough = st.Font.Strike
		cs.FontColor = normalizeColor(st.Font.Color)
	}
	if fill := firstFillColor(st.Fill); fill != "" {
		cs.FillColor = fill
	}
	if st.Alignment != nil {
		cs.HorizontalAlignment = st.Alignment.Horizontal
		cs.VerticalAlignment = st.Alignment.Vertical
		cs.WrapText = st.Alignment.WrapText
		cs.ShrinkToFit = st.Alignment.ShrinkToFit
		cs.Indent = st.Alignment.Indent
		cs.TextRotation = st.Alignment.TextRotation
	}
	if st.CustomNumFmt != nil && *st.CustomNumFmt != "" {
		cs.NumberFormat = *st.CustomNumFmt
	} else if code := builtinNumFmt(st.NumFmt); code != "" && code != "General" {
		cs.NumberFormat = code
	}
	for _, b := range st.Border {
		edge := &BorderEdge{Style: borderStyleName(b.Style), Color: normalizeColor(b.Color)}
		switch b.Type {
		case "left":
			cs.BorderLeft = edge
		case "right":
			cs.BorderRight = edge
		case "top":
			cs.BorderTop = edge
		case "bottom":
			cs.BorderBottom = edge
		}
	}
	return cs
}

func firstFillColor(fill excelize.Fill) string {
	for _, c := range fill.Color {
		if c != "" {
			return normalizeColor(c)
		}
	}
	return ""
}

func normalizeColor(c string) string {
	c = strings.TrimSpace(c)
	if c == "" {
		return ""
	}
	if strings.HasPrefix(c, "#") {
		return strings.ToUpper(c)
	}
	return "#" + strings.ToUpper(c)
}

func borderStyleName(style int) string {
	names := []string{"none", "thin", "medium", "dashed", "dotted", "thick", "double",
		"hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"}
	if style >= 0 && style < len(names) {
		return names[style]
	}
	return "thin"
}

func builtinNumFmt(id int) string {
	codes := map[int]string{
		0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
		9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
		14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
		18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
		22: "m/d/yy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)",
		39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
		45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
	}
	return codes[id]
}

func definedNames(f *excelize.File) []DefinedName {
	defs := f.GetDefinedName()
	out := make([]DefinedName, 0, len(defs))
	for _, d := range defs {
		dn := DefinedName{Name: d.Name, Formula: d.RefersTo}
		if strings.HasPrefix(d.RefersTo, "=") {
			dn.Formula = d.RefersTo
		}
		out = append(out, dn)
	}
	return out
}

func columnName(col int) string {
	name, _ := excelize.ColumnNumberToName(col)
	return name
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// parseArea converts "A1:B2" (or a single cell) into a 0-based area.
func parseArea(ref string) (CellArea, error) {
	ref = strings.TrimSpace(strings.ReplaceAll(ref, "$", ""))
	if ref == "" {
		return CellArea{}, fmt.Errorf("empty range")
	}
	parts := strings.Split(ref, ":")
	// excelize returns (column, row) from CellNameToCoordinates.
	startCol, startRow, err := excelize.CellNameToCoordinates(parts[0])
	if err != nil {
		return CellArea{}, fmt.Errorf("parse range %q: %w", ref, err)
	}
	endCol, endRow := startCol, startRow
	if len(parts) == 2 {
		c, r, cerr := excelize.CellNameToCoordinates(parts[1])
		if cerr != nil {
			return CellArea{}, fmt.Errorf("parse range %q: %w", ref, cerr)
		}
		endCol, endRow = c, r
	}
	if endRow < startRow || endCol < startCol {
		startRow, endRow = endRow, startRow
		startCol, endCol = endCol, startCol
	}
	return CellArea{
		StartRow:    startRow - 1,
		EndRow:      endRow - 1,
		StartColumn: startCol - 1,
		EndColumn:   endCol - 1,
	}, nil
}

func containsArea(outer, inner CellArea) bool {
	return inner.StartRow >= outer.StartRow && inner.EndRow <= outer.EndRow &&
		inner.StartColumn >= outer.StartColumn && inner.EndColumn <= outer.EndColumn
}

func cellRef(row, col int) string {
	ref, _ := excelize.CoordinatesToCellName(col+1, row+1)
	return ref
}

// cellValue converts a raw stored cell into a renderer scalar.
func cellValue(f *excelize.File, sheet, ref string) any {
	raw, err := f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
	if err != nil || raw == "" {
		return nil
	}
	cellType, err := f.GetCellType(sheet, ref)
	if err == nil {
		switch cellType {
		// A stored number has no explicit type attribute, so Unset is numeric.
		case excelize.CellTypeUnset, excelize.CellTypeNumber, excelize.CellTypeDate:
			if num, perr := strconv.ParseFloat(raw, 64); perr == nil {
				return num
			}
		case excelize.CellTypeBool:
			return raw == "1" || strings.EqualFold(raw, "true")
		}
	}
	return raw
}

func cellFormula(f *excelize.File, sheet, ref string) string {
	formula, err := f.GetCellFormula(sheet, ref)
	if err != nil || formula == "" {
		return ""
	}
	if strings.HasPrefix(formula, "=") {
		return formula
	}
	return "=" + formula
}
