// Package workbook implements a pure-Go spreadsheet engine for the Sheets
// editor. It replaces the former Rust xlsx sidecar and covers the read/write
// subset of the renderer contract that excelize can back. Features excelize
// cannot express (charts, shapes, pivot definitions, threaded comments) are
// reported as empty lists so the renderer degrades gracefully instead of
// failing the whole open.
package workbook

// CellArea is a 0-based inclusive rectangle in file coordinates.
type CellArea struct {
	StartRow    int `json:"startRow"`
	StartColumn int `json:"startColumn"`
	EndRow      int `json:"endRow"`
	EndColumn   int `json:"endColumn"`
}

// CellRecord is one stored cell inside a read range.
type CellRecord struct {
	Row        int    `json:"row"`
	Column     int    `json:"column"`
	Value      any    `json:"value"`
	Formula    string `json:"formula,omitempty"`
	StyleIndex *int   `json:"styleIndex,omitempty"`
}

// RowRecord carries row-level layout metadata inside a read range.
type RowRecord struct {
	Row          int      `json:"row"`
	Height       *float64 `json:"height,omitempty"`
	CustomHeight bool     `json:"customHeight,omitempty"`
	Hidden       bool     `json:"hidden"`
	OutlineLevel int      `json:"outlineLevel,omitempty"`
	Collapsed    bool     `json:"collapsed,omitempty"`
	StyleIndex   *int     `json:"styleIndex,omitempty"`
}

// Hyperlink is a cell link target stored in the worksheet.
type Hyperlink struct {
	Row    int    `json:"row"`
	Column int    `json:"column"`
	Target string `json:"target"`
}

// DataValidation mirrors one <dataValidation> element.
type DataValidation struct {
	Ranges           []CellArea `json:"ranges"`
	RuleType         string     `json:"ruleType"`
	Operator         string     `json:"operator,omitempty"`
	Formulas         []string   `json:"formulas"`
	AllowBlank       bool       `json:"allowBlank"`
	SuppressDropdown bool       `json:"suppressDropdown"`
	ShowInputMessage bool       `json:"showInputMessage"`
	ShowErrorMessage bool       `json:"showErrorMessage"`
	ErrorStyle       string     `json:"errorStyle,omitempty"`
	ErrorTitle       string     `json:"errorTitle,omitempty"`
	Error            string     `json:"error,omitempty"`
	PromptTitle      string     `json:"promptTitle,omitempty"`
	Prompt           string     `json:"prompt,omitempty"`
}

// SheetProtection mirrors <sheetProtection>.
type SheetProtection struct {
	Protected   bool `json:"protected"`
	HasPassword bool `json:"hasPassword"`
}

// PageMargins is the print margin block in inches.
type PageMargins struct {
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
	Header float64 `json:"header"`
	Footer float64 `json:"footer"`
}

// PageSetup carries saved print settings.
type PageSetup struct {
	Orientation    string       `json:"orientation,omitempty"`
	PaperSize      int          `json:"paperSize,omitempty"`
	Scale          int          `json:"scale,omitempty"`
	FitToWidth     int          `json:"fitToWidth,omitempty"`
	FitToHeight    int          `json:"fitToHeight,omitempty"`
	FitToPage      bool         `json:"fitToPage,omitempty"`
	Margins        *PageMargins `json:"margins,omitempty"`
	PrintGridlines bool         `json:"printGridlines,omitempty"`
	PrintHeadings  bool         `json:"printHeadings,omitempty"`
	OddHeader      string       `json:"oddHeader,omitempty"`
	OddFooter      string       `json:"oddFooter,omitempty"`
}

// ProtectedRange mirrors one <protectedRange> entry.
type ProtectedRange struct {
	Name        string `json:"name"`
	Sqref       string `json:"sqref"`
	HasPassword bool   `json:"hasPassword"`
}

// RangeResult is the response for a range read.
type RangeResult struct {
	Cells             []CellRecord     `json:"cells"`
	Rows              []RowRecord      `json:"rows"`
	Merges            []CellArea       `json:"merges"`
	Hyperlinks        []Hyperlink      `json:"hyperlinks"`
	ConditionalRules  []any            `json:"conditionalRules"`
	AutoFilter        *CellArea        `json:"autoFilter"`
	AutoFilterColumns []any            `json:"autoFilterColumns"`
	DataValidations   []DataValidation `json:"dataValidations"`
	SheetProtection   *SheetProtection `json:"sheetProtection"`
	RowBreaks         []int            `json:"rowBreaks"`
	ColBreaks         []int            `json:"colBreaks"`
	PageSetup         *PageSetup       `json:"pageSetup"`
	ProtectedRanges   []ProtectedRange `json:"protectedRanges"`
	IndexedThroughRow *int             `json:"indexedThroughRow"`
	IndexingComplete  bool             `json:"indexingComplete"`
}

// ColumnWidth is a column span with layout attributes.
type ColumnWidth struct {
	StartColumn  int      `json:"startColumn"`
	EndColumn    int      `json:"endColumn"`
	Width        *float64 `json:"width,omitempty"`
	Hidden       bool     `json:"hidden"`
	OutlineLevel int      `json:"outlineLevel,omitempty"`
	Collapsed    bool     `json:"collapsed,omitempty"`
	StyleIndex   *int     `json:"styleIndex,omitempty"`
}

// Freeze records frozen panes.
type Freeze struct {
	FrozenColumns int `json:"frozenColumns"`
	FrozenRows    int `json:"frozenRows"`
}

// SheetTable is a table (ListObject) area of a sheet.
type SheetTable struct {
	Range             CellArea `json:"range"`
	HeaderRowCount    int      `json:"headerRowCount"`
	ShowRowStripes    bool     `json:"showRowStripes"`
	ShowColumnStripes bool     `json:"showColumnStripes"`
	Name              string   `json:"name,omitempty"`
	Columns           []string `json:"columns,omitempty"`
	StyleName         string   `json:"styleName,omitempty"`
}

// Comment is one legacy cell note.
type Comment struct {
	Row    int    `json:"row"`
	Column int    `json:"column"`
	Author string `json:"author"`
	Text   string `json:"text"`
}

// SheetMeta describes a worksheet to the renderer.
type SheetMeta struct {
	ID                 string        `json:"id"`
	Name               string        `json:"name"`
	RowCount           int           `json:"rowCount"`
	ColumnCount        int           `json:"columnCount"`
	ColumnWidths       []ColumnWidth `json:"columnWidths"`
	DefaultRowHeight   *float64      `json:"defaultRowHeight"`
	DefaultColumnWidth *float64      `json:"defaultColumnWidth"`
	Freeze             *Freeze       `json:"freeze"`
	Hidden             bool          `json:"hidden"`
	VeryHidden         bool          `json:"veryHidden,omitempty"`
	TabColor           *string       `json:"tabColor"`
	ShowGridLines      bool          `json:"showGridLines"`
	ShowFormulas       *bool         `json:"showFormulas,omitempty"`
	ShowRowColHeaders  *bool         `json:"showRowColHeaders,omitempty"`
	RightToLeft        bool          `json:"rightToLeft,omitempty"`
	ZoomScale          int           `json:"zoomScale,omitempty"`
	Tables             []SheetTable  `json:"tables"`
	Comments           []Comment     `json:"comments"`
	PivotRanges        []CellArea    `json:"pivotRanges"`
	PivotTables        []any         `json:"pivotTables"`
	Sparklines         []any         `json:"sparklines"`
	CellImages         []any         `json:"cellImages"`
	PrintArea          string        `json:"printArea,omitempty"`
	PrintTitles        string        `json:"printTitles,omitempty"`
	OutlineLevelRow    int           `json:"outlineLevelRow,omitempty"`
	OutlineLevelCol    int           `json:"outlineLevelCol,omitempty"`
}

// BorderEdge is one drawn border side.
type BorderEdge struct {
	Style string `json:"style"`
	Color string `json:"color,omitempty"`
}

// CellStyle is a cell xf translated for the renderer.
type CellStyle struct {
	FontFamily          string      `json:"fontFamily,omitempty"`
	FontSize            *float64    `json:"fontSize,omitempty"`
	Bold                bool        `json:"bold"`
	Italic              bool        `json:"italic"`
	Underline           bool        `json:"underline"`
	Strikethrough       bool        `json:"strikethrough"`
	WrapText            bool        `json:"wrapText"`
	ShrinkToFit         bool        `json:"shrinkToFit,omitempty"`
	FontColor           string      `json:"fontColor,omitempty"`
	FillColor           string      `json:"fillColor,omitempty"`
	HorizontalAlignment string      `json:"horizontalAlignment,omitempty"`
	VerticalAlignment   string      `json:"verticalAlignment,omitempty"`
	Indent              int         `json:"indent,omitempty"`
	TextRotation        int         `json:"textRotation,omitempty"`
	NumberFormat        string      `json:"numberFormat,omitempty"`
	BorderTop           *BorderEdge `json:"borderTop,omitempty"`
	BorderBottom        *BorderEdge `json:"borderBottom,omitempty"`
	BorderLeft          *BorderEdge `json:"borderLeft,omitempty"`
	BorderRight         *BorderEdge `json:"borderRight,omitempty"`
	BorderDiagonal      *BorderEdge `json:"borderDiagonal,omitempty"`
	DiagonalUp          bool        `json:"diagonalUp"`
	DiagonalDown        bool        `json:"diagonalDown"`
}

// DefinedName is one workbook-level (or sheet-scoped) name.
type DefinedName struct {
	Name       string `json:"name"`
	Formula    string `json:"formula"`
	SheetIndex *int   `json:"sheetIndex,omitempty"`
}

// FileInfo is the workbook metadata returned on open and after a save.
type FileInfo struct {
	SessionID      string        `json:"sessionId"`
	Name           string        `json:"name"`
	Path           string        `json:"path,omitempty"`
	SHA256         string        `json:"sha256"`
	FileBytes      int64         `json:"fileBytes,omitempty"`
	EntryCount     int           `json:"entryCount"`
	Sheets         []SheetMeta   `json:"sheets"`
	ActiveTab      int           `json:"activeTab"`
	Styles         []CellStyle   `json:"styles"`
	DxfStyles      []CellStyle   `json:"dxfStyles"`
	Visuals        []any         `json:"visuals"`
	DefinedNames   []DefinedName `json:"definedNames"`
	ReadOnly       bool          `json:"readOnly"`
	ThemeColors    []string      `json:"themeColors,omitempty"`
	NormalFontName string        `json:"normalFontName,omitempty"`
	Date1904       bool          `json:"date1904,omitempty"`
}

// FormulaCellsResult is the response for a formula read.
type FormulaCellsResult struct {
	Cells            []CellRecord `json:"cells"`
	SharedGroups     []any        `json:"sharedGroups"`
	IndexingComplete bool         `json:"indexingComplete"`
	Truncated        bool         `json:"truncated"`
}

// FindCellMatch is one find hit.
type FindCellMatch struct {
	SheetID     string  `json:"sheetId"`
	Row         int     `json:"row"`
	Column      int     `json:"column"`
	Value       any     `json:"value"`
	ValueText   *string `json:"valueText"`
	FormulaText string  `json:"formulaText,omitempty"`
}

// FindCursor is the resume position of a paged find.
type FindCursor struct {
	SheetID string `json:"sheetId"`
	Row     int    `json:"row"`
	Column  int    `json:"column"`
}

// FindRequest is the renderer's find query.
type FindRequest struct {
	SessionID       string      `json:"sessionId"`
	SheetID         string      `json:"sheetId,omitempty"`
	Query           string      `json:"query"`
	MatchCase       bool        `json:"matchCase"`
	MatchEntireCell bool        `json:"matchEntireCell"`
	LookIn          string      `json:"lookIn"`
	Wildcards       bool        `json:"wildcards"`
	ResumeAt        *FindCursor `json:"resumeAt,omitempty"`
	Limit           int         `json:"limit"`
}

// RecalcEdit is one pending input the renderer wants applied before recalc.
type RecalcEdit struct {
	SheetID string `json:"sheetId"`
	Row     int    `json:"row"`
	Column  int    `json:"column"`
	Input   string `json:"input"`
}

// RecalcRead is one range the renderer wants re-evaluated.
type RecalcRead struct {
	SheetID string   `json:"sheetId"`
	Range   CellArea `json:"range"`
}

// RecalcRequest is the renderer's recalc query.
type RecalcRequest struct {
	SessionID string       `json:"sessionId"`
	Edits     []RecalcEdit `json:"edits"`
	Reads     []RecalcRead `json:"reads"`
}

// FindCellsResult is the response for a find query.
type FindCellsResult struct {
	Matches          []FindCellMatch `json:"matches"`
	Complete         bool            `json:"complete"`
	NextCursor       *FindCursor     `json:"nextCursor,omitempty"`
	IndexingComplete bool            `json:"indexingComplete"`
}

// RowOutlineRow is one outlined row.
type RowOutlineRow struct {
	Row       int  `json:"row"`
	Level     int  `json:"level"`
	Collapsed bool `json:"collapsed,omitempty"`
	Hidden    bool `json:"hidden,omitempty"`
}

// RowOutlineResult is the response for a row outline read.
type RowOutlineResult struct {
	Rows             []RowOutlineRow `json:"rows"`
	IndexingComplete bool            `json:"indexingComplete"`
}

// RecalcCell is one evaluated cell value.
type RecalcCell struct {
	SheetID   string   `json:"sheetId"`
	Row       int      `json:"row"`
	Column    int      `json:"column"`
	Formatted string   `json:"formatted"`
	Number    *float64 `json:"number,omitempty"`
	IsError   bool     `json:"isError,omitempty"`
	IsFormula bool     `json:"isFormula"`
}

// RecalcResult carries recalculated formula values.
type RecalcResult struct {
	Cells []RecalcCell `json:"cells"`
}

// MediaResult is one embedded picture payload.
type MediaResult struct {
	MediaType string `json:"mediaType"`
	Base64    string `json:"base64"`
}

// MediaItem is an embedded picture with its anchor (engine-internal).
type MediaItem struct {
	ID        string
	MediaType string
	Base64    string
	Row       int
	Column    int
}

// CellEdit is one cell write from a save request.
type CellEdit struct {
	SheetID    string `json:"sheetId"`
	Row        int    `json:"row"`
	Column     int    `json:"column"`
	WriteValue bool   `json:"writeValue"`
	Value      any    `json:"value"`
	Formula    string `json:"formula,omitempty"`
	Style      any    `json:"style,omitempty"`
	Rich       any    `json:"rich,omitempty"`
	StyleReset bool   `json:"styleReset,omitempty"`
}

// StructuralOp is one row/column/merge mutation from a save request.
type StructuralOp struct {
	SheetID string   `json:"sheetId"`
	Kind    string   `json:"kind"`
	Index   int      `json:"index"`
	Count   int      `json:"count"`
	Before  int      `json:"before"`
	Range   CellArea `json:"range"`
	Start   int      `json:"start"`
	End     int      `json:"end"`
	Size    *float64 `json:"size"`
	Hidden  bool     `json:"hidden"`
	Style   any      `json:"style"`
}

// BulkFill paints one constant over a rectangle.
type BulkFill struct {
	SheetID     string `json:"sheetId"`
	StartRow    int    `json:"startRow"`
	EndRow      int    `json:"endRow"`
	StartColumn int    `json:"startColumn"`
	EndColumn   int    `json:"endColumn"`
	Value       any    `json:"value"`
}

// SaveRequest is the payload of a save call.
type SaveRequest struct {
	SessionID         string         `json:"sessionId"`
	Mode              string         `json:"mode"`
	TargetPath        string         `json:"targetPath,omitempty"`
	Overwrite         bool           `json:"overwrite,omitempty"`
	RestoreWriteBack  bool           `json:"restoreWriteBack,omitempty"`
	Quiet             bool           `json:"quiet,omitempty"`
	CSVContent        string         `json:"csvContent,omitempty"`
	Edits             []CellEdit     `json:"edits"`
	BulkConstantFills []BulkFill     `json:"bulkConstantFills,omitempty"`
	StructuralOps     []StructuralOp `json:"structuralOps"`
}

// SaveResult mirrors the renderer's save envelope.
type SaveResult struct {
	Canceled       bool      `json:"canceled"`
	CSVSaveAsPath  string    `json:"csvSaveAsPath,omitempty"`
	File           *FileInfo `json:"file,omitempty"`
	TouchedEntries []string  `json:"touchedEntries"`
}
