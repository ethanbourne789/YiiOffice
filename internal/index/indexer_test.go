package index

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIndexerFreshScan(t *testing.T) {
	dir := t.TempDir()
	// Create test files
	os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello world"), 0644)
	os.WriteFile(filepath.Join(dir, "notes.md"), []byte("# Notes\n\nSome content here."), 0644)

	store := newTestStore(t)
	ix := NewFileIndexer(store, []string{dir})
	ix.RunOnce()

	files, err := store.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 indexed files, got %d", len(files))
	}

	// Verify statuses
	for _, f := range files {
		if f.Status != IndexOK {
			t.Errorf("expected status=ok for %s, got %s", f.Path, f.Status)
		}
	}
}

func TestIndexerDetectsRemovedFiles(t *testing.T) {
	dir := t.TempDir()
	fpath := filepath.Join(dir, "remove_me.txt")
	os.WriteFile(fpath, []byte("temporary content"), 0644)

	store := newTestStore(t)
	ix := NewFileIndexer(store, []string{dir})
	ix.RunOnce()

	// Verify indexed
	files, _ := store.GetIndexedFiles()
	if len(files) != 1 {
		t.Fatalf("expected 1 file after first index, got %d", len(files))
	}

	// Remove file from disk
	os.Remove(fpath)

	// Re-index
	ix.RunOnce()

	files, _ = store.GetIndexedFiles()
	if len(files) != 0 {
		t.Fatalf("expected 0 files after removal, got %d", len(files))
	}
}

func TestIndexerSkipsUnchangedFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "stable.txt"), []byte("unchanged content"), 0644)

	store := newTestStore(t)
	ix := NewFileIndexer(store, []string{dir})

	// First run
	ix.RunOnce()
	files1, _ := store.GetIndexedFiles()

	// Second run (no changes)
	ix.RunOnce()
	files2, _ := store.GetIndexedFiles()

	if len(files1) != len(files2) {
		t.Fatalf("file count changed: %d -> %d", len(files1), len(files2))
	}
	if len(files2) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files2))
	}
}

func TestIndexerHandlesMultipleRoots(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	os.WriteFile(filepath.Join(dir1, "a.txt"), []byte("from dir1"), 0644)
	os.WriteFile(filepath.Join(dir2, "b.txt"), []byte("from dir2"), 0644)

	store := newTestStore(t)
	ix := NewFileIndexer(store, []string{dir1, dir2})
	ix.RunOnce()

	files, err := store.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files from two roots, got %d", len(files))
	}
}

func TestIndexerEmptyRoots(t *testing.T) {
	store := newTestStore(t)
	ix := NewFileIndexer(store, nil)

	// Should not panic
	ix.RunOnce()

	files, err := store.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatalf("expected 0 files with nil roots, got %d", len(files))
	}
}

func TestIndexerSetRoots(t *testing.T) {
	dir1 := t.TempDir()
	dir2 := t.TempDir()

	os.WriteFile(filepath.Join(dir1, "old.txt"), []byte("old root content"), 0644)
	os.WriteFile(filepath.Join(dir2, "new.txt"), []byte("new root content"), 0644)

	store := newTestStore(t)
	ix := NewFileIndexer(store, []string{dir1})
	ix.RunOnce()

	files, _ := store.GetIndexedFiles()
	if len(files) != 1 {
		t.Fatalf("expected 1 file from dir1, got %d", len(files))
	}

	// Switch roots
	ix.SetRoots([]string{dir2})
	ix.RunOnce()

	files, _ = store.GetIndexedFiles()
	if len(files) != 1 {
		t.Fatalf("expected 1 file from dir2, got %d", len(files))
	}
	if files[0].Status != IndexOK {
		t.Errorf("expected status=ok, got %s", files[0].Status)
	}
}
