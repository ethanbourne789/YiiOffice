package index

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// pollUntil checks cond until it holds or the deadline passes.
func pollUntil(t *testing.T, timeout time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal(msg)
}

// TestRefreshSignalsFirstScan verifies the background loop actually runs a
// scan and closes FirstScanDone only after it completed.
func TestRefreshSignalsFirstScan(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "loop.txt")
	if err := os.WriteFile(fp, []byte("loopscan token"), 0o644); err != nil {
		t.Fatal(err)
	}

	ix.Refresh()
	select {
	case <-ix.FirstScanDone():
	case <-time.After(10 * time.Second):
		t.Fatal("FirstScanDone never closed after Refresh")
	}

	if got := searchTotal(t, store, "loopscan"); got != 1 {
		t.Fatalf("expected file indexed by loop, got %d hits", got)
	}
	ix.Stop()
}

// TestRefreshAfterIdleIsNotLost is a regression for the lost-wakeup race:
// a Refresh scheduled while the loop is idle between scans must still run.
func TestRefreshAfterIdleIsNotLost(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	ix.Refresh()
	<-ix.FirstScanDone()

	fp := filepath.Join(dir, "late.txt")
	if err := os.WriteFile(fp, []byte("latewakeup token"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix.Refresh()

	pollUntil(t, 10*time.Second, func() bool {
		return searchTotal(t, store, "latewakeup") == 1
	}, "refresh after idle loop never scheduled a scan")
	ix.Stop()
}

// TestConcurrentRefreshNoLostToken hammers Refresh from many goroutines and
// requires every file to land in the index: token pushes, the running check
// and the loop start are atomic, so no refresh may be dropped.
func TestConcurrentRefreshNoLostToken(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	const n = 20

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			fp := filepath.Join(dir, fmt.Sprintf("hammer%d.txt", i))
			if err := os.WriteFile(fp, []byte(fmt.Sprintf("hammertoken %d", i)), 0o644); err != nil {
				t.Error(err)
			}
			ix.Refresh()
		}(i)
	}
	wg.Wait()

	<-ix.FirstScanDone()
	// Final refresh guarantees a scan that started after every write.
	ix.Refresh()

	pollUntil(t, 15*time.Second, func() bool {
		return searchTotal(t, store, "hammertoken") == n
	}, fmt.Sprintf("expected %d hammered files indexed", n))
	ix.Stop()
}

// TestRunOnceSignalsFirstScan keeps the synchronous test entry point
// consistent with the loop: a completed run closes FirstScanDone.
func TestRunOnceSignalsFirstScan(t *testing.T) {
	ix, _, _ := newTestIndexer(t)
	ix.RunOnce()
	select {
	case <-ix.FirstScanDone():
	default:
		t.Fatal("RunOnce did not signal first scan completion")
	}
}

// TestStopIdempotent verifies Stop never panics or hangs: before the loop
// started, and on repeated calls.
func TestStopIdempotent(t *testing.T) {
	ix, _, _ := newTestIndexer(t)
	ix.Stop() // loop never started
	ix.Stop() // second call is a no-op

	ix2, _, dir2 := newTestIndexer(t)
	fp := filepath.Join(dir2, "stop.txt")
	if err := os.WriteFile(fp, []byte("stoptoken"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix2.Refresh()
	done := make(chan struct{})
	go func() {
		ix2.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Stop blocked waiting for the loop")
	}
	ix2.Stop()
}

// TestRefreshAfterStopIsNoop verifies a stopped indexer never resurrects
// its loop or reports a first scan.
func TestRefreshAfterStopIsNoop(t *testing.T) {
	ix, _, dir := newTestIndexer(t)
	ix.Stop()

	fp := filepath.Join(dir, "zombie.txt")
	if err := os.WriteFile(fp, []byte("zombietoken"), 0o644); err != nil {
		t.Fatal(err)
	}
	ix.Refresh()

	select {
	case <-ix.FirstScanDone():
		t.Fatal("Refresh after Stop started a scan")
	case <-time.After(200 * time.Millisecond):
	}
}
