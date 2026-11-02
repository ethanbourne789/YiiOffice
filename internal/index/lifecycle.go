package index

import (
	"fmt"
	"path/filepath"
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

	// Trigger initial background scan
	go func() {
		indexer.Refresh()
		SetIndexStatus(true, "")
	}()

	return lc, nil
}

// SyncRoots updates the watched directories after sidebar roots change and
// schedules a rescan, so files that already exist under a newly added root
// enter the index and ghost rows under a removed root are cleaned up.
// Safe to call at any time; a no-op when the watcher failed to start.
// Concurrent binding calls may interleave the indexer/watcher steps; that is
// a low-probability, self-healing risk because the next sync realigns both.
func (lc *Lifecycle) SyncRoots(roots []string) {
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
	lc.indexer.Refresh()
}

// Shutdown stops the watcher and indexer, then closes the store.
func (lc *Lifecycle) Shutdown() error {
	if lc.watcher != nil {
		lc.watcher.Stop()
	}
	lc.indexer.Stop()
	return lc.store.Close()
}
