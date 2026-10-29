package export

import (
	"os"
	"testing"
)

func TestExportDocsHeadlessValidatesPath(t *testing.T) {
	err := ExportDocsHeadless("C:\\nonexistent\\file.docx", "out.pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportSheetsPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportSheetsPdfHeadless("C:\\nonexistent\\file.xlsx", "out.pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportSlidesPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportSlidesPdfHeadless("C:\\nonexistent\\file.pptx", "out.pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportMarkdownPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportMarkdownPdfHeadless("C:\\nonexistent\\file.md", "out.pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestValidateExportPathsInputIsDirectory(t *testing.T) {
	dir := t.TempDir()
	err := validateExportPaths(dir, "out.pdf")
	if err == nil {
		t.Fatal("expected error for directory input")
	}
}

func TestValidateExportPathsOutputDirMissing(t *testing.T) {
	dir := t.TempDir()
	f, err := os.CreateTemp(dir, "test*"+".docx")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	f.Close()

	err = validateExportPaths(f.Name(), "C:\\nonexistent\\dir\\out.pdf")
	if err == nil {
		t.Fatal("expected error for missing output dir")
	}
}

func TestHeadlessModuleForAllTypes(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"file.docx", "docs"},
		{"file.doc", "docs"},
		{"file.xlsx", "sheets"},
		{"file.xls", "sheets"},
		{"file.csv", "sheets"},
		{"file.tsv", "sheets"},
		{"file.pptx", "slides"},
		{"file.ppt", "slides"},
		{"file.md", "markdown"},
		{"file.markdown", "markdown"},
		{"file.txt", ""},
	}
	for _, tt := range tests {
		got := headlessModuleFor(tt.path)
		if got != tt.want {
			t.Errorf("headlessModuleFor(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}
