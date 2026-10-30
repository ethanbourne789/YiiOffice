package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestDocsService(t *testing.T, dataDir string) *DocsService {
	t.Helper()
	rm := host.NewRecentManager(dataDir)
	return NewDocsService(rm, nil)
}

func TestDocsServiceOpenPath(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	testFile := filepath.Join(tmp, "test.docx")
	content := "hello document"
	if err := os.WriteFile(testFile, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.OpenPath(testFile)
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

func TestDocsServiceOpenPathNonExistent(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	_, err := svc.OpenPath("/nonexistent/file.docx")
	if err == nil {
		t.Fatal("expected error for non-existent file")
	}
}

func TestDocsServiceSave(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	testFile := filepath.Join(tmp, "test.docx")
	content := "saved content"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	err := svc.Save(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Verify file exists and content matches
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestDocsServiceSaveInvalidBase64(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	testFile := filepath.Join(tmp, "test.docx")
	err := svc.Save(testFile, "not-valid-base64!!!")
	if err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestDocsServiceSaveAs(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	testFile := filepath.Join(tmp, "new.docx")
	content := "save as content"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	result, err := svc.SaveAs(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != testFile {
		t.Fatalf("expected result path %s, got %s", testFile, result)
	}

	// Verify file content
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestDocsServiceSaveTo(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	testFile := filepath.Join(tmp, "saveto.docx")
	content := "save to content"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	err := svc.SaveTo(testFile, encoded)
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

func TestDocsServiceOpened(t *testing.T) {
	tmp := t.TempDir()
	rm := host.NewRecentManager(tmp)
	svc := NewDocsService(rm, nil)

	testPath := filepath.Join(tmp, "recent.docx")
	// Create the file so it exists
	if err := os.WriteFile(testPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	svc.Opened(testPath)

	recents := rm.GetRecents(0, 50)
	if len(recents) == 0 {
		t.Fatal("expected at least one recent entry")
	}
}

func TestDocsServiceRenamed(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestDocsService(t, tmp)

	// Should not panic even though platform.App is nil
	svc.Renamed("/path/to/file.docx", "New Name")
}

func TestDocsServiceOpenDocxPath(t *testing.T) {
	tmp := t.TempDir()
	docx := filepath.Join(tmp, "test.docx")
	if err := os.WriteFile(docx, []byte("fake docx content"), 0o644); err != nil {
		t.Fatal(err)
	}
	rm := host.NewRecentManager(tmp)
	svc := NewDocsService(rm, nil)
	result := svc.OpenDocxPath(docx)
	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if result.Path != docx {
		t.Fatalf("expected path %s, got %s", docx, result.Path)
	}
	decoded, _ := base64.StdEncoding.DecodeString(result.Base64)
	if string(decoded) != "fake docx content" {
		t.Fatal("base64 mismatch")
	}
}

func TestDocsServiceSaveDocx(t *testing.T) {
	tmp := t.TempDir()
	rm := host.NewRecentManager(tmp)
	svc := NewDocsService(rm, nil)
	content := base64.StdEncoding.EncodeToString([]byte("docx bytes"))
	result := svc.SaveDocx(filepath.Join(tmp, "out.docx"), content, false)
	if !result.OK {
		t.Fatalf("save failed: %s", result.Error)
	}
	data, _ := os.ReadFile(filepath.Join(tmp, "out.docx"))
	if string(data) != "docx bytes" {
		t.Fatal("file content mismatch")
	}
}

func TestDocsServiceOpenDocxPathNotFound(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	result := svc.OpenDocxPath("/nonexistent.docx")
	if result.Error == "" {
		t.Fatal("expected error for missing file")
	}
}

func TestDocsServiceSaveDocxEmptyPath(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	result := svc.SaveDocx("", "dG90YWxseSBpbnZhbGlk", false)
	if result.OK {
		t.Fatal("expected failure for empty path")
	}
	if result.Error == "" {
		t.Fatal("expected error message for empty path")
	}
}

func TestDocsServiceOpenDocxPathEmpty(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	result := svc.OpenDocxPath("")
	if result.Error == "" {
		t.Fatal("expected error for empty path")
	}
}

func TestDocsServiceSaveDocxTo(t *testing.T) {
	tmp := t.TempDir()
	rm := host.NewRecentManager(tmp)
	svc := NewDocsService(rm, nil)
	content := base64.StdEncoding.EncodeToString([]byte("docx to bytes"))
	result := svc.SaveDocxTo(filepath.Join(tmp, "saveto.docx"), content, false)
	if !result.OK {
		t.Fatalf("save failed: %s", result.Error)
	}
	data, _ := os.ReadFile(filepath.Join(tmp, "saveto.docx"))
	if string(data) != "docx to bytes" {
		t.Fatal("file content mismatch")
	}
}

func TestDocsServiceSetDocPassword(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	err := svc.SetDocPassword("/some/path.docx", "secret")
	if err != nil {
		t.Fatalf("SetDocPassword should return nil: %v", err)
	}
}

func TestDocsServiceConfirmDocumentReplace(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	if !svc.ConfirmDocumentReplace() {
		t.Fatal("ConfirmDocumentReplace should return true")
	}
}

func TestDocsServiceGetSystemLocale(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	locale := svc.GetSystemLocale()
	if locale != "zh" {
		t.Fatalf("expected locale zh, got %s", locale)
	}
}

func TestDocsServiceDocPasswordIntentRevision(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	rev := svc.DocPasswordIntentRevision()
	if rev != 0 {
		t.Fatalf("expected revision 0, got %d", rev)
	}
}

func TestDocsServiceDiscardDocPasswordIntents(t *testing.T) {
	rm := host.NewRecentManager(t.TempDir())
	svc := NewDocsService(rm, nil)
	// Should not panic
	svc.DiscardDocPasswordIntents(5)
}
