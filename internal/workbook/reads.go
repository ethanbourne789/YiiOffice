package workbook

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

// scanLimit caps how many cells a linear scan touches so a huge sheet cannot
// stall the UI thread that is waiting on the binding call.
const scanLimit = 500_000

// ReadRange returns the stored cells, row attributes, merges and hyperlinks
// that intersect area.
func (e *Engine) ReadRange(sessionID, sheet string, area CellArea) (*RangeResult, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	if _, err := s.file.GetSheetIndex(sheet); err != nil {
		return nil, fmt.Errorf("unknown sheet %q", sheet)
	}
	if area.EndRow < area.StartRow || area.EndColumn < area.StartColumn {
		return nil, fmt.Errorf("range boundaries are reversed")
	}
	result := &RangeResult{
		Cells:             []CellRecord{},
		Rows:              []RowRecord{},
		Merges:            []CellArea{},
		Hyperlinks:        []Hyperlink{},
		ConditionalRules:  []any{},
		AutoFilterColumns: []any{},
		DataValidations:   []DataValidation{},
		RowBreaks:         []int{},
		ColBreaks:         []int{},
		ProtectedRanges:   []ProtectedRange{},
		IndexingComplete:  true,
	}
	if area.EndRow-area.StartRow > scanLimit || area.EndColumn-area.StartColumn > scanLimit {
		return nil, fmt.Errorf("range exceeds the %d cell scan limit", scanLimit)
	}
	for row := area.StartRow; row <= area.EndRow; row++ {
		var outline int
		if level, lerr := s.file.GetRowOutlineLevel(sheet, row+1); lerr == nil && level > 0 {
			outline = int(level)
		}
		visible, _ := s.file.GetRowVisible(sheet, row+1)
		if outline > 0 || !visible {
			result.Rows = append(result.Rows, RowRecord{
				Row:          row,
				Hidden:       !visible,
				OutlineLevel: outline,
			})
		}
		for col := area.StartColumn; col <= area.EndColumn; col++ {
			ref := cellRef(row, col)
			value := cellValue(s.file, sheet, ref)
			formula := cellFormula(s.file, sheet, ref)
			styleID, serr := s.file.GetCellStyle(sheet, ref)
			if serr == nil && styleID > 0 {
				id := styleID
				result.Cells = append(result.Cells, CellRecord{
					Row: row, Column: col, Value: value, Formula: formula, StyleIndex: &id,
				})
				continue
			}
			if value != nil || formula != "" {
				result.Cells = append(result.Cells, CellRecord{Row: row, Column: col, Value: value, Formula: formula})
			}
		}
	}
	result.Merges = mergesInArea(s.file, sheet, area)
	result.Hyperlinks = hyperlinksInArea(s.file, sheet, area)
	result.DataValidations = validationsInArea(s.file, sheet, area)
	return result, nil
}

func mergesInArea(f *excelize.File, sheet string, area CellArea) []CellArea {
	merges, err := f.GetMergeCells(sheet, true)
	if err != nil {
		return []CellArea{}
	}
	out := make([]CellArea, 0, len(merges))
	for _, m := range merges {
		mergeArea, err := parseArea(m.GetStartAxis() + ":" + m.GetEndAxis())
		if err != nil || !containsArea(area, mergeArea) {
			continue
		}
		out = append(out, mergeArea)
	}
	return out
}

// applyHyperlinkEdit writes one hyperlink change. excelize has no exported
// delete call (removeHyperLink is private), but SetCellHyperLink's "None"
// link type routes to it, so removal goes through the same setter.
func applyHyperlinkEdit(f *excelize.File, edit HyperlinkEdit) error {
	ref := edit.Cell
	if ref == "" {
		ref = cellRef(edit.Row, edit.Column)
	}
	var opts []excelize.HyperlinkOpts
	if edit.Display != nil || edit.Tooltip != nil {
		opts = append(opts, excelize.HyperlinkOpts{Display: edit.Display, Tooltip: edit.Tooltip})
	}
	// The renderer marks internal anchors with '#', while OOXML stores the
	// plain "Sheet!A1" location, so strip the sigil before choosing the type.
	target := strings.TrimSpace(edit.Target)
	location := strings.TrimSpace(strings.TrimPrefix(edit.Location, "#"))
	if location == "" && strings.HasPrefix(target, "#") {
		location, target = strings.TrimPrefix(target, "#"), ""
	}
	switch {
	case target == "" && location == "":
		return f.SetCellHyperLink(edit.SheetID, ref, "", "None")
	case target != "":
		return f.SetCellHyperLink(edit.SheetID, ref, target, "External", opts...)
	default:
		return f.SetCellHyperLink(edit.SheetID, ref, location, "Location", opts...)
	}
}

func hyperlinksInArea(f *excelize.File, sheet string, area CellArea) []Hyperlink {
	// Both link kinds are read: external relationships and workbook-internal
	// anchors. GetCellHyperLink cannot tell them apart for scheme-less
	// targets, so the type comes from GetHyperLinkCells and internal anchors
	// get the renderer's '#' prefix back.
	out := []Hyperlink{}
	for _, kind := range []struct {
		linkType string
		prefix   string
	}{{"External", ""}, {"Location", "#"}} {
		cells, err := f.GetHyperLinkCells(sheet, kind.linkType)
		if err != nil {
			continue
		}
		for _, ref := range cells {
			col1, row1, err := excelize.CellNameToCoordinates(ref)
			if err != nil {
				continue
			}
			row, col := row1-1, col1-1
			if row < area.StartRow || row > area.EndRow || col < area.StartColumn || col > area.EndColumn {
				continue
			}
			ok, target, err := f.GetCellHyperLink(sheet, ref)
			if err != nil || !ok || target == "" {
				continue
			}
			out = append(out, Hyperlink{Row: row, Column: col, Target: kind.prefix + target})
		}
	}
	return out
}

func validationsInArea(f *excelize.File, sheet string, area CellArea) []DataValidation {
	validations, err := f.GetDataValidations(sheet)
	if err != nil {
		return []DataValidation{}
	}
	out := make([]DataValidation, 0, len(validations))
	for _, dv := range validations {
		if dv == nil {
			continue
		}
		ranges := make([]CellArea, 0, 2)
		for _, ref := range strings.Fields(dv.Sqref) {
			a, err := parseArea(ref)
			if err != nil || !containsArea(area, a) {
				continue
			}
			ranges = append(ranges, a)
		}
		if len(ranges) == 0 {
			continue
		}
		out = append(out, DataValidation{
			Ranges:           ranges,
			RuleType:         dv.Type,
			Operator:         dv.Operator,
			Formulas:         []string{dv.Formula1, dv.Formula2},
			AllowBlank:       dv.AllowBlank,
			SuppressDropdown: dv.ShowDropDown,
			ShowInputMessage: dv.ShowInputMessage,
			ShowErrorMessage: dv.ShowErrorMessage,
			ErrorStyle:       derefString(dv.ErrorStyle),
			ErrorTitle:       derefString(dv.ErrorTitle),
			Error:            derefString(dv.Error),
			PromptTitle:      derefString(dv.PromptTitle),
			Prompt:           derefString(dv.Prompt),
		})
	}
	return out
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// scanSheet walks the used bounding box of a sheet, invoking fn for each
// non-empty cell until it returns false.
func scanSheet(f *excelize.File, sheet string, fn func(row, col int, value any, formula string) bool) {
	rows, cols := sheetDimensions(f, sheet)
	if rows*cols > scanLimit {
		rows = scanLimit / maxInt(cols, 1)
	}
	for row := 0; row < rows; row++ {
		for col := 0; col < cols; col++ {
			ref := cellRef(row, col)
			value := cellValue(f, sheet, ref)
			formula := cellFormula(f, sheet, ref)
			if value == nil && formula == "" {
				continue
			}
			if !fn(row, col, value, formula) {
				return
			}
		}
	}
}

// ReadFormulas returns every formula cell of a sheet.
func (e *Engine) ReadFormulas(sessionID, sheet string) (*FormulaCellsResult, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	result := &FormulaCellsResult{Cells: []CellRecord{}, SharedGroups: []any{}, IndexingComplete: true}
	scanSheet(s.file, sheet, func(row, col int, value any, formula string) bool {
		if formula == "" {
			return true
		}
		var styleID int
		if id, serr := s.file.GetCellStyle(sheet, cellRef(row, col)); serr == nil && id > 0 {
			styleID = id
		}
		rec := CellRecord{Row: row, Column: col, Value: value, Formula: formula}
		if styleID > 0 {
			id := styleID
			rec.StyleIndex = &id
		}
		result.Cells = append(result.Cells, rec)
		return true
	})
	return result, nil
}

// FindCells runs an Excel-style find across the requested sheets and pages
// the hits through resumeAt/limit.
func (e *Engine) FindCells(req FindRequest) (*FindCellsResult, error) {
	s, err := e.acquire(req.SessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	result := &FindCellsResult{Matches: []FindCellMatch{}, IndexingComplete: true}
	limit := req.Limit
	if limit <= 0 || limit > 100_000 {
		limit = 100_000
	}
	sheets := []string{req.SheetID}
	if req.SheetID == "" {
		sheets = s.file.GetSheetList()
	}
	needle := req.Query
	if !req.MatchCase {
		needle = strings.ToLower(needle)
	}
	afterCursor := func(sheet string, row, col int) bool {
		if req.ResumeAt == nil || req.ResumeAt.SheetID != sheet {
			return true
		}
		if row < req.ResumeAt.Row {
			return false
		}
		return row > req.ResumeAt.Row || col >= req.ResumeAt.Column
	}
	for _, sheet := range sheets {
		if _, err := s.file.GetSheetIndex(sheet); err != nil {
			continue
		}
		stop := false
		scanSheet(s.file, sheet, func(row, col int, value any, formula string) bool {
			if !afterCursor(sheet, row, col) {
				return true
			}
			text := renderText(value)
			if req.LookIn == "formulas" || req.LookIn == "formulas_only" {
				text = formula
			}
			if req.LookIn == "both" && formula != "" {
				text = formula + "\x00" + text
			}
			if !req.MatchCase {
				text = strings.ToLower(text)
			}
			if !matchNeedle(text, needle, req.MatchEntireCell, req.Wildcards) {
				return true
			}
			valueText := renderText(value)
			formulaText := formula
			result.Matches = append(result.Matches, FindCellMatch{
				SheetID:     sheet,
				Row:         row,
				Column:      col,
				Value:       value,
				ValueText:   &valueText,
				FormulaText: formulaText,
			})
			if len(result.Matches) >= limit {
				result.Complete = false
				result.NextCursor = &FindCursor{SheetID: sheet, Row: row, Column: col + 1}
				stop = true
				return false
			}
			return true
		})
		if stop {
			return result, nil
		}
	}
	result.Complete = true
	return result, nil
}

// matchNeedle applies Excel-style wildcards (* and ?) or a literal contains
// test, honouring whole-cell matching.
func matchNeedle(text, needle string, entireCell, wildcards bool) bool {
	if needle == "" {
		return false
	}
	if wildcards {
		pattern := "^"
		for _, r := range needle {
			switch r {
			case '*':
				pattern += ".*"
			case '?':
				pattern += "."
			default:
				pattern += regexp.QuoteMeta(string(r))
			}
		}
		if entireCell {
			pattern += "$"
		}
		matched, err := regexp.MatchString(pattern, text)
		if err == nil {
			return matched
		}
	}
	if entireCell {
		return text == needle
	}
	return strings.Contains(text, needle)
}

func renderText(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

// ReadRowOutline returns outlined or hidden rows of a sheet.
func (e *Engine) ReadRowOutline(sessionID, sheet string) (*RowOutlineResult, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	rows, _ := sheetDimensions(s.file, sheet)
	result := &RowOutlineResult{Rows: []RowOutlineRow{}, IndexingComplete: true}
	for row := 0; row < rows; row++ {
		level, lerr := s.file.GetRowOutlineLevel(sheet, row+1)
		visible, _ := s.file.GetRowVisible(sheet, row+1)
		if (lerr == nil && level > 0) || !visible {
			lvl := 0
			if lerr == nil {
				lvl = int(level)
			}
			result.Rows = append(result.Rows, RowOutlineRow{Row: row, Level: lvl, Hidden: !visible})
		}
	}
	return result, nil
}

// Recalc applies the renderer's pending inputs to a throw-away copy of the
// workbook, then evaluates the formula cells inside the requested ranges with
// excelize's calculator. Unsupported functions are returned as error cells
// instead of failing the whole request.
func (e *Engine) Recalc(req RecalcRequest) (*RecalcResult, error) {
	s, err := e.acquire(req.SessionID)
	if err != nil {
		return nil, err
	}
	result := &RecalcResult{Cells: []RecalcCell{}}
	if len(req.Reads) == 0 {
		s.mu.Unlock()
		return result, nil
	}
	// Only the snapshot touches the shared file; the clone below is
	// goroutine-local, so the lock is released before the expensive
	// evaluation to keep readers unblocked.
	buf, err := func() (*bytes.Buffer, error) {
		defer s.mu.Unlock()
		return s.file.WriteToBuffer()
	}()
	if err != nil {
		return nil, fmt.Errorf("clone workbook: %w", err)
	}
	clone, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, fmt.Errorf("clone workbook: %w", err)
	}
	defer clone.Close()
	for _, edit := range req.Edits {
		ref := cellRef(edit.Row, edit.Column)
		if strings.HasPrefix(edit.Input, "=") {
			if err := clone.SetCellFormula(edit.SheetID, ref, strings.TrimPrefix(edit.Input, "=")); err != nil {
				continue
			}
			continue
		}
		if err := clone.SetCellStr(edit.SheetID, ref, edit.Input); err != nil {
			continue
		}
	}
	for _, read := range req.Reads {
		if _, serr := clone.GetSheetIndex(read.SheetID); serr != nil {
			continue
		}
		if read.Range.EndRow-read.Range.StartRow > scanLimit || read.Range.EndColumn-read.Range.StartColumn > scanLimit {
			continue
		}
		for row := read.Range.StartRow; row <= read.Range.EndRow; row++ {
			for col := read.Range.StartColumn; col <= read.Range.EndColumn; col++ {
				ref := cellRef(row, col)
				if cellFormula(clone, read.SheetID, ref) == "" {
					continue
				}
				cell := RecalcCell{SheetID: read.SheetID, Row: row, Column: col, IsFormula: true}
				value, cerr := clone.CalcCellValue(read.SheetID, ref)
				if cerr != nil {
					cell.Formatted = cerr.Error()
					cell.IsError = true
				} else {
					cell.Formatted = value
					if num, ok := parseNumber(value); ok {
						cell.Number = &num
					}
				}
				result.Cells = append(result.Cells, cell)
			}
		}
	}
	return result, nil
}

func parseNumber(text string) (float64, bool) {
	var num float64
	if _, err := fmt.Sscanf(strings.TrimSpace(text), "%g", &num); err != nil {
		return 0, false
	}
	return num, true
}

// mediaItems lists the pictures embedded in the workbook.
// The caller must hold s.mu.
func (e *Engine) mediaItems(s *session) []MediaItem {
	items := []MediaItem{}
	for _, sheet := range s.file.GetSheetList() {
		cells, cerr := s.file.GetPictureCells(sheet)
		if cerr != nil {
			continue
		}
		for _, ref := range cells {
			pics, perr := s.file.GetPictures(sheet, ref)
			if perr != nil {
				continue
			}
			anchorCol, anchorRow, cerr := excelize.CellNameToCoordinates(ref)
			if cerr != nil {
				continue
			}
			for i, pic := range pics {
				if len(pic.File) == 0 {
					continue
				}
				items = append(items, MediaItem{
					ID:        fmt.Sprintf("%s!%d", sheet, len(items)+i),
					MediaType: "image/" + strings.TrimPrefix(strings.ToLower(pic.Extension), "."),
					Base64:    base64.StdEncoding.EncodeToString(pic.File),
					Row:       anchorRow - 1,
					Column:    anchorCol - 1,
				})
			}
		}
	}
	return items
}

// ReadMedia resolves one media id (from the FileInfo visuals or a picture
// anchor) to its base64 payload.
func (e *Engine) ReadMedia(sessionID, visualID string) (*MediaResult, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	for _, item := range e.mediaItems(s) {
		if item.ID == visualID {
			return &MediaResult{MediaType: item.MediaType, Base64: item.Base64}, nil
		}
	}
	return nil, fmt.Errorf("unknown media %q", visualID)
}

// Save applies a patch request and writes it back to disk.
func (e *Engine) Save(req SaveRequest) (*SaveResult, error) {
	s, err := e.acquire(req.SessionID)
	if err != nil {
		return nil, err
	}
	// The whole edit→SaveAs→reload sequence must be atomic: readers must
	// never observe a half-patched file, and reload swaps s.file beneath
	// them. reloadLocked runs under this same lock, so no re-entry occurs.
	defer s.mu.Unlock()
	if s.info.ReadOnly && req.TargetPath == "" {
		return nil, fmt.Errorf("workbook is read-only: %s", s.info.Path)
	}
	for _, op := range req.StructuralOps {
		if err := applyStructuralOp(s.file, op); err != nil {
			return nil, err
		}
	}
	for _, edit := range req.Edits {
		if err := applyCellEdit(s.file, edit); err != nil {
			return nil, err
		}
	}
	for _, fill := range req.BulkConstantFills {
		if !fillValue(s.file, fill) {
			continue
		}
	}
	// Hyperlinks attach to cells, so they run after the value/fill writes:
	// a link set before its cell value would otherwise survive an edit that
	// replaces the cell.
	for _, link := range req.HyperlinkEdits {
		if err := applyHyperlinkEdit(s.file, link); err != nil {
			return nil, err
		}
	}
	target := s.info.Path
	if req.TargetPath != "" {
		target = req.TargetPath
	}
	if err := s.file.SaveAs(target); err != nil {
		return nil, fmt.Errorf("save workbook: %w", err)
	}
	info, err := e.reloadLocked(s, target)
	if err != nil {
		return nil, err
	}
	return &SaveResult{Canceled: false, File: info, TouchedEntries: []string{}}, nil
}

// reloadLocked refreshes the session metadata after the file changed on
// disk. The caller must hold s.mu: it closes the old excelize file and
// swaps in a fresh parse, which readers must never observe half-done.
func (e *Engine) reloadLocked(s *session, path string) (*FileInfo, error) {
	// Stream the hash (see Engine.Open) so the reload does not hold a
	// second full copy of the workbook alongside excelize's parse.
	sum, size, err := hashFile(path)
	if err != nil {
		return nil, fmt.Errorf("reload workbook: %w", err)
	}
	// Open the replacement before closing the current one: a failed parse
	// must leave the session with its existing, still-usable workbook rather
	// than a closed handle. An encrypted session must re-supply the key, or
	// the freshly written (still encrypted) file reads as "not a zip".
	var f *excelize.File
	if s.encrypted {
		f, err = excelize.OpenFile(path, excelize.Options{Password: s.password})
	} else {
		f, err = excelize.OpenFile(path)
	}
	if err != nil {
		return nil, fmt.Errorf("reload workbook: %w", err)
	}
	info := FileInfo{
		SessionID:    s.info.SessionID,
		Name:         filepath.Base(path),
		Path:         path,
		SHA256:       hex.EncodeToString(sum[:]),
		FileBytes:    size,
		EntryCount:   countZipEntries(path),
		ReadOnly:     isReadOnly(path),
		Sheets:       sheetMetadata(f),
		ActiveTab:    clampActiveTab(f.GetActiveSheetIndex(), len(f.GetSheetList())),
		Styles:       styleTable(f),
		DxfStyles:    []CellStyle{},
		Visuals:      []any{},
		DefinedNames: definedNames(f),
	}
	old := s.file
	s.file = f
	s.info = info
	if old != nil {
		_ = old.Close()
	}
	return &info, nil
}

func applyCellEdit(f *excelize.File, edit CellEdit) error {
	if _, err := f.GetSheetIndex(edit.SheetID); err != nil {
		return fmt.Errorf("unknown sheet %q", edit.SheetID)
	}
	ref := cellRef(edit.Row, edit.Column)
	if edit.StyleReset {
		if err := f.SetCellStyle(edit.SheetID, ref, ref, 0); err != nil {
			return fmt.Errorf("reset style %s: %w", ref, err)
		}
	}
	if !edit.WriteValue {
		return nil
	}
	if edit.Formula != "" {
		formula := strings.TrimPrefix(edit.Formula, "=")
		if err := f.SetCellFormula(edit.SheetID, ref, formula); err != nil {
			return fmt.Errorf("set formula %s: %w", ref, err)
		}
		return nil
	}
	switch v := edit.Value.(type) {
	case nil:
		if err := f.SetCellValue(edit.SheetID, ref, nil); err != nil {
			return fmt.Errorf("clear cell %s: %w", ref, err)
		}
	case float64:
		if err := f.SetCellFloat(edit.SheetID, ref, v, -1, 64); err != nil {
			return fmt.Errorf("set cell %s: %w", ref, err)
		}
	case bool:
		if err := f.SetCellBool(edit.SheetID, ref, v); err != nil {
			return fmt.Errorf("set cell %s: %w", ref, err)
		}
	default:
		if err := f.SetCellStr(edit.SheetID, ref, fmt.Sprint(v)); err != nil {
			return fmt.Errorf("set cell %s: %w", ref, err)
		}
	}
	return nil
}

func applyStructuralOp(f *excelize.File, op StructuralOp) error {
	if _, err := f.GetSheetIndex(op.SheetID); err != nil {
		return fmt.Errorf("unknown sheet %q", op.SheetID)
	}
	switch op.Kind {
	case "insert-rows":
		return f.InsertRows(op.SheetID, op.Index+1, op.Count)
	case "remove-rows":
		for i := 0; i < maxInt(op.Count, 1); i++ {
			if err := f.RemoveRow(op.SheetID, op.Index+1); err != nil {
				return err
			}
		}
		return nil
	case "insert-cols":
		return f.InsertCols(op.SheetID, columnName(op.Index+1), op.Count)
	case "remove-cols":
		for i := 0; i < maxInt(op.Count, 1); i++ {
			if err := f.RemoveCol(op.SheetID, columnName(op.Index+1)); err != nil {
				return err
			}
		}
		return nil
	case "merge-cells":
		return f.MergeCell(op.SheetID, areaStartRef(op.Range), areaEndRef(op.Range))
	case "unmerge-cells":
		return f.UnmergeCell(op.SheetID, areaStartRef(op.Range), areaEndRef(op.Range))
	case "set-row-size":
		if op.Size != nil {
			for row := op.Start; row <= op.End; row++ {
				if err := f.SetRowHeight(op.SheetID, row+1, *op.Size); err != nil {
					return err
				}
			}
		}
		return nil
	case "set-col-size":
		if op.Size != nil {
			return f.SetColWidth(op.SheetID, columnName(op.Start+1), columnName(op.End+1), *op.Size)
		}
		return nil
	case "set-rows-hidden":
		for row := op.Start; row <= op.End; row++ {
			if err := f.SetRowVisible(op.SheetID, row+1, !op.Hidden); err != nil {
				return err
			}
		}
		return nil
	case "set-cols-hidden":
		for col := op.Start; col <= op.End; col++ {
			if err := f.SetColVisible(op.SheetID, columnName(col+1), !op.Hidden); err != nil {
				return err
			}
		}
		return nil
	default:
		// Unsupported ops (move-rows, set-col-style, ...) are ignored on save
		// rather than failing the whole write.
		return nil
	}
}

func areaStartRef(area CellArea) string {
	return cellRef(area.StartRow, area.StartColumn)
}

func areaEndRef(area CellArea) string {
	return cellRef(area.EndRow, area.EndColumn)
}

func fillValue(f *excelize.File, fill BulkFill) bool {
	if _, err := f.GetSheetIndex(fill.SheetID); err != nil {
		return false
	}
	for row := fill.StartRow; row <= fill.EndRow; row++ {
		for col := fill.StartColumn; col <= fill.EndColumn; col++ {
			ref := cellRef(row, col)
			switch v := fill.Value.(type) {
			case nil:
				f.SetCellStr(fill.SheetID, ref, "")
			case float64:
				f.SetCellFloat(fill.SheetID, ref, v, -1, 64)
			case bool:
				f.SetCellBool(fill.SheetID, ref, v)
			default:
				f.SetCellStr(fill.SheetID, ref, fmt.Sprint(v))
			}
		}
	}
	return true
}
