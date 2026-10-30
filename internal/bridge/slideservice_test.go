package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestSlidesService(t *testing.T, dataDir string) *SlidesService {
	t.Helper()
	rm := host.NewRecentManager(dataDir)
	return NewSlidesService(rm)
}

func TestSlidesServiceOpenPath(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

	testFile := filepath.Join(tmp, "test.pptx")
	content := "slide content"
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

func TestSlidesServiceSave(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

	testFile := filepath.Join(tmp, "test.pptx")
	content := "saved slide content"
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

func TestSlidesServiceSaveAs(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

	testFile := filepath.Join(tmp, "new.pptx")
	content := "save as slide content"
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

func TestSlidesServiceFilesRead(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

	testFile := filepath.Join(tmp, "test.pptx")
	content := "files read content"
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

func TestSlidesServiceFilesReadImage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

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

func TestSlidesServiceOpened(t *testing.T) {
	tmp := t.TempDir()
	rm := host.NewRecentManager(tmp)
	svc := NewSlidesService(rm)

	testPath := filepath.Join(tmp, "recent.pptx")
	if err := os.WriteFile(testPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	svc.Opened(testPath)

	recents := rm.GetRecents(0, 50)
	if len(recents) == 0 {
		t.Fatal("expected at least one recent entry")
	}
}

func TestSlidesServiceRenamed(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestSlidesService(t, tmp)

	// Should not panic even though platform.App is nil
	svc.Renamed("/path/to/file.pptx", "New Name")
}
