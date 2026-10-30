package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestPdfService(t *testing.T, dataDir string) *PdfService {
	t.Helper()
	rm := host.NewRecentManager(dataDir)
	return NewPdfService(rm)
}

func TestPdfServiceReadFile(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestPdfService(t, tmp)

	testFile := filepath.Join(tmp, "test.pdf")
	content := "%PDF-1.4 fake pdf content"
	if err := os.WriteFile(testFile, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.ReadFile(testFile)
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

func TestPdfServiceReadFileNonExistent(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestPdfService(t, tmp)

	_, err := svc.ReadFile("/nonexistent/file.pdf")
	if err == nil {
		t.Fatal("expected error for non-existent file")
	}
}

func TestPdfServiceSave(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestPdfService(t, tmp)

	testFile := filepath.Join(tmp, "test.pdf")
	content := "%PDF-1.4 saved pdf content"
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

func TestPdfServiceSaveAs(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestPdfService(t, tmp)

	// Create a nested directory that doesn't exist yet
	nestedDir := filepath.Join(tmp, "sub", "dir")
	testFile := filepath.Join(nestedDir, "new.pdf")
	content := "%PDF-1.4 save as pdf content"
	encoded := base64.StdEncoding.EncodeToString([]byte(content))

	result, err := svc.SaveAs(testFile, encoded)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != testFile {
		t.Fatalf("expected result path %s, got %s", testFile, result)
	}

	// Verify directory was created and file exists
	if _, err := os.Stat(nestedDir); os.IsNotExist(err) {
		t.Fatal("expected nested directory to be created")
	}

	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if string(data) != content {
		t.Fatalf("expected content %q, got %q", content, string(data))
	}
}

func TestPdfServiceStructuralOperationsDoNotPanic(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestPdfService(t, tmp)

	tests := []struct {
		name string
		fn   func() (any, error)
	}{
		{
			name: "ExtractPages",
			fn: func() (any, error) {
				return svc.ExtractPages("test.pdf", []int{1, 2}, "out.pdf")
			},
		},
		{
			name: "InsertPdf",
			fn: func() (any, error) {
				return svc.InsertPdf("test.pdf", "other.pdf", 1, "after")
			},
		},
		{
			name: "SplitPdf",
			fn: func() (any, error) {
				return svc.SplitPdf("test.pdf", "out/", "page")
			},
		},
		{
			name: "MergePdf",
			fn: func() (any, error) {
				return svc.MergePdf([]string{"a.pdf", "b.pdf"}, "out/", "merged")
			},
		},
		{
			name: "MergePages",
			fn: func() (any, error) {
				return svc.MergePages("test.pdf", []int{1, 2}, 2, "out.pdf")
			},
		},
		{
			name: "ReplacePages",
			fn: func() (any, error) {
				return svc.ReplacePages("test.pdf", "replace.pdf", 1)
			},
		},
		{
			name: "SetPageSize",
			fn: func() (any, error) {
				return svc.SetPageSize("test.pdf", 595.0, 842.0, []int{1})
			},
		},
		{
			name: "SplitPages",
			fn: func() (any, error) {
				return svc.SplitPages("test.pdf", []int{1}, 1, 2, "out.pdf")
			},
		},
		{
			name: "CropPages",
			fn: func() (any, error) {
				return svc.CropPages("test.pdf", []int{1}, [4]float64{0, 0, 100, 100}, "out.pdf")
			},
		},
		{
			name: "ExportImages",
			fn: func() (any, error) {
				return svc.ExportImages("test.pdf", []int{1}, "out/")
			},
		},
		{
			name: "ListPageImages",
			fn: func() (any, error) {
				return svc.ListPageImages("test.pdf", 0)
			},
		},
		{
			name: "InsertBlankPage",
			fn: func() (any, error) {
				return svc.InsertBlankPage("test.pdf", 1)
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("method %s panicked: %v", tc.name, r)
				}
			}()
			// We don't assert on the result because pdfengine depends on external binaries.
			// We only verify the method exists and doesn't panic.
			tc.fn()
		})
	}
}
