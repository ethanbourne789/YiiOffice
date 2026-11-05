package index

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// watcherDebounce is the per-path coalescing window for filesystem events.
// Windows write operations fire several events per save; 400ms keeps the
// index fresh without re-extracting a file mid-save.
const watcherDebounce = 400 * time.Millisecond

// Lifecycle manages the file index initialization and shutdown.
type Lifecycle struct {
	store   *FileIndexStore
	indexer *FileIndexer
	watcher *Watcher

	// mu serialises the indexer/watcher root changes as one unit and keeps
	// them from racing with Shutdown. Wails bindings can call SyncRoots from
	// several goroutines at once.
	mu       sync.Mutex
	scanWG   sync.WaitGroup
	shutdown bool
}

// Init creates the store and indexer for the given data directory and folder
// root paths, and starts the incremental watcher over the same roots.
func Init(dataDir string, rootPaths []string) (*Lifecycle, error) {
	dbPath := filepath.Join(dataDir, "file-index.db")
	store, err := NewFileIndexStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open index store: %w", err)
	}

	SetIndexStatus(false, "initializing")

	indexer := NewFileIndexer(store, rootPaths)

	lc := &Lifecycle{store: store, indexer: indexer}

	// The watcher is a freshness optimization: if it cannot start (e.g.
	// resource limits), the manual Refresh path still works.
	w, err := NewWatcher(indexer, watcherDebounce)
	if err != nil {
		platform.Logger().Warn("index: watcher disabled", "error", err)
	} else {
		w.SyncRoots(rootPaths)
		w.Start()
		lc.watcher = w
	}

	// Trigger the initial background scan and only publish Ready once that
	// first scan has actually completed. Marking Ready right after Refresh()
	// returned would let search run against an empty or half-built index.
	// If shutdown wins the race, done closes and we leave the status at
	// "initializing" instead of ever reporting Ready.
	lc.scanWG.Add(1)
	go func() {
		defer lc.scanWG.Done()
		// A panic here used to kill a detached goroutine silently and leave
		// the index stuck at "initializing" forever.
		defer func() {
			if r := recover(); r != nil {
				platform.Logger().Error("index: initial scan panicked", "panic", fmt.Sprint(r))
			}
		}()
		indexer.Refresh()
		select {
		case <-indexer.FirstScanDone():
			SetIndexStatus(true, "")
		case <-indexer.done:
		}
	}()

	return lc, nil
}

// SyncRoots updates the watched directories after sidebar roots change and
// schedules a rescan, so files that already exist under a newly added root
// enter the index and ghost rows under a removed root are cleaned up.
// Safe to call at any time; a no-op when the watcher failed to start or
// after Shutdown. The three steps run as one serialised unit so concurrent
// binding calls cannot interleave two different root sets.
func (lc *Lifecycle) SyncRoots(roots []string) {
	lc.mu.Lock()
	defer lc.mu.Unlock()
	if lc.shutdown {
		return
	}
	lc.indexer.SetRoots(roots)
	if lc.watcher != nil {
		lc.watcher.SyncRoots(roots)
	}
	lc.indexer.Refresh()
}

// Store returns the file index store.
func (lc *Lifecycle) Store() *FileIndexStore { return lc.store }

// Indexer returns the file indexer.
func (lc *Lifecycle) Indexer() *FileIndexer { return lc.indexer }

// Refresh triggers a full re-index.
func (lc *Lifecycle) Refresh() {
	lc.mu.Lock()
	defer lc.mu.Unlock()
	if lc.shutdown {
		return
	}
	lc.indexer.Refresh()
}

// Shutdown stops the watcher and indexer, then closes the store. It waits for
// the initial-scan goroutine before closing the DB and is safe to call more
// than once (only the first call owns the close).
func (lc *Lifecycle) Shutdown() error {
	lc.mu.Lock()
	if lc.shutdown {
		lc.mu.Unlock()
		return nil
	}
	lc.shutdown = true
	lc.mu.Unlock()

	if lc.watcher != nil {
		lc.watcher.Stop()
	}
	lc.indexer.Stop()
	lc.scanWG.Wait()
	return lc.store.Close()
}
