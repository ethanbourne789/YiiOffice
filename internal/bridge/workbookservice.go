package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"gitee.com/ethanbourne789/yiioffice/internal/workbook"
)

// WorkbookService exposes the Sheets/Workbook editor operations as an official
// Wails V3 binding service. All workbook parsing and writing runs in-process
// through internal/workbook (excelize); there is no external sidecar.
type WorkbookService struct {
	eng *workbook.Engine
	rm  *host.RecentManager
}

// NewWorkbookService returns a WorkbookService. rm may be nil.
func NewWorkbookService(eng *workbook.Engine, rm *host.RecentManager) *WorkbookService {
	if eng == nil {
		eng = workbook.NewEngine()
	}
	return &WorkbookService{eng: eng, rm: rm}
}

// WorkbookSheetRequest is the payload for read-formulas / read-row-outline.
type WorkbookSheetRequest struct {
	SessionID string `json:"sessionId"`
	SheetID   string `json:"sheetId"`
}

// WorkbookRangeReadRequest is the payload for read-range.
type WorkbookRangeReadRequest struct {
	SessionID string            `json:"sessionId"`
	SheetID   string            `json:"sheetId"`
	Range     workbook.CellArea `json:"range"`
}

// WorkbookMediaRequest is the payload for read-media.
type WorkbookMediaRequest struct {
	SessionID string `json:"sessionId"`
	VisualID  string `json:"visualId"`
}

// WorkbookPivotRequest is the payload for read-pivot-definition.
type WorkbookPivotRequest struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
	CachePath string `json:"cachePath"`
}

// WorkbookExportPdfRequest carries the args for export-pdf.
type WorkbookExportPdfRequest struct {
	FileName  string `json:"fileName"`
	HTML      string `json:"html"`
	Landscape bool   `json:"landscape"`
}

// WorkbookCreateDocumentRequest carries the args for create-document.
type WorkbookCreateDocumentRequest struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	SheetName string `json:"sheetName"`
}

// CreateDocumentResult is returned by CreateDocument.
type CreateDocumentResult struct {
	OK    bool   `json:"ok"`
	Path  string `json:"path,omitempty"`
	Error string `json:"error,omitempty"`
}

// PrinterInfo describes a system printer.
type PrinterInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

// --- Workbook sessions ---

// OpenFile opens a workbook at path and returns its metadata. The path must be
// granted (a dialog pick or the Home open funnel) or resolve inside the
// authorised roots; the grant also covers the later Save back over it.
func (s *WorkbookService) OpenFile(path string) (*workbook.FileInfo, error) {
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	if err != nil {
		return nil, codedError(ErrOpenPathNotAuthorised, err)
	}
	info, err := s.eng.Open(authorised)
	if err != nil {
		return nil, codedError(ErrOpenReadFailed, err)
	}
	if s.rm != nil {
		s.rm.AddRecent(authorised)
	}
	return info, nil
}

// OpenFileWithPassword opens an encrypted workbook with the password the user
// typed. The path comes from a previous password-required open, which already
// passed the same grant check, so the retry is authorised by construction.
func (s *WorkbookService) OpenFileWithPassword(path, password string) (*workbook.FileInfo, error) {
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	if err != nil {
		return nil, codedError(ErrOpenPathNotAuthorised, err)
	}
	info, err := s.eng.OpenWithPassword(authorised, password)
	if err != nil {
		return nil, codedError(ErrOpenReadFailed, err)
	}
	if s.rm != nil {
		s.rm.AddRecent(authorised)
	}
	return info, nil
}

// SelectWorkbook opens a native picker and opens the chosen workbook. A
// canceled picker returns (nil, nil).
func (s *WorkbookService) SelectWorkbook() (*workbook.FileInfo, error) {
	app := platform.App()
	if app == nil {
		return nil, fmt.Errorf("%s", ErrAppUnavailable)
	}
	path, err := app.Dialog.OpenFile().
		SetTitle("Open Workbook").
		AddFilter("Excel Workbook", "*.xlsx;*.xlsm;*.xltx;*.csv").
		PromptForSingleSelection()
	if err != nil {
		return nil, codedError(ErrOpenDialogFailed, err)
	}
	if path == "" {
		return nil, nil
	}
	return s.OpenFile(path)
}

// ReopenWorkbook adopts a known path through the same open path as
// SelectWorkbook (used after a failed session).
func (s *WorkbookService) ReopenWorkbook(path string) (*workbook.FileInfo, error) {
	return s.OpenFile(path)
}

// Close drops the workbook session.
func (s *WorkbookService) Close(sessionID string) error {
	return s.eng.Close(sessionID)
}

// --- Reads ---

// ReadRange returns stored cells and layout for the requested area.
func (s *WorkbookService) ReadRange(req WorkbookRangeReadRequest) (*workbook.RangeResult, error) {
	return s.eng.ReadRange(req.SessionID, req.SheetID, req.Range)
}

// ReadFormulas returns every formula cell of a sheet.
func (s *WorkbookService) ReadFormulas(req WorkbookSheetRequest) (*workbook.FormulaCellsResult, error) {
	return s.eng.ReadFormulas(req.SessionID, req.SheetID)
}

// FindCells runs an Excel-style find across the requested sheets.
func (s *WorkbookService) FindCells(req workbook.FindRequest) (*workbook.FindCellsResult, error) {
	return s.eng.FindCells(req)
}

// ReadRowOutline returns outlined or hidden rows of a sheet.
func (s *WorkbookService) ReadRowOutline(req WorkbookSheetRequest) (*workbook.RowOutlineResult, error) {
	return s.eng.ReadRowOutline(req.SessionID, req.SheetID)
}

// Recalc evaluates formula cells after applying pending inputs.
func (s *WorkbookService) Recalc(req workbook.RecalcRequest) (*workbook.RecalcResult, error) {
	return s.eng.Recalc(req)
}

// ReadMedia resolves a visual id to its base64 payload.
func (s *WorkbookService) ReadMedia(req WorkbookMediaRequest) (*workbook.MediaResult, error) {
	return s.eng.ReadMedia(req.SessionID, req.VisualID)
}

// ReadPivotDefinition is unsupported: excelize does not expose pivot caches,
// and pivot tables are reported as empty so the renderer never calls this.
func (s *WorkbookService) ReadPivotDefinition(_ WorkbookPivotRequest) (any, error) {
	return nil, fmt.Errorf("pivot definitions are not supported")
}

// SaveWorkbook applies the renderer's edits and writes the workbook back.
func (s *WorkbookService) SaveWorkbook(req workbook.SaveRequest) (*workbook.SaveResult, error) {
	if req.Mode == "save-as" && req.TargetPath == "" {
		suggested := "workbook.xlsx"
		if info, err := s.eng.Info(req.SessionID); err == nil && info.Name != "" {
			suggested = info.Name
		}
		path, canceled, err := saveFileDialog(suggested)
		if err != nil {
			return nil, codedError(ErrSaveDialogFailed, err)
		}
		if canceled {
			return &workbook.SaveResult{Canceled: true}, nil
		}
		req.TargetPath = path
	}
	if req.TargetPath != "" {
		authorised, err := AuthoriseWrite(req.TargetPath)
		if err != nil {
			return nil, codedError(ErrSavePathNotAuthorised, err)
		}
		req.TargetPath = authorised
	}
	result, err := s.eng.Save(req)
	if err != nil {
		return nil, codedError(ErrSaveWriteFailed, err)
	}
	if result.File != nil && s.rm != nil && result.File.Path != "" {
		s.rm.AddRecent(result.File.Path)
	}
	return result, nil
}

// --- File I/O ---

// Save atomically writes base64-decoded content to path.
func (s *WorkbookService) Save(path string, content string) error {
	return atomicBase64Save(path, content, func() {
		if s.rm != nil {
			s.rm.AddRecent(path)
		}
	})
}

// SaveAs atomically writes base64-decoded content to a new path and returns it.
func (s *WorkbookService) SaveAs(path string, content string) (string, error) {
	if err := atomicBase64Save(path, content, func() {
		if s.rm != nil {
			s.rm.AddRecent(path)
		}
	}); err != nil {
		return "", err
	}
	return path, nil
}

// ExportCsv writes CSV content to a granted path (a save-dialog result or a
// path inside a picked export folder).
func (s *WorkbookService) ExportCsv(path string, content string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		data = []byte(content) // fallback: plain text
	}
	authorised, err := AuthoriseWrite(path)
	if err != nil {
		return "", codedError(ErrExportTargetNotAuthorised, err)
	}
	dir := filepath.Dir(authorised)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", codedError(ErrExportWriteFailed, err)
		}
	}
	if err := os.WriteFile(authorised, data, 0o644); err != nil {
		return "", codedError(ErrExportWriteFailed, err)
	}
	return authorised, nil
}

// FilesRead reads a granted or root-covered file and returns its
// base64-encoded content.
func (s *WorkbookService) FilesRead(path string) (string, error) {
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	if err != nil {
		return "", codedError(ErrOpenPathNotAuthorised, err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", codedError(ErrOpenReadFailed, err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// FilesReadImage reads an image file and returns its base64-encoded content.
func (s *WorkbookService) FilesReadImage(path string) (string, error) {
	return s.FilesRead(path)
}

// --- Other real operations ---

// DisplayName returns the current OS username.
func (s *WorkbookService) DisplayName() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	if name, ok := os.LookupEnv("USERNAME"); ok && name != "" {
		return name
	}
	if name, ok := os.LookupEnv("USER"); ok && name != "" {
		return name
	}
	return "user"
}

// CreateDocument writes a new standalone document (text formats only).
func (s *WorkbookService) CreateDocument(req WorkbookCreateDocumentRequest) CreateDocumentResult {
	switch req.Type {
	case "md", "html", "csv":
		dir, derr := defaultCreateDir()
		if derr != nil {
			return CreateDocumentResult{OK: false, Error: derr.Error()}
		}
		path := filepath.Join(dir, sanitizeFileName(req.Title)+"."+req.Type)
		if werr := os.WriteFile(path, []byte(req.Content), 0o644); werr != nil {
			return CreateDocumentResult{OK: false, Error: werr.Error()}
		}
		return CreateDocumentResult{OK: true, Path: path}
	default:
		return CreateDocumentResult{OK: false, Error: "unsupported type: " + req.Type}
	}
}

// WorkbookExportPdfResult is the export-pdf response.
type WorkbookExportPdfResult struct {
	Canceled bool   `json:"canceled"`
	Path     string `json:"path,omitempty"`
}

// ExportPdf renders HTML to a PDF via Edge headless and returns the path.
func (s *WorkbookService) ExportPdf(fileName string, html string) (WorkbookExportPdfResult, error) {
	if fileName == "" {
		fileName = "export.pdf"
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".pdf") {
		fileName += ".pdf"
	}
	path, canceled, err := saveFileDialog(fileName)
	if err != nil {
		return WorkbookExportPdfResult{}, codedError(ErrExportDialogFailed, err)
	}
	if canceled {
		return WorkbookExportPdfResult{Canceled: true}, nil
	}
	if err := platform.PrintHTMLToPdf(html, path, platform.PrintOptions{}); err != nil {
		return WorkbookExportPdfResult{}, codedError(ErrExportRenderFailed, err)
	}
	return WorkbookExportPdfResult{Canceled: false, Path: path}, nil
}

// ListPrinters returns the names of the installed system printers.
func (s *WorkbookService) ListPrinters() []PrinterInfo {
	return resolversListPrinters()
}

// Renamed emits the file-renamed event.
func (s *WorkbookService) Renamed(path string, name string) {
	if name != "" {
		platform.Emit("home:file-renamed", map[string]any{
			"path": path,
			"name": name,
		})
	}
}
