package export

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mockExporter writes a small file to simulate a successful export.
func mockExporter(_ string, outPath string) error {
	return os.WriteFile(outPath, []byte("%PDF-mock"), 0o644)
}

func TestRunHeadlessExportSuccess(t *testing.T) {
	in := writeTempFile(t, "doc content")
	out := filepath.Join(t.TempDir(), "out.pdf")

	req := HeadlessRequest{Input: in, To: "pdf", Out: out}
	exporters := map[string]HeadlessExporter{"docs": mockExporter}

	result := RunHeadlessExport(req, exporters)
	if !result.Success {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if result.Input != in {
		t.Fatalf("input = %q", result.Input)
	}
	if result.Out != out {
		t.Fatalf("out = %q", result.Out)
	}
}

func TestRunHeadlessExportMissingInput(t *testing.T) {
	req := HeadlessRequest{Input: "C:\\nonexistent\\nope.docx", To: "pdf", Out: "out.pdf"}
	exporters := map[string]HeadlessExporter{"docs": mockExporter}

	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure")
	}
	if !strings.Contains(result.Error, "not exist") {
		t.Fatalf("unexpected error: %s", result.Error)
	}
}

func TestRunHeadlessExportUnsupportedFormat(t *testing.T) {
	in := writeTempFile(t, "doc content")
	req := HeadlessRequest{Input: in, To: "epub", Out: "out.epub"}
	// Override extension to force docs module
	_ = in
	// Use a .docx file but unsupported format
	in = strings.ReplaceAll(in, "tmp", "tmp") // ensure valid path
	req.Input = in

	// Actually, create a .docx temp file
	docxPath := filepath.Join(t.TempDir(), "test.docx")
	os.WriteFile(docxPath, []byte("docx"), 0o644)
	req.Input = docxPath

	exporters := map[string]HeadlessExporter{"docs": mockExporter}
	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure for epub format")
	}
}

func TestRunHeadlessExportSameInputOutput(t *testing.T) {
	docxPath := filepath.Join(t.TempDir(), "test.docx")
	os.WriteFile(docxPath, []byte("docx"), 0o644)

	req := HeadlessRequest{Input: docxPath, To: "pdf", Out: docxPath}
	exporters := map[string]HeadlessExporter{"docs": mockExporter}

	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure for same input/output")
	}
}

func TestRunHeadlessExportNoExporterRegistered(t *testing.T) {
	mdPath := filepath.Join(t.TempDir(), "test.md")
	os.WriteFile(mdPath, []byte("# hello"), 0o644)
	out := filepath.Join(t.TempDir(), "out.pdf")

	req := HeadlessRequest{Input: mdPath, To: "pdf", Out: out}
	exporters := map[string]HeadlessExporter{} // empty

	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure")
	}
}

func TestRunHeadlessExportExporterFails(t *testing.T) {
	docxPath := filepath.Join(t.TempDir(), "test.docx")
	os.WriteFile(docxPath, []byte("docx"), 0o644)
	out := filepath.Join(t.TempDir(), "out.pdf")

	failExporter := func(_, _ string) error {
		return errors.New("render crash")
	}

	req := HeadlessRequest{Input: docxPath, To: "pdf", Out: out}
	exporters := map[string]HeadlessExporter{"docs": failExporter}

	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure")
	}
	if !strings.Contains(result.Error, "render crash") {
		t.Fatalf("unexpected error: %s", result.Error)
	}
}

func TestValidateHeadlessPathsInputIsDirectory(t *testing.T) {
	dir := t.TempDir()
	req := HeadlessRequest{Input: dir, To: "pdf", Out: "out.pdf"}
	exporters := map[string]HeadlessExporter{"docs": mockExporter}

	result := RunHeadlessExport(req, exporters)
	if result.Success {
		t.Fatal("expected failure for directory input")
	}
}

func TestVerifyOutputFileStale(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "stale.pdf")
	os.WriteFile(outPath, []byte("old"), 0o644)

	// Set mtime far in the past.
	oldTime := time.Now().Add(-1 * time.Hour)
	os.Chtimes(outPath, oldTime, oldTime)

	err := verifyOutputFile(outPath, time.Now())
	if err == nil {
		t.Fatal("expected stale file error")
	}
}

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "*.docx")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	f.WriteString(content)
	return f.Name()
}


