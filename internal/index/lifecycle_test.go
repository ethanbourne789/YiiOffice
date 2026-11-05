package index

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestLifecycleConcurrentSyncAndShutdown guards F-02: SyncRoots used to run
// SetRoots/watcher.SyncRoots/Refresh without serialisation, and Shutdown
// closed the store without waiting for the initial-scan goroutine.
func TestLifecycleConcurrentSyncAndShutdown(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	lc, err := Init(dataDir, []string{dir})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lc.SyncRoots([]string{dir})
			lc.Refresh()
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = lc.Shutdown()
		// Idempotent: the second call must not close the store twice.
		_ = lc.Shutdown()
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("concurrent SyncRoots/Shutdown blocked")
	}
	// Calls after shutdown must be safe no-ops.
	lc.SyncRoots(nil)
	lc.Refresh()
}

func TestLifecycleSyncRootsIsNilSafe(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	lc, err := Init(dataDir, []string{dir})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	defer lc.Shutdown()
	// Must not panic even right after Init.
	lc.SyncRoots([]string{dir})
	lc.SyncRoots(nil)
}

// TestInitReachesReadyAfterFirstScan verifies the status only flips to
// Ready once the initial scan completed: at that point the root's files
// must already be searchable. Shutdown must also return promptly.
func TestInitReachesReadyAfterFirstScan(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ready.txt"), []byte("readygate token"), 0o644); err != nil {
		t.Fatal(err)
	}
	dataDir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	lc, err := Init(dataDir, []string{dir})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}

	// Deterministic gate: this lifecycle's first scan must complete...
	select {
	case <-lc.Indexer().FirstScanDone():
	case <-time.After(15 * time.Second):
		t.Fatal("first scan never completed")
	}

	res, err := lc.Store().Search("readygate", SearchOptions{})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if res.Total != 1 {
		t.Fatalf("expected 1 hit after first scan, got %d", res.Total)
	}

	// ...and Ready must be published right after it.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !GetIndexStatus().Ready {
		time.Sleep(20 * time.Millisecond)
	}
	if !GetIndexStatus().Ready {
		t.Fatal("index never reported Ready after first scan")
	}

	done := make(chan struct{})
	go func() {
		lc.Shutdown()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Shutdown blocked")
	}
}
