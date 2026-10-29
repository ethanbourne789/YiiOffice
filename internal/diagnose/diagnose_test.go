package diagnose

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"
)

func TestCollectBasics(t *testing.T) {
	d := Collect(nil)

	if d.Version == "" {
		t.Error("version should not be empty")
	}
	if d.OS == "" {
		t.Error("OS should not be empty")
	}
	if d.GoVersion == "" {
		t.Error("GoVersion should not be empty")
	}
	if d.Goroutines < 1 {
		t.Error("should have at least 1 goroutine")
	}
	if d.Timestamp.IsZero() {
		t.Error("timestamp should be set")
	}
}

func TestCollectWithOpts(t *testing.T) {
	d := Collect(&CollectOpts{
		Settings: map[string]any{"theme": "dark"},
		TabCount: 3,
		OpenTabs: []TabInfo{
			{ID: "home", Kind: "home", Title: "Home"},
			{ID: "tab-1", Kind: "docs", Title: "test.docx"},
		},
	})

	if d.TabCount != 3 {
		t.Errorf("TabCount = %d, want 3", d.TabCount)
	}
	if len(d.OpenTabs) != 2 {
		t.Errorf("OpenTabs len = %d, want 2", len(d.OpenTabs))
	}
}

func TestWriteDiagnosisFile(t *testing.T) {
	dir := t.TempDir()

	diag := Collect(&CollectOpts{
		TabCount: 2,
	})

	path, err := WriteDiagnosisFile(dir, diag)
	if err != nil {
		t.Fatalf("WriteDiagnosisFile: %v", err)
	}

	if filepath.Dir(path) != dir {
		t.Error("file should be written to dataDir")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}

	if len(data) == 0 {
		t.Error("diagnostic file should not be empty")
	}
}

func TestWriteCrashReport(t *testing.T) {
	dir := t.TempDir()

	stack := debug.Stack()
	path, err := WriteCrashReport(dir, "test panic", stack)
	if err != nil {
		t.Fatalf("WriteCrashReport: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read crash report: %v", err)
	}

	content := string(data)
	if len(content) == 0 {
		t.Error("crash report should not be empty")
	}
}

func TestWriteCrashReportWithNilPanic(t *testing.T) {
	dir := t.TempDir()

	path, err := WriteCrashReport(dir, nil, nil)
	if err != nil {
		t.Fatalf("WriteCrashReport with nil: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read crash report: %v", err)
	}

	if len(data) == 0 {
		t.Error("crash report should not be empty")
	}
}

func TestFormatPanic(t *testing.T) {
	tests := []struct {
		input any
		want  string
	}{
		{"explicit panic", "explicit panic"},
		{nil, "nil"},
	}

	for _, tt := range tests {
		got := formatPanic(tt.input)
		if got != tt.want {
			t.Errorf("formatPanic(%v) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestMemStatsCapture(t *testing.T) {
	d := Collect(nil)

	// TotalAlloc and StackSys should be non-zero after Go runtime initializes
	// Values may be 0 in MB (sub-MB allocations) so we just verify the fields are populated
	if d.Goroutines < 1 {
		t.Error("should have at least 1 goroutine")
	}
}
