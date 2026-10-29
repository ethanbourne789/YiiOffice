// Package diagnose gathers system and application state for troubleshooting.
package diagnose

import (
	"runtime"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

// TabInfo describes an open tab for diagnostic purposes.
type TabInfo struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
}

// Diagnosis contains all relevant system and application state.
type Diagnosis struct {
	Timestamp   time.Time `json:"timestamp"`
	Version     string    `json:"version"`
	OS          string    `json:"os"`
	GoVersion   string    `json:"goVersion"`
	Goroutines  int       `json:"goroutines"`
	HeapMB      uint64    `json:"heapMB"`
	StackMB     uint64    `json:"stackMB"`
	WebView2Ver string    `json:"webView2Version,omitempty"`
	Settings    any       `json:"settings,omitempty"`
	TabCount    int       `json:"tabCount"`
	OpenTabs    []TabInfo `json:"openTabs,omitempty"`
	Panic       string    `json:"panic,omitempty"`
	Stack       string    `json:"stack,omitempty"`
}

// Collect gathers current system and application state.
func Collect(opts *CollectOpts) Diagnosis {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	d := Diagnosis{
		Timestamp:   time.Now(),
		Version:     buildinfo.Version,
		OS:          runtime.GOOS + " " + runtime.GOARCH,
		GoVersion:   runtime.Version(),
		Goroutines:  runtime.NumGoroutine(),
		HeapMB:      m.TotalAlloc / 1024 / 1024,
		StackMB:     m.StackSys / 1024 / 1024,
		WebView2Ver: "N/A",
	}

	if opts == nil {
		return d
	}

	d.Settings = opts.Settings
	d.TabCount = opts.TabCount
	d.OpenTabs = opts.OpenTabs

	return d
}

// CollectOpts provides optional application-specific data.
type CollectOpts struct {
	Settings any
	TabCount int
	OpenTabs []TabInfo
}

// WriteDiagnosisFile writes diagnosis to the data directory.
func WriteDiagnosisFile(dataDir string, diag Diagnosis) (string, error) {
	path := dataDir + "/diagnosis-" + time.Now().Format("20060102-150405") + ".json"
	if err := fsutil.WriteJSONAtomic(path, diag, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// WriteCrashReport captures a panic and writes a diagnostic file.
func WriteCrashReport(dataDir string, recovered any, stack []byte) (string, error) {
	diag := Collect(nil)
	diag.Panic = formatPanic(recovered)
	diag.Stack = string(stack)
	return WriteDiagnosisFile(dataDir, diag)
}

func formatPanic(v any) string {
	if v == nil {
		return "nil"
	}
	switch s := v.(type) {
	case string:
		return s
	case error:
		return s.Error()
	default:
		return "(see stack trace)"
	}
}
