package index

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// waitFor polls store.Search until total reaches want or the deadline hits.
func waitFor(t *testing.T, store *FileIndexStore, q string, want int) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		res, err := store.Search(q, SearchOptions{})
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if res.Total == want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %q to have %d hits", q, want)
}

func newTestWatcher(t *testing.T) (*Watcher, *FileIndexStore, string) {
	t.Helper()
	ix, store, dir := newTestIndexer(t)
	w, err := NewWatcher(ix, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	w.SyncRoots([]string{dir})
	w.Start()
	t.Cleanup(w.Stop)
	return w, store, dir
}

func TestWatcherIndexesCreatedFile(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "created.txt")
	if err := os.WriteFile(fp, []byte("watchcreated token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchcreated", 1)
}

func TestWatcherRemovesDeletedFile(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "deleteme.txt")
	if err := os.WriteFile(fp, []byte("watchdeleted token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeleted", 1)
	if err := os.Remove(fp); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeleted", 0)
}

func TestWatcherPicksUpNewSubdir(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	sub := filepath.Join(dir, "newsub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	// Give the Create-dir handling a moment to register the watch before the
	// file lands inside it.
	time.Sleep(300 * time.Millisecond)
	fp := filepath.Join(sub, "deep.txt")
	if err := os.WriteFile(fp, []byte("watchdeepsub token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeepsub", 1)
}

func TestWatcherIgnoresUnsupportedExt(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "skip.xyz")
	if err := os.WriteFile(fp, []byte("watchskip token"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1 * time.Second)
	if got := searchTotal(t, store, "watchskip"); got != 0 {
		t.Fatalf("unsupported ext must not be indexed, got %d", got)
	}
}

func TestWatcherSyncRootsDropsRemovedRoot(t *testing.T) {
	w, store, dir := newTestWatcher(t)
	extra := filepath.Join(dir, "extra")
	if err := os.Mkdir(extra, 0o755); err != nil {
		t.Fatal(err)
	}
	w.SyncRoots([]string{dir})
	time.Sleep(300 * time.Millisecond)
	fp := filepath.Join(extra, "inside.txt")
	if err := os.WriteFile(fp, []byte("watchdropinside token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdropinside", 1)

	// Drop the root: new files there must no longer be indexed.
	w.SyncRoots([]string{})
	time.Sleep(300 * time.Millisecond)
	fp2 := filepath.Join(extra, "after.txt")
	if err := os.WriteFile(fp2, []byte("watchafterdrop token"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1 * time.Second)
	if got := searchTotal(t, store, "watchafterdrop"); got != 0 {
		t.Fatalf("removed root must stop indexing, got %d", got)
	}
}

func TestWatcherRecoversDeletedSubdir(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	fp := filepath.Join(sub, "a.txt")
	if err := os.WriteFile(fp, []byte("watchsubrebuild token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchsubrebuild", 1)

	if err := os.RemoveAll(sub); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)

	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	// Give the Create-dir re-watch and the Refresh fallback time to land.
	time.Sleep(600 * time.Millisecond)

	fp2 := filepath.Join(sub, "b.txt")
	if err := os.WriteFile(fp2, []byte("watchsubrebuilt2 token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchsubrebuilt2", 1)
}
