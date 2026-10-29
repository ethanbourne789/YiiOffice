package index

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

// TestScanFindsFiles creates a temp dir with supported files and verifies all are found.
func TestScanFindsFiles(t *testing.T) {
	dir := t.TempDir()

	names := []string{"a.docx", "b.xlsx", "c.pdf", "d.md", "e.txt", "f.json", "g.xml"}
	for _, name := range names {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	result := ScanDir(dir)
	if len(result.Files) != len(names) {
		t.Fatalf("expected %d files, got %d", len(names), len(result.Files))
	}
	if result.Truncated {
		t.Error("expected Truncated = false")
	}
}

// TestScanSkipsUnsupportedExts verifies .exe, .mp3, etc. are skipped.
func TestScanSkipsUnsupportedExts(t *testing.T) {
	dir := t.TempDir()

	skipNames := []string{"app.exe", "video.mp3", "archive.zip", "photo.png"}
	for _, name := range skipNames {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	// Add one supported file
	if err := os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ScanDir(dir)
	if len(result.Files) != 1 {
		t.Fatalf("expected 1 file (only supported), got %d", len(result.Files))
	}
	if result.Files[0].Path != filepath.Join(dir, "readme.txt") {
		t.Errorf("unexpected file: %s", result.Files[0].Path)
	}
}

// TestScanRecursive verifies nested directories are traversed.
func TestScanRecursive(t *testing.T) {
	dir := t.TempDir()

	// dir/a/b/c/deep.txt
	deepDir := filepath.Join(dir, "a", "b", "c")
	if err := os.MkdirAll(deepDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deepDir, "deep.txt"), []byte("deep"), 0644); err != nil {
		t.Fatal(err)
	}

	// dir/sibling.docx
	if err := os.WriteFile(filepath.Join(dir, "sibling.docx"), []byte("top"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ScanDir(dir)
	if len(result.Files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(result.Files))
	}

	// Verify paths
	pathSet := make(map[string]bool)
	for _, f := range result.Files {
		pathSet[f.Path] = true
	}
	if !pathSet[filepath.Join(dir, "sibling.docx")] {
		t.Error("missing sibling.docx")
	}
	if !pathSet[filepath.Join(deepDir, "deep.txt")] {
		t.Error("missing deep.txt")
	}
}

// TestScanMaxDepth verifies that max depth is respected.
func TestScanMaxDepth(t *testing.T) {
	dir := t.TempDir()

	// Build a deep nesting beyond ScanMaxDepth
	current := dir
	for i := 0; i <= ScanMaxDepth+2; i++ {
		current = filepath.Join(current, "level")
	}
	if err := os.MkdirAll(current, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(current, "very_deep.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	// Add a file at root level
	if err := os.WriteFile(filepath.Join(dir, "root.md"), []byte("root"), 0644); err != nil {
		t.Fatal(err)
	}

	result := ScanDir(dir)

	// The deeply nested file should NOT be included
	for _, f := range result.Files {
		if filepath.Base(f.Path) == "very_deep.txt" {
			t.Error("file beyond max depth should not be included")
		}
	}

	// The root file should be included
	found := false
	for _, f := range result.Files {
		if filepath.Base(f.Path) == "root.md" {
			found = true
			break
		}
	}
	if !found {
		t.Error("root.md should be included")
	}
}

// TestScanSkipsHidden verifies hidden files are skipped on Windows.
func TestScanSkipsHidden(t *testing.T) {
	dir := t.TempDir()

	// Create a normal file
	normalPath := filepath.Join(dir, "normal.txt")
	if err := os.WriteFile(normalPath, []byte("normal"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create a hidden file
	hiddenPath := filepath.Join(dir, "hidden.txt")
	if err := os.WriteFile(hiddenPath, []byte("hidden"), 0644); err != nil {
		t.Fatal(err)
	}
	utf16Hidden, err := windows.UTF16PtrFromString(hiddenPath)
	if err != nil {
		t.Fatal(err)
	}
	attrs, err := windows.GetFileAttributes(utf16Hidden)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetFileAttributes(utf16Hidden, attrs|windows.FILE_ATTRIBUTE_HIDDEN); err != nil {
		t.Fatal(err)
	}

	result := ScanDir(dir)
	if len(result.Files) != 1 {
		t.Fatalf("expected 1 file (normal only), got %d", len(result.Files))
	}
	if result.Files[0].Path != normalPath {
		t.Errorf("expected %s, got %s", normalPath, result.Files[0].Path)
	}
}

// TestScanEmptyDir verifies empty dir returns empty result.
func TestScanEmptyDir(t *testing.T) {
	dir := t.TempDir()

	result := ScanDir(dir)
	if len(result.Files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(result.Files))
	}
	if result.Truncated {
		t.Error("expected Truncated = false")
	}
}

// TestScanNonExistentDir verifies non-existent path returns empty result.
func TestScanNonExistentDir(t *testing.T) {
	result := ScanDir("C:\\nonexistent_path_that_should_not_exist_12345")
	if len(result.Files) != 0 {
		t.Fatalf("expected 0 files, got %d", len(result.Files))
	}
}
