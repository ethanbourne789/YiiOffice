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
	// The test's temp dir stands in for the configured folder roots, so the
	// fixtures each test writes are readable while the rest of the disk is not.
	return NewMarkdownService(rm, func() []string { return []string{dataDir} })
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

// TestMarkdownServiceSaveKeepsBase64LookingPlainText guards V-H6: short
// alphanumeric documents ("test", "2024", "markdown") are themselves valid
// base64 and used to be silently replaced by decoded binary garbage.
func TestMarkdownServiceSaveKeepsBase64LookingPlainText(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)
	for _, content := range []string{"test", "2024", "markdown", "abcd", "YWJj"} {
		testFile := filepath.Join(tmp, "case.md")
		if err := svc.Save(testFile, content); err != nil {
			t.Fatalf("Save(%q): %v", content, err)
		}
		data, err := os.ReadFile(testFile)
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != content {
			t.Errorf("Save(%q) wrote %q (content was decoded as base64)", content, string(data))
		}
	}
}

// TestMarkdownServiceSaveDocumentWritesTextVerbatim covers the production save
// path, which must not pass through the legacy encoding heuristic at all.
func TestMarkdownServiceSaveDocumentWritesTextVerbatim(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)
	path := filepath.Join(tmp, "note.md")
	GrantFile(path)
	res := svc.SaveDocument("test", path, "", false)
	if !res.OK {
		t.Fatalf("SaveDocument failed: %+v", res)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "test" {
		t.Fatalf("SaveDocument wrote %q, want %q", string(data), "test")
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

// outsideProfileDir creates a folder beside the user profile. It is the only
// fixture location that proves the root check is what rejects a path: files
// under the profile are readable anyway (localReadRoots adds the home
// directory), so a fixture there would pass for the wrong reason.
func outsideProfileDir(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no user home directory")
	}
	dir, err := os.MkdirTemp(filepath.Dir(home), "yiioffice-readimage-")
	if err != nil {
		t.Skipf("cannot create a folder beside the user profile: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

// A document link is untrusted: `![](../../secret.png)` must not become an
// arbitrary file read just because the renderer can resolve it to a path.
func TestMarkdownServiceReadImageRejectsOutsideRoots(t *testing.T) {
	dir := outsideProfileDir(t)
	imgPath := filepath.Join(dir, "secret.png")
	if err := os.WriteFile(imgPath, []byte("not for the document"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	svc := newTestMarkdownService(t, t.TempDir())
	if _, err := svc.ReadImage(imgPath); err == nil {
		t.Fatal("expected ReadImage to reject a path outside the authorised roots")
	}
}

// The image the user just picked in the native dialog has to stay readable even
// when it lives outside every root, which is what the dialog grant is for.
func TestMarkdownServiceReadImageAllowsDialogGrant(t *testing.T) {
	dir := outsideProfileDir(t)
	imgPath := filepath.Join(dir, "picked.png")
	if err := os.WriteFile(imgPath, []byte("image bytes"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	svc := newTestMarkdownService(t, t.TempDir())
	GrantFile(imgPath)

	encoded, err := svc.ReadImage(imgPath)
	if err != nil {
		t.Fatalf("a path the user picked in a dialog must stay readable: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != "image bytes" {
		t.Fatalf("unexpected bytes: %q", decoded)
	}
}

// A note opened from outside the sidebar keeps its own images next to itself,
// so the folder of a recent document is readable even though no root covers it.
func TestMarkdownServiceReadImageAllowsRecentDocumentFolder(t *testing.T) {
	dir := outsideProfileDir(t)
	docPath := filepath.Join(dir, "note.md")
	if err := os.WriteFile(docPath, []byte("# note"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	imgPath := filepath.Join(dir, "assets.png")
	if err := os.WriteFile(imgPath, []byte("image bytes"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	svc := newTestMarkdownService(t, t.TempDir())
	svc.rm.AddRecent(docPath)

	if _, err := svc.ReadImage(imgPath); err != nil {
		t.Fatalf("expected the recent document's folder to be readable: %v", err)
	}
}

// ReadImage embeds bytes into the renderer, so it is image-only: reading a
// text file through it would hand a document author any readable non-image.
func TestMarkdownServiceReadImageRejectsNonImage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestMarkdownService(t, tmp)

	txtPath := filepath.Join(tmp, "notes.txt")
	if err := os.WriteFile(txtPath, []byte("plain text"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	if _, err := svc.ReadImage(txtPath); err == nil {
		t.Fatal("expected ReadImage to reject a non-image extension")
	}
	if _, err := svc.ReadImage("   "); err == nil {
		t.Fatal("expected ReadImage to reject an empty path")
	}
}
