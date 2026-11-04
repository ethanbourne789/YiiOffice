package export

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestExportDocsHeadlessRejectsUnsupportedFormat(t *testing.T) {
	dir := t.TempDir()
	in := dir + string(os.PathSeparator) + "test.docx"
	if err := os.WriteFile(in, []byte("docx"), 0o644); err != nil {
		t.Fatal(err)
	}
	out := dir + string(os.PathSeparator) + "out.epub"
	err := ExportDocsHeadless(ExportOptions{}, in, out, "epub")
	if err == nil || !strings.Contains(err.Error(), "does not support format") {
		t.Fatalf("expected explicit format error, got %v", err)
	}
}

func TestHeadlessTimeoutsAreFarBelowLegacyWaits(t *testing.T) {
	for name, d := range map[string]time.Duration{
		"docs":     DocsHeadlessTimeout,
		"sheets":   SheetsHeadlessTimeout,
		"slides":   SlidesHeadlessTimeout,
		"markdown": MarkdownHeadlessTimeout,
	} {
		if d > 120*time.Second {
			t.Fatalf("%s timeout %v is not far below the legacy 180–600s waits", name, d)
		}
	}
	if RendererReadyTimeout > 30*time.Second {
		t.Fatalf("renderer ready timeout %v is too long for a load failure", RendererReadyTimeout)
	}
}

func TestWaitForRenderCycleReadyTimeout(t *testing.T) {
	err := waitForRenderCycle(make(chan struct{}), make(chan headlessReport), 10*time.Millisecond, time.Second, func() {})
	if err == nil || !strings.Contains(err.Error(), "did not become ready") {
		t.Fatalf("expected ready timeout error, got %v", err)
	}
	if code := HeadlessExitCode(HeadlessOutcome{Error: err.Error()}); code != 3 {
		t.Fatalf("ready timeout exit code = %d, want 3", code)
	}
}

func TestWaitForRenderCycleSuccess(t *testing.T) {
	ready := make(chan struct{}, 1)
	done := make(chan headlessReport, 1)
	ready <- struct{}{}
	triggered := false
	err := waitForRenderCycle(ready, done, time.Second, time.Second, func() {
		triggered = true
		go func() { done <- headlessReport{ok: true} }()
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !triggered {
		t.Fatal("export request was not emitted after the ready signal")
	}
}

func TestWaitForRenderCycleRendererError(t *testing.T) {
	ready := make(chan struct{}, 1)
	done := make(chan headlessReport, 1)
	ready <- struct{}{}
	err := waitForRenderCycle(ready, done, time.Second, time.Second, func() {
		go func() { done <- headlessReport{err: errRendererRejected} }()
	})
	if err == nil || !strings.Contains(err.Error(), "unknown format") {
		t.Fatalf("expected renderer error, got %v", err)
	}
	if code := HeadlessExitCode(HeadlessOutcome{Error: err.Error(), ExitHint: ExitConversionFailed}); code != ExitConversionFailed {
		t.Fatalf("renderer failure exit code = %d, want %d", code, ExitConversionFailed)
	}
}

func TestWaitForRenderCycleExportTimeout(t *testing.T) {
	ready := make(chan struct{}, 1)
	ready <- struct{}{}
	err := waitForRenderCycle(ready, make(chan headlessReport), time.Second, 10*time.Millisecond, func() {})
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected export timeout error, got %v", err)
	}
	if code := HeadlessExitCode(HeadlessOutcome{Error: err.Error()}); code != 3 {
		t.Fatalf("export timeout exit code = %d, want 3", code)
	}
}

var errRendererRejected = &rendererError{"unknown format: docx"}

type rendererError struct{ msg string }

func (e *rendererError) Error() string { return e.msg }

func TestHeadlessReportFromEvent(t *testing.T) {
	tests := []struct {
		name string
		data any
		want headlessReport
	}{
		{"success", map[string]any{"ok": true}, headlessReport{ok: true}},
		{"error", map[string]any{"ok": false, "error": "boom"}, headlessReport{err: &rendererError{"boom"}}},
		{"malformed", "nope", headlessReport{err: &rendererError{"renderer sent an unreadable headless-export result"}}},
		{"failed without reason", map[string]any{"ok": false}, headlessReport{err: &rendererError{"the renderer reported a failed export without a reason"}}},
	}
	for _, tt := range tests {
		got := headlessReportFromEvent(&application.CustomEvent{Data: tt.data})
		if got.ok != tt.want.ok {
			t.Fatalf("%s: ok = %v, want %v", tt.name, got.ok, tt.want.ok)
		}
		if tt.want.err != nil {
			if got.err == nil || got.err.Error() != tt.want.err.Error() {
				t.Fatalf("%s: err = %v, want %v", tt.name, got.err, tt.want.err)
			}
		}
	}
}

func TestExportDocsHeadlessValidatesPath(t *testing.T) {
	err := ExportDocsHeadless(ExportOptions{}, "C:\\nonexistent\\file.docx", "out.pdf", "pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportSheetsPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportSheetsPdfHeadless(ExportOptions{}, "C:\\nonexistent\\file.xlsx", "out.pdf", "pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportSlidesPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportSlidesPdfHeadless(ExportOptions{}, "C:\\nonexistent\\file.pptx", "out.pdf", "pdf")
	if err == nil {
		t.Fatal("expected error for missing input")
	}
}

func TestExportMarkdownPdfHeadlessValidatesPath(t *testing.T) {
	err := ExportMarkdownPdfHeadless(ExportOptions{}, "C:\\nonexistent\\file.md", "out.pdf", "pdf")
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
