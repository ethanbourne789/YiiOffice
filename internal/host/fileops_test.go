package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRename(t *testing.T) {
	dir := t.TempDir()
	fo := &FileOps{}

	// Create source file
	src := filepath.Join(dir, "old.txt")
	os.WriteFile(src, []byte("hello"), 0o644)

	newPath, err := fo.Rename(src, "new.txt")
	if err != nil {
		t.Fatalf("Rename failed: %v", err)
	}
	if newPath != filepath.Join(dir, "new.txt") {
		t.Fatalf("unexpected path: %s", newPath)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("old file should not exist")
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Error("new file should exist")
	}
}

func TestRename_NonExistent(t *testing.T) {
	fo := &FileOps{}
	_, err := fo.Rename("/nonexistent/file.txt", "x.txt")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestDuplicate(t *testing.T) {
	dir := t.TempDir()
	fo := &FileOps{}

	src := filepath.Join(dir, "data.docx")
	os.WriteFile(src, []byte("content"), 0o644)

	newPath, err := fo.Duplicate(src)
	if err != nil {
		t.Fatalf("Duplicate failed: %v", err)
	}
	if newPath != filepath.Join(dir, "Copy of data.docx") {
		t.Fatalf("unexpected duplicate path: %s", newPath)
	}

	data, err := os.ReadFile(newPath)
	if err != nil {
		t.Fatalf("read duplicate: %v", err)
	}
	if string(data) != "content" {
		t.Fatalf("duplicate content mismatch: %s", data)
	}
}

func TestDuplicate_Collision(t *testing.T) {
	dir := t.TempDir()
	fo := &FileOps{}

	src := filepath.Join(dir, "a.xlsx")
	os.WriteFile(src, []byte("x"), 0o644)

	// First duplicate
	_, err := fo.Duplicate(src)
	if err != nil {
		t.Fatalf("first duplicate: %v", err)
	}

	// Second duplicate should add (1)
	newPath, err := fo.Duplicate(src)
	if err != nil {
		t.Fatalf("second duplicate: %v", err)
	}
	if newPath != filepath.Join(dir, "Copy of a (1).xlsx") {
		t.Fatalf("unexpected collision path: %s", newPath)
	}
}

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	fo := &FileOps{}

	p1 := filepath.Join(dir, "a.txt")
	p2 := filepath.Join(dir, "b.txt")
	os.WriteFile(p1, []byte("a"), 0o644)
	os.WriteFile(p2, []byte("b"), 0o644)

	failed := fo.Delete([]string{p1, p2, "/nonexistent/c.txt"})
	if len(failed) != 1 {
		t.Fatalf("expected 1 failure, got %d: %v", len(failed), failed)
	}
	if failed[0] != "/nonexistent/c.txt" {
		t.Fatalf("unexpected failed path: %s", failed[0])
	}
}

func TestRouteByExt(t *testing.T) {
	tests := []struct {
		path     string
		wantKind TabKind
		wantOK   bool
	}{
		{"file.docx", TabKindDocs, true},
		{"file.DOCX", TabKindDocs, true},
		{"file.doc", TabKindDocs, true},
		{"file.xlsx", TabKindSheets, true},
		{"file.xlsm", TabKindSheets, true},
		{"file.xls", TabKindSheets, true},
		{"file.csv", TabKindSheets, true},
		{"file.tsv", TabKindSheets, true},
		{"file.pptx", TabKindSlides, true},
		{"file.ppt", TabKindSlides, true},
		{"file.pdf", TabKindPDF, true},
		{"file.md", TabKindMarkdown, true},
		{"file.markdown", TabKindMarkdown, true},
		{"file.txt", "", false},
		{"file.jpg", "", false},
	}

	for _, tt := range tests {
		kind, ok := RouteByExt(tt.path)
		if ok != tt.wantOK {
			t.Errorf("RouteByExt(%q): ok=%v, want %v", tt.path, ok, tt.wantOK)
		}
		if kind != tt.wantKind {
			t.Errorf("RouteByExt(%q): kind=%q, want %q", tt.path, kind, tt.wantKind)
		}
	}
}
