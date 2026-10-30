package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestMarkdownService(t *testing.T, dataDir string) *MarkdownService {
	t.Helper()
	rm := host.NewRecentManager(dataDir)
	return NewMarkdownService(rm)
}

func TestMarkdownServiceReadFile(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	testFile := filepath.Join(tmp, "test.md")
	content := "# Hello World\n\nThis is a test."
	if err := os.WriteFile(testFile, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.ReadFile(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != content {
		t.Fatalf("expected content %q, got %q", content, result)
	}
}

func TestMarkdownServiceReadFileNonExistent(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	_, err := svc.ReadFile("/nonexistent/file.md")
	if err == nil {
		t.Fatal("expected error for non-existent file")
	}
}

func TestMarkdownServiceSaveWithBase64(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	testFile := filepath.Join(tmp, "test.md")
	content := "# Base64 saved content"
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

func TestMarkdownServiceSaveWithPlainText(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	testFile := filepath.Join(tmp, "test.md")
	content := "# Plain text saved content"

	err := svc.Save(testFile, content)
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

func TestMarkdownServiceSaveImage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	testFile := filepath.Join(tmp, "image.png")
	imgData := []byte("fake image binary data")
	encoded := base64.StdEncoding.EncodeToString(imgData)

	result, err := svc.SaveImage(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != testFile {
		t.Fatalf("expected result path %s, got %s", testFile, result)
	}

	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved image: %v", err)
	}
	if string(data) != string(imgData) {
		t.Fatalf("expected image data %q, got %q", imgData, data)
	}
}

func TestMarkdownServiceReadImage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	testFile := filepath.Join(tmp, "image.png")
	imgData := []byte("fake image data for read test")
	if err := os.WriteFile(testFile, imgData, 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.ReadImage(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	decoded, err := base64.StdEncoding.DecodeString(result)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != string(imgData) {
		t.Fatalf("expected data %q, got %q", imgData, decoded)
	}
}

func TestMarkdownServiceExportDocxOpenInDocs(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	// openInDocs mode uses writeAppManagedCopy which writes to AppDataDir.
	// In test environment, this should still work because AppDataDir just uses os.UserConfigDir.
	docxContent := []byte("fake docx binary")
	encoded := base64.StdEncoding.EncodeToString(docxContent)

	result := svc.ExportDocx(encoded, "test", "openInDocs")
	if !result.OK {
		t.Fatalf("expected OK, got error: %s", result.Error)
	}
	if result.Path == "" {
		t.Fatal("expected non-empty path")
	}

	// Verify the file was written
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}
	if string(data) != string(docxContent) {
		t.Fatalf("expected content %q, got %q", docxContent, data)
	}
}

func TestMarkdownServiceExportDocxDecodesBase64(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	// Test with invalid base64
	result := svc.ExportDocx("not-valid-base64!!!", "test", "openInDocs")
	if result.OK {
		t.Fatal("expected error for invalid base64")
	}
	if result.Error == "" {
		t.Fatal("expected non-empty error message")
	}
}

func TestMarkdownServiceExportDocxAddsExtension(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	docxContent := []byte("fake docx")
	encoded := base64.StdEncoding.EncodeToString(docxContent)

	result := svc.ExportDocx(encoded, "noext", "openInDocs")
	if !result.OK {
		t.Fatalf("expected OK, got error: %s", result.Error)
	}
	// The path should end with .docx
	if filepath.Ext(result.Path) != ".docx" {
		t.Fatalf("expected path to end with .docx, got %s", result.Path)
	}
}

func TestMarkdownServicePickImageFailsWithoutApp(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	_, err := svc.PickImage()
	if err == nil {
		t.Fatal("expected error when platform.App is nil")
	}
}
