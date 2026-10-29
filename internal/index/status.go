package index

import (
	"sync"
	"time"
)

// IndexAvailability tracks whether the search index is ready.
type IndexAvailability struct {
	Ready      bool
	Reason     string
	LastUpdate time.Time
}

var (
	indexStatus IndexAvailability
	statusMu    sync.RWMutex
)

// SetIndexStatus updates the global index availability.
func SetIndexStatus(ready bool, reason string) {
	statusMu.Lock()
	defer statusMu.Unlock()
	indexStatus = IndexAvailability{
		Ready:      ready,
		Reason:     reason,
		LastUpdate: time.Now(),
	}
}

// GetIndexStatus returns the current index status.
func GetIndexStatus() IndexAvailability {
	statusMu.RLock()
	defer statusMu.RUnlock()
	return indexStatus
}
