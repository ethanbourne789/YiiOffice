package index

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestIndexer(t *testing.T) (*FileIndexer, *FileIndexStore, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewFileIndexStore(filepath.Join(dir, "idx.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	ix := NewFileIndexer(store, []string{dir})
	return ix, store, dir
}

func searchTotal(t *testing.T, store *FileIndexStore, q string) int {
	t.Helper()
	res, err := store.Search(q, SearchOptions{})
	if err != nil {
		t.Fatalf("search %q: %v", q, err)
	}
	return res.Total
}

func TestIndexOneAddsFile(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(fp, []byte("hello incremental world"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne: %v", err)
	}
	if got := searchTotal(t, store, "incremental"); got != 1 {
		t.Fatalf("expected 1 hit, got %d", got)
	}
}

func TestIndexOneMissingRemovesEntry(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "gone.txt")
	if err := os.WriteFile(fp, []byte("vanishing token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatal(err)
	}
	if got := searchTotal(t, store, "vanishing"); got != 1 {
		t.Fatalf("expected indexed 1, got %d", got)
	}
	if err := os.Remove(fp); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne after delete: %v", err)
	}
	if got := searchTotal(t, store, "vanishing"); got != 0 {
		t.Fatalf("expected removed, got %d hits", got)
	}
}

func TestIndexOneSkipsUnsupportedExt(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "binary.xyz")
	if err := os.WriteFile(fp, []byte("unsupported token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne unsupported: %v", err)
	}
	if got := searchTotal(t, store, "unsupported"); got != 0 {
		t.Fatalf("expected not indexed, got %d", got)
	}
}

func TestIndexOneSkipsDirectories(t *testing.T) {
	ix, _, dir := newTestIndexer(t)
	sub := filepath.Join(dir, "achildir")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(sub); err != nil {
		t.Fatalf("IndexOne dir should be a no-op, got: %v", err)
	}
}
