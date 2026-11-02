package index

import (
	"os"
	"path/filepath"
	"testing"
)

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
