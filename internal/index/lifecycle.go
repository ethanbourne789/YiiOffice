package index

import (
	"fmt"
	"path/filepath"
)

// Lifecycle manages the file index initialization and shutdown.
type Lifecycle struct {
	store   *FileIndexStore
	indexer *FileIndexer
}

// Init creates the store and indexer for the given data directory and folder root paths.
func Init(dataDir string, rootPaths []string) (*Lifecycle, error) {
	dbPath := filepath.Join(dataDir, "file-index.db")
	store, err := NewFileIndexStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open index store: %w", err)
	}

	SetIndexStatus(false, "initializing")

	indexer := NewFileIndexer(store, rootPaths)

	// Trigger initial background scan
	go func() {
		indexer.Refresh()
		SetIndexStatus(true, "")
	}()

	return &Lifecycle{store: store, indexer: indexer}, nil
}

// Store returns the file index store.
func (lc *Lifecycle) Store() *FileIndexStore { return lc.store }

// Indexer returns the file indexer.
func (lc *Lifecycle) Indexer() *FileIndexer { return lc.indexer }

// Refresh triggers a full re-index.
func (lc *Lifecycle) Refresh() {
	lc.indexer.Refresh()
}

// Shutdown closes the store and stops the indexer.
func (lc *Lifecycle) Shutdown() error {
	lc.indexer.Stop()
	return lc.store.Close()
}
