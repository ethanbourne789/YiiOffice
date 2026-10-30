package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/workbook"
)

func newTestWorkbookService(t *testing.T, dataDir string) *WorkbookService {
	t.Helper()
	rm := host.NewRecentManager(dataDir)
	return NewWorkbookService(nil, rm)
}

func TestWorkbookServiceReadsUnknownSessionReturnsError(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	if _, err := svc.ReadRange(WorkbookRangeReadRequest{SessionID: "session-1", SheetID: "Sheet1"}); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
	if _, err := svc.ReadFormulas(WorkbookSheetRequest{SessionID: "session-1", SheetID: "Sheet1"}); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
	if _, err := svc.ReadRowOutline(WorkbookSheetRequest{SessionID: "session-1", SheetID: "Sheet1"}); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
	if _, err := svc.ReadMedia(WorkbookMediaRequest{SessionID: "session-1"}); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
	if _, err := svc.Recalc(workbook.RecalcRequest{SessionID: "session-1"}); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
	if err := svc.Close("session-1"); err == nil {
		t.Fatal("expected an error for an unknown session")
	}
}

func TestWorkbookServiceOpenFileReportsMetadata(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	if err := f.SetCellValue(sheet, "A1", "Name"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(tmp, "sample.xlsx")
	if err := f.SaveAs(path); err != nil {
		t.Fatal(err)
	}
	f.Close()

	info, err := svc.OpenFile(path)
	if err != nil {
		t.Fatalf("open file: %v", err)
	}
	if info.Name != "sample.xlsx" || len(info.Sheets) == 0 {
		t.Fatalf("unexpected file info: %+v", info)
	}
	if err := svc.Close(info.SessionID); err != nil {
		t.Fatalf("close session: %v", err)
	}
}

func TestWorkbookServiceReadPivotDefinitionIsUnsupported(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	if _, err := svc.ReadPivotDefinition(WorkbookPivotRequest{SessionID: "session-1"}); err == nil {
		t.Fatal("expected pivot definitions to be unsupported")
	}
}

func TestWorkbookServiceSave(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	testFile := filepath.Join(tmp, "test.xlsx")
	content := "fake xlsx binary data"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	err := svc.Save(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestWorkbookServiceSaveAs(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	nestedDir := filepath.Join(tmp, "sub", "dir")
	testFile := filepath.Join(nestedDir, "new.xlsx")
	content := "fake xlsx save as data"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	result, err := svc.SaveAs(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != testFile {
		t.Fatalf("expected result path %s, got %s", testFile, result)
	}

	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestWorkbookServiceExportCsv(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	testFile := filepath.Join(tmp, "output.csv")
	content := "a,b,c\n1,2,3"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	result, err := svc.ExportCsv(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != testFile {
		t.Fatalf("expected result path %s, got %s", testFile, result)
	}

	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read csv file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestWorkbookServiceFilesRead(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	testFile := filepath.Join(tmp, "test.xlsx")
	content := "fake xlsx content"
	if err := os.WriteFile(testFile, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.FilesRead(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	decoded, err := base64.StdEncoding.DecodeString(result)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != content {
		t.Fatalf("expected content %q, got %q", content, string(decoded))
	}
}

func TestWorkbookServiceFilesReadImage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	testFile := filepath.Join(tmp, "image.png")
	content := "fake image data"
	if err := os.WriteFile(testFile, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.FilesReadImage(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	decoded, err := base64.StdEncoding.DecodeString(result)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != content {
		t.Fatalf("expected content %q, got %q", content, string(decoded))
	}
}

func TestWorkbookServiceDisplayName(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	name := svc.DisplayName()
	if name == "" {
		t.Fatal("expected non-empty display name")
	}
}

func TestWorkbookServiceCreateDocumentSupportedTypes(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	supportedTypes := []string{"md", "html", "csv"}
	for _, typ := range supportedTypes {
		t.Run(typ, func(t *testing.T) {
			result := svc.CreateDocument(WorkbookCreateDocumentRequest{
				Type:    typ,
				Title:   "test-doc",
				Content: "some content",
			})
			if !result.OK {
				t.Fatalf("expected OK for type %s, got error: %s", typ, result.Error)
			}
			if result.Path == "" {
				t.Fatal("expected non-empty path")
			}
			// Verify file exists
			if _, err := os.Stat(result.Path); os.IsNotExist(err) {
				t.Fatalf("expected file to exist at %s", result.Path)
			}
		})
	}
}

func TestWorkbookServiceCreateDocumentUnsupportedType(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	result := svc.CreateDocument(WorkbookCreateDocumentRequest{
		Type:    "docx",
		Title:   "test",
		Content: "content",
	})
	if result.OK {
		t.Fatal("expected error for unsupported type")
	}
	if result.Error == "" {
		t.Fatal("expected non-empty error message")
	}
}

func TestWorkbookServiceListPrinters(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	printers := svc.ListPrinters()
	if printers == nil {
		t.Fatal("expected non-nil slice")
	}
	// The list mirrors the machine's installed printers, so only the shape is
	// asserted here: every entry must carry a non-empty name.
	for _, p := range printers {
		if p.Name == "" || p.DisplayName == "" {
			t.Fatalf("printer entry missing name: %+v", p)
		}
	}
}

func TestWorkbookServiceRenamed(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	// Should not panic even though platform.App is nil
	svc.Renamed("/path/to/file.xlsx", "New Name")
}

func TestWorkbookServiceRenamedWithEmptyName(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestWorkbookService(t, tmp)

	// Should not panic when name is empty (early return)
	svc.Renamed("/path/to/file.xlsx", "")
}
