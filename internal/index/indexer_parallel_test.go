package index

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestRunIndexesAllSubdirsParity verifies the parallel scan finds exactly the
// same files as the roots contain: 4 subdirs x 3 files each, plus 2 files at
// the root level.
func TestRunIndexesAllSubdirsParity(t *testing.T) {
	ix, store, dir := newTestIndexer(t)

	for i := 0; i < 4; i++ {
		sub := filepath.Join(dir, fmt.Sprintf("sub%d", i))
		if err := os.Mkdir(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		for j := 0; j < 3; j++ {
			fp := filepath.Join(sub, fmt.Sprintf("f%d_%d.txt", i, j))
			if err := os.WriteFile(fp, []byte(fmt.Sprintf("parittoken %d %d", i, j)), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	for j := 0; j < 2; j++ {
		fp := filepath.Join(dir, fmt.Sprintf("root%d.txt", j))
		if err := os.WriteFile(fp, []byte(fmt.Sprintf("parittoken root %d", j)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	ix.RunOnce()

	if got := searchTotal(t, store, "parittoken"); got != 14 {
		t.Fatalf("expected 14 indexed files, got %d", got)
	}

	// Lock the path-key format: root-level files and subtree files must both
	// be stored under absRoot-based paths (filepath.Join(dir, ...)), never a
	// mix of raw-root and ScanDir-normalized forms.
	files, err := store.GetIndexedFiles()
	if err != nil {
		t.Fatalf("GetIndexedFiles: %v", err)
	}
	paths := make(map[string]bool, len(files))
	for _, f := range files {
		paths[f.Path] = true
	}
	for _, want := range []string{
		filepath.Join(dir, "root0.txt"),
		filepath.Join(dir, "sub0", "f0_0.txt"),
	} {
		if !paths[want] {
			t.Fatalf("expected indexed path %q, not present in %d stored paths", want, len(paths))
		}
	}
}

// TestRunIndexesFilesSpanningMultipleWriteBatches covers the batch boundary the
// scan now writes through: rows are flushed every 64 files, so a corpus larger
// than one batch must still be indexed completely — including the partial tail
// batch that only the final flush sends.
func TestRunIndexesFilesSpanningMultipleWriteBatches(t *testing.T) {
	ix, store, dir := newTestIndexer(t)

	const files = 70 // one full batch (64) plus a partial tail (6)
	for i := 0; i < files; i++ {
		fp := filepath.Join(dir, fmt.Sprintf("batch-%03d.txt", i))
		body := fmt.Sprintf("batchtoken entry %d", i)
		if err := os.WriteFile(fp, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	ix.RunOnce()

	if got := searchTotal(t, store, "batchtoken"); got != files {
		t.Fatalf("expected %d indexed files across two batches, got %d", files, got)
	}
	if pending, scanning := ix.Status(); pending != 0 || scanning {
		t.Fatalf("scan finished dirty: pending=%d scanning=%v", pending, scanning)
	}
}
