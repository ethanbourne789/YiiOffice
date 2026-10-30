package bridge

import (
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

const sampleExportHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
	`<body><h1>YiiOffice export</h1><p>Hello from the export pipeline.</p></body></html>`

func TestExportServicePdfWritesFile(t *testing.T) {
	if !platform.EdgeAvailable() {
		t.Skip("Edge not installed; PDF rendering unavailable")
	}
	svc := NewExportService()
	out := filepath.Join(t.TempDir(), "out.pdf")
	result := svc.ExportPdf(sampleExportHTML, out, "export.pdf", 8.5, 11)
	if result.Error != "" || !result.OK {
		t.Fatalf("export failed: %+v", result)
	}
	info, err := os.Stat(out)
	if err != nil {
		t.Fatalf("stat output: %v", err)
	}
	if info.Size() == 0 {
		t.Fatalf("expected a non-empty PDF")
	}
}

func TestExportServicePdfRejectsEmptyDocument(t *testing.T) {
	svc := NewExportService()
	result := svc.ExportPdf("   ", filepath.Join(t.TempDir(), "out.pdf"), "export.pdf", 0, 0)
	if result.OK || result.Error == "" {
		t.Fatalf("expected an error for an empty document, got %+v", result)
	}
}

func TestExportServiceRenderPdfBase64(t *testing.T) {
	if !platform.EdgeAvailable() {
		t.Skip("Edge not installed; PDF rendering unavailable")
	}
	svc := NewExportService()
	data, err := svc.RenderPdfBase64(sampleExportHTML, 8.5, 11)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if len(data) == 0 {
		t.Fatalf("expected base64 PDF bytes")
	}
}

func TestExportServiceListPrintersReturnsSlice(t *testing.T) {
	svc := NewExportService()
	printers := svc.ListPrinters()
	if printers == nil {
		t.Fatalf("expected a non-nil slice")
	}
}

func TestExportServiceWriteBase64File(t *testing.T) {
	svc := NewExportService()
	out := filepath.Join(t.TempDir(), "nested", "note.txt")
	result := svc.WriteBase64File(out, "aGVsbG8=")
	if !result.OK {
		t.Fatalf("write failed: %+v", result)
	}
	data, err := os.ReadFile(out)
	if err != nil || string(data) != "hello" {
		t.Fatalf("unexpected content %q (err %v)", data, err)
	}
}

func TestResolveExportTargetNormalizesName(t *testing.T) {
	out := filepath.Join(t.TempDir(), "docs", "report.pdf")
	path, canceled, err := resolveExportTarget("report", out, ".pdf")
	if err != nil || canceled {
		t.Fatalf("resolve failed: canceled=%v err=%v", canceled, err)
	}
	if path != out {
		t.Fatalf("expected %q, got %q", out, path)
	}
}
