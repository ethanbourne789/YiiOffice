// Package watchdog monitors WebView2 renderer process resources.
package watchdog

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

// Config configures the watchdog behavior.
type Config struct {
	// SampleInterval is how often to sample process metrics.
	SampleInterval time.Duration
	// MemoryLimitMB is the per-process memory threshold (default 1536MB).
	MemoryLimitMB float64
	// CPULimitPercent is the single-core CPU threshold (default 90%).
	CPULimitPercent float64
	// HotSamplesBeforeReport is the number of consecutive threshold breaches before reporting.
	HotSamplesBeforeReport int
	// ReportCooldown is the minimum time between reports for the same PID.
	ReportCooldown time.Duration
	// DataDir is the user data directory for diagnostic files.
	DataDir string
	// OnHot is called when a renderer exceeds thresholds.
	OnHot func(metric ProcessMetric)
}

// Watchdog monitors renderer processes for excessive resource usage.
type Watchdog struct {
	sampleInterval       time.Duration
	memoryLimitMB        float64
	cpuLimitPercent      float64
	hotSamplesBeforeReport int
	reportCooldown       time.Duration
	dataDir              string
	onHot                func(metric ProcessMetric)

	lastMetrics map[uint32]ProcessMetric
	hotCount    map[uint32]int
	lastReport  map[uint32]time.Time
}

// New creates a watchdog with the given config. Applies defaults for zero-values.
func New(cfg *Config) *Watchdog {
	w := &Watchdog{
		lastMetrics: make(map[uint32]ProcessMetric),
		hotCount:    make(map[uint32]int),
		lastReport:  make(map[uint32]time.Time),
	}

	if cfg == nil {
		cfg = &Config{}
	}

	w.sampleInterval = cfg.SampleInterval
	if w.sampleInterval == 0 {
		w.sampleInterval = 30 * time.Second
	}

	w.memoryLimitMB = cfg.MemoryLimitMB
	if w.memoryLimitMB == 0 {
		w.memoryLimitMB = 1536
	}

	w.cpuLimitPercent = cfg.CPULimitPercent
	if w.cpuLimitPercent == 0 {
		w.cpuLimitPercent = 90
	}

	w.hotSamplesBeforeReport = cfg.HotSamplesBeforeReport
	if w.hotSamplesBeforeReport == 0 {
		w.hotSamplesBeforeReport = 10
	}

	w.reportCooldown = cfg.ReportCooldown
	if w.reportCooldown == 0 {
		w.reportCooldown = 15 * time.Minute
	}

	w.dataDir = cfg.DataDir
	w.onHot = cfg.OnHot

	return w
}

// Start begins monitoring in a background goroutine.
func (w *Watchdog) Start(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}

	ticker := time.NewTicker(w.sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.sample()
		}
	}
}

func (w *Watchdog) sample() {
	metrics, err := GetAllWebView2RelatedProcesses()
	if err != nil {
		log.Printf("[watchdog] failed to get processes: %v", err)
		return
	}

	// Update CPU percentages from previous sample
	UpdateCPUPercent(metrics)

	now := time.Now()

	for _, m := range metrics {
		prevHot := w.hotCount[m.PID]
		isHot := m.WorkingSetSizeMB > w.memoryLimitMB || m.CPUPercent > w.cpuLimitPercent

		if isHot {
			w.hotCount[m.PID]++
		} else {
			w.hotCount[m.PID] = 0
			continue
		}

		if prevHot < w.hotSamplesBeforeReport && w.hotCount[m.PID] >= w.hotSamplesBeforeReport {
			// Just crossed the threshold
			w.reportHot(m, now)
		}
	}

	// Clean up stale PIDs
	for pid := range w.hotCount {
		found := false
		for _, m := range metrics {
			if m.PID == pid {
				found = true
				break
			}
		}
		if !found {
			delete(w.hotCount, pid)
			delete(w.lastReport, pid)
			delete(w.lastMetrics, pid)
		}
	}

	w.lastMetrics = nil // not used across samples
}

func (w *Watchdog) reportHot(m ProcessMetric, now time.Time) {
	// Check cooldown
	if last, ok := w.lastReport[m.PID]; ok && now.Sub(last) < w.reportCooldown {
		return
	}
	w.lastReport[m.PID] = now

	// Write diagnostic file
	w.writeWatchdogDiagnostic(m)

	// Call user callback
	if w.onHot != nil {
		w.onHot(m)
	}
}

// WatchdogDiagnostic is written to a JSON file when a hot renderer is detected.
type WatchdogDiagnostic struct {
	Timestamp    string  `json:"timestamp"`
	PID          uint32  `json:"pid"`
	CPUPercent   float64 `json:"cpuPercent"`
	MemoryMB     float64 `json:"memoryMB"`
	HotSamples   int     `json:"hotSamples"`
	ProcessName  string  `json:"processName,omitempty"`
}

func (w *Watchdog) writeWatchdogDiagnostic(m ProcessMetric) {
	if w.dataDir == "" {
		return
	}

	diag := WatchdogDiagnostic{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		PID:          m.PID,
		CPUPercent:   m.CPUPercent,
		MemoryMB:     m.WorkingSetSizeMB,
		HotSamples:   w.hotCount[m.PID],
		ProcessName:  m.ProcessName,
	}

	path := filepath.Join(w.dataDir, fmt.Sprintf("renderer-watchdog-%s.json", time.Now().Format("20060102-150405")))

	data, err := json.MarshalIndent(diag, "", "  ")
	if err != nil {
		log.Printf("[watchdog] failed to marshal diagnostic: %v", err)
		return
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("[watchdog] failed to write diagnostic: %v", err)
	}
}
