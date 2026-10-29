//go:build windows

package watchdog

import (
	"testing"
)

func TestGetWebView2Processes(t *testing.T) {
	metrics, err := GetWebView2Processes()
	if err != nil {
		t.Fatalf("GetWebView2Processes failed: %v", err)
	}

	// It is valid to find zero processes if no WebView2 is running.
	t.Logf("Found %d WebView2 processes", len(metrics))

	for _, m := range metrics {
		if m.PID == 0 {
			t.Error("PID should not be 0")
		}
		if m.WorkingSetSizeMB <= 0 {
			t.Errorf("PID %d: WorkingSetSizeMB should be positive, got %f", m.PID, m.WorkingSetSizeMB)
		}
		if m.ProcessName == "" {
			t.Errorf("PID %d: ProcessName should not be empty", m.PID)
		}
	}
}

func TestGetAllWebView2RelatedProcesses(t *testing.T) {
	metrics, err := GetAllWebView2RelatedProcesses()
	if err != nil {
		t.Fatalf("GetAllWebView2RelatedProcesses failed: %v", err)
	}

	t.Logf("Found %d WebView2-related processes", len(metrics))

	for _, m := range metrics {
		if m.PID == 0 {
			t.Error("PID should not be 0")
		}
	}
}

func TestUpdateCPUPercent(t *testing.T) {
	// First sample to establish baseline
	metrics, err := GetAllWebView2RelatedProcesses()
	if err != nil {
		t.Skipf("no WebView2 processes running: %v", err)
	}

	// Reset tracker for clean test
	globalCPUTracker.mu.Lock()
	globalCPUTracker.lastCPU = make(map[uint32]int64)
	globalCPUTracker.lastSample = make(map[uint32]int64)
	globalCPUTracker.mu.Unlock()

	UpdateCPUPercent(metrics)

	// First call should have 0 CPU% (no previous sample)
	for _, m := range metrics {
		if m.CPUPercent != 0 {
			t.Logf("PID %d: CPU%% = %.1f (expected 0 on first sample)", m.PID, m.CPUPercent)
		}
	}
}
