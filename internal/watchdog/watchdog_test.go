// Package watchdog tests — cross-platform friendly.
package watchdog

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewDefaults(t *testing.T) {
	w := New(nil)

	if w.sampleInterval != 30*time.Second {
		t.Errorf("sampleInterval = %v, want 30s", w.sampleInterval)
	}
	if w.memoryLimitMB != 1536 {
		t.Errorf("memoryLimitMB = %v, want 1536", w.memoryLimitMB)
	}
	if w.cpuLimitPercent != 90 {
		t.Errorf("cpuLimitPercent = %v, want 90", w.cpuLimitPercent)
	}
	if w.hotSamplesBeforeReport != 10 {
		t.Errorf("hotSamplesBeforeReport = %v, want 10", w.hotSamplesBeforeReport)
	}
	if w.reportCooldown != 15*time.Minute {
		t.Errorf("reportCooldown = %v, want 15m", w.reportCooldown)
	}
}

func TestNewCustomConfig(t *testing.T) {
	w := New(&Config{
		SampleInterval:         5 * time.Second,
		MemoryLimitMB:          512,
		CPULimitPercent:        50,
		HotSamplesBeforeReport: 3,
		ReportCooldown:         time.Minute,
	})

	if w.sampleInterval != 5*time.Second {
		t.Error("sampleInterval not set from config")
	}
	if w.memoryLimitMB != 512 {
		t.Error("memoryLimitMB not set from config")
	}
	if w.cpuLimitPercent != 50 {
		t.Error("cpuLimitPercent not set from config")
	}
	if w.hotSamplesBeforeReport != 3 {
		t.Error("hotSamplesBeforeReport not set from config")
	}
}

func TestWatchdogStartStopsOnContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	w := New(&Config{
		SampleInterval: time.Millisecond,
	})

	go w.Start(ctx)
	cancel()

	// Give the goroutine time to exit
	time.Sleep(50 * time.Millisecond)
}

func TestWatchdogWriteDiagnostic(t *testing.T) {
	dir := t.TempDir()
	called := false

	w := New(&Config{
		DataDir: dir,
		OnHot: func(m ProcessMetric) {
			called = true
		},
	})

	m := ProcessMetric{
		PID:              12345,
		CPUPercent:       95.2,
		WorkingSetSizeMB: 1600,
		ProcessName:      "msedgewebview2.exe",
	}

	// Simulate crossing the threshold
	w.hotCount[m.PID] = w.hotSamplesBeforeReport
	w.reportHot(m, time.Now())

	// Verify callback
	if !called {
		t.Error("OnHot callback was not called")
	}

	// Verify file was written
	files, err := filepath.Glob(filepath.Join(dir, "renderer-watchdog-*.json"))
	if err != nil {
		t.Fatalf("glob failed: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 diagnostic file, got %d", len(files))
	}

	data, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatalf("read diagnostic file: %v", err)
	}

	content := string(data)
	if len(content) == 0 {
		t.Error("diagnostic file is empty")
	}
}

func TestWatchdogCooldown(t *testing.T) {
	dir := t.TempDir()
	callCount := 0

	w := New(&Config{
		DataDir:      dir,
		ReportCooldown: time.Hour,
		OnHot: func(m ProcessMetric) {
			callCount++
		},
	})

	m := ProcessMetric{
		PID:              99999,
		CPUPercent:       99,
		WorkingSetSizeMB: 2000,
	}

	// First report
	w.hotCount[m.PID] = w.hotSamplesBeforeReport
	w.reportHot(m, time.Now())

	// Second report within cooldown should be suppressed
	w.hotCount[m.PID] = w.hotSamplesBeforeReport
	w.reportHot(m, time.Now().Add(time.Second))

	if callCount != 1 {
		t.Errorf("expected 1 callback, got %d (cooldown not working)", callCount)
	}
}

func TestWatchdogCooldownExpiry(t *testing.T) {
	dir := t.TempDir()
	callCount := 0

	w := New(&Config{
		DataDir:      dir,
		ReportCooldown: time.Second,
		OnHot: func(m ProcessMetric) {
			callCount++
		},
	})

	m := ProcessMetric{
		PID:              88888,
		CPUPercent:       99,
		WorkingSetSizeMB: 2000,
	}

	// First report
	w.hotCount[m.PID] = w.hotSamplesBeforeReport
	w.reportHot(m, time.Now())

	// Second report after cooldown
	w.hotCount[m.PID] = w.hotSamplesBeforeReport
	w.reportHot(m, time.Now().Add(2*time.Second))

	if callCount != 2 {
		t.Errorf("expected 2 callbacks after cooldown, got %d", callCount)
	}
}

func TestHotCountReset(t *testing.T) {
	w := New(&Config{
		HotSamplesBeforeReport: 3,
	})

	// Verify hot count starts at 0
	m1 := ProcessMetric{PID: 11111, CPUPercent: 95, WorkingSetSizeMB: 1700}
	if w.hotCount[m1.PID] != 0 {
		t.Error("hotCount should start at 0")
	}

	// Simulate incrementing
	w.hotCount[m1.PID] = 2
	if w.hotCount[m1.PID] != 2 {
		t.Error("hotCount should be 2")
	}
}
