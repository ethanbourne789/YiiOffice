package index

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *FileIndexStore {
	t.Helper()
	dir := t.TempDir()
	s, err := NewFileIndexStore(filepath.Join(dir, "index.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mustUpsert(t *testing.T, s *FileIndexStore, path, name, ext string, mtimeMs int64, sizeBytes int64, status IndexStatus, body string) {
	t.Helper()
	var b *string
	if body != "" {
		b = &body
	}
	err := s.Upsert(path, name, ext, mtimeMs, sizeBytes, status, b,
		[]string{name}, []string{filepath.Base(filepath.Dir(path)), name}, []string{},
		[]string{name}, []string{filepath.Base(filepath.Dir(path)), name}, []string{})
	if err != nil {
		t.Fatal(err)
	}
}

// TestInitSchema verifies that all expected tables exist after initialization.
func TestInitSchema(t *testing.T) {
	s := newTestStore(t)

	tables := []string{"meta", "files", "file_fts"}
	for _, tbl := range tables {
		var name string
		err := s.db.QueryRow(`
			SELECT name FROM sqlite_master WHERE type='table' AND name=?
		`, tbl).Scan(&name)
		if err != nil {
			t.Errorf("table %s not found: %v", tbl, err)
		} else if name != tbl {
			t.Errorf("expected table %s, got %s", tbl, name)
		}
	}
}

// TestUpsertAndGetBody upserts a file and retrieves its body.
func TestUpsertAndGetBody(t *testing.T) {
	s := newTestStore(t)
	body := "hello world document"
	mustUpsert(t, s, "/docs/hello.txt", "hello.txt", "txt", 1000, 42, IndexOK, body)

	got, err := s.GetBody("/docs/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Fatal("expected body, got nil")
	}
	if *got != body {
		t.Fatalf("expected %q, got %q", body, *got)
	}
}

// TestUpsertReplacesExisting verifies that upserting the same path updates fields.
func TestUpsertReplacesExisting(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/a.txt", "a.txt", "txt", 1000, 10, IndexOK, "original")

	// Upsert with updated values
	mustUpsert(t, s, "/docs/a.txt", "a.txt", "txt", 2000, 20, IndexOK, "updated")

	body, err := s.GetBody("/docs/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if body == nil || *body != "updated" {
		t.Fatalf("expected 'updated', got %v", body)
	}

	files, err := s.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
	if files[0].MtimeMs != 2000 {
		t.Fatalf("expected mtime 2000, got %d", files[0].MtimeMs)
	}
}

// TestSearchBasic searches by filename keyword.
func TestSearchBasic(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/report.txt", "report.txt", "txt", 1000, 100, IndexOK, "")
	mustUpsert(t, s, "/docs/notes.md", "notes.md", "md", 1000, 50, IndexOK, "")
	mustUpsert(t, s, "/pics/photo.jpg", "photo.jpg", "jpg", 1000, 200, IndexOK, "")

	res, err := s.Search("report", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 1 {
		t.Fatalf("expected 1 hit, got %d", res.Total)
	}
	if res.Hits[0].Name != "report.txt" {
		t.Fatalf("expected 'report.txt', got %q", res.Hits[0].Name)
	}
}

// TestSearchWithExtFilter filters results by file extension.
func TestSearchWithExtFilter(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/report.txt", "report.txt", "txt", 1000, 100, IndexOK, "")
	mustUpsert(t, s, "/docs/report.md", "report.md", "md", 1000, 100, IndexOK, "")
	mustUpsert(t, s, "/docs/report.csv", "report.csv", "csv", 1000, 100, IndexOK, "")

	res, err := s.Search("report", SearchOptions{Ext: []string{"txt", "md"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 2 {
		t.Fatalf("expected 2 hits, got %d", res.Total)
	}
	for _, h := range res.Hits {
		if h.Ext != "txt" && h.Ext != "md" {
			t.Fatalf("unexpected ext %q", h.Ext)
		}
	}
}

// TestSearchWithPagination verifies offset and limit work correctly.
func TestSearchWithPagination(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 5; i++ {
		mustUpsert(t, s,
			"/docs/myfile-"+string(rune('a'+i))+".txt",
			"myfile-"+string(rune('a'+i))+".txt",
			"txt", int64(1000+i), 100, IndexOK, "")
	}

	// Page 1: limit 2, offset 0
	res, err := s.Search("myfile", SearchOptions{Limit: 2, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 5 {
		t.Fatalf("expected total 5, got %d", res.Total)
	}
	if len(res.Hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(res.Hits))
	}

	// Page 2: limit 2, offset 2
	res, err = s.Search("myfile", SearchOptions{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 2 {
		t.Fatalf("expected 2 hits on page 2, got %d", len(res.Hits))
	}

	// Default limit when not specified
	res, err = s.Search("myfile", SearchOptions{Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 5 {
		t.Fatalf("expected 5 hits with default limit, got %d", len(res.Hits))
	}
}

// TestRemove removes files and verifies they are gone from search.
func TestRemove(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/a.txt", "a.txt", "txt", 1000, 10, IndexOK, "")
	mustUpsert(t, s, "/docs/b.txt", "b.txt", "txt", 1000, 10, IndexOK, "")

	if err := s.Remove([]string{"/docs/a.txt"}); err != nil {
		t.Fatal(err)
	}

	res, err := s.Search("a", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 0 {
		t.Fatalf("expected 0 hits after remove, got %d", res.Total)
	}

	body, err := s.GetBody("/docs/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		t.Fatalf("expected nil body after remove, got %q", *body)
	}

	files, err := s.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}
}

// TestGetIndexedFiles lists all indexed files.
func TestGetIndexedFiles(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/a.txt", "a.txt", "txt", 1000, 10, IndexOK, "")
	mustUpsert(t, s, "/docs/b.md", "b.md", "md", 2000, 20, IndexNameOnly, "")

	files, err := s.GetIndexedFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	// Verify fields
	foundA := false
	foundB := false
	for _, f := range files {
		if f.Path == "/docs/a.txt" {
			foundA = true
			if f.MtimeMs != 1000 || f.SizeBytes != 10 || f.Status != IndexOK {
				t.Errorf("a.txt unexpected fields: %+v", f)
			}
		}
		if f.Path == "/docs/b.md" {
			foundB = true
			if f.MtimeMs != 2000 || f.SizeBytes != 20 || f.Status != IndexNameOnly {
				t.Errorf("b.md unexpected fields: %+v", f)
			}
		}
	}
	if !foundA || !foundB {
		t.Fatal("expected to find both a.txt and b.md")
	}
}

// TestEmptySearch verifies that an empty query returns no results.
func TestEmptySearch(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, "/docs/a.txt", "a.txt", "txt", 1000, 10, IndexOK, "")

	res, err := s.Search("", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 0 {
		t.Fatalf("expected 0 hits for empty query, got %d", res.Total)
	}
	if len(res.Hits) != 0 {
		t.Fatalf("expected empty hits, got %d", len(res.Hits))
	}
}
