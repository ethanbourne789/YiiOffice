package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFolderManagerAddAndGetRoots(t *testing.T) {
	dir := t.TempDir()
	rootDir := t.TempDir()

	fm := NewFolderManager(dir)

	// Add root
	fm.AddRoot(rootDir, "TestRoot")
	roots := fm.GetRoots()

	found := false
	for _, r := range roots {
		if r.Path == rootDir && r.Label == "TestRoot" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("added root not found")
	}
}

func TestFolderManagerAddRootRejectsNonexistent(t *testing.T) {
	dir := t.TempDir()
	fm := NewFolderManager(dir)
	initialLen := len(fm.GetRoots())

	fm.AddRoot("/nonexistent/path/that/does/not/exist", "Fake")
	if len(fm.GetRoots()) != initialLen {
		t.Fatal("should not add nonexistent root")
	}
}

func TestFolderManagerAddRootDuplicate(t *testing.T) {
	dir := t.TempDir()
	rootDir := t.TempDir()
	fm := NewFolderManager(dir)

	fm.AddRoot(rootDir, "First")
	fm.AddRoot(rootDir, "Second")

	roots := fm.GetRoots()
	count := 0
	for _, r := range roots {
		if r.Path == rootDir {
			count++
		}
	}
	if count != 1 {
		t.Fatal("should not add duplicate root")
	}
}

func TestFolderManagerRemoveRoot(t *testing.T) {
	dir := t.TempDir()
	rootDir := t.TempDir()
	fm := NewFolderManager(dir)

	fm.AddRoot(rootDir, "TestRoot")
	fm.RemoveRoot(rootDir)

	for _, r := range fm.GetRoots() {
		if r.Path == rootDir {
			t.Fatal("root should be removed")
		}
	}
}

func TestFolderManagerPersistRoots(t *testing.T) {
	dir := t.TempDir()
	rootDir := t.TempDir()
	fm := NewFolderManager(dir)
	fm.AddRoot(rootDir, "Persistent")

	reloaded := NewFolderManager(dir)
	roots := reloaded.GetRoots()
	found := false
	for _, r := range roots {
		if r.Path == rootDir && r.Label == "Persistent" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("persisted root not found after reload")
	}
}

func TestFolderManagerListFolderSorting(t *testing.T) {
	tmp := t.TempDir()

	// Create directories and files
	os.MkdirAll(filepath.Join(tmp, "alpha"), 0o755)
	os.MkdirAll(filepath.Join(tmp, "beta"), 0o755)
	os.MkdirAll(filepath.Join(tmp, "Zebra"), 0o755)
	os.WriteFile(filepath.Join(tmp, "file1.txt"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(tmp, "FileA.txt"), []byte("b"), 0o644)
	os.WriteFile(filepath.Join(tmp, "zfile.txt"), []byte("c"), 0o644)

	dir := t.TempDir()
	fm := NewFolderManager(dir)
	entries, err := fm.ListFolder(tmp)
	if err != nil {
		t.Fatal(err)
	}

	// Directories should come first
	if !entries[0].IsDir {
		t.Fatal("first entry should be directory")
	}

	// Dirs: alpha, beta, Zebra (case-insensitive alpha sort)
	dirs := []string{}
	files := []string{}
	for _, e := range entries {
		if e.IsDir {
			dirs = append(dirs, e.Name)
		} else {
			files = append(files, e.Name)
		}
	}

	// Verify dirs are first
	if len(dirs) == 0 || len(files) == 0 {
		t.Fatal("should have both dirs and files")
	}

	// Verify alphabetical order (case-insensitive)
	expectedDirs := []string{"alpha", "beta", "Zebra"}
	if dirs[0] != expectedDirs[0] || dirs[1] != expectedDirs[1] || dirs[2] != expectedDirs[2] {
		t.Fatalf("dir order: %v", dirs)
	}
}

func TestFolderManagerCreateFolder(t *testing.T) {
	tmp := t.TempDir()
	dir := t.TempDir()
	fm := NewFolderManager(dir)

	err := fm.CreateFolder(tmp, "newdir")
	if err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(tmp, "newdir"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatal("should be a directory")
	}
}

func TestFolderManagerCreateFolderAlreadyExists(t *testing.T) {
	tmp := t.TempDir()
	dir := t.TempDir()
	fm := NewFolderManager(dir)

	os.MkdirAll(filepath.Join(tmp, "exists"), 0o755)
	err := fm.CreateFolder(tmp, "exists")
	if err == nil {
		t.Fatal("should error on existing folder")
	}
}

func TestFolderManagerRenameFolder(t *testing.T) {
	tmp := t.TempDir()
	dir := t.TempDir()
	fm := NewFolderManager(dir)

	oldPath := filepath.Join(tmp, "oldname")
	os.MkdirAll(oldPath, 0o755)

	err := fm.RenameFolder(oldPath, "newname")
	if err != nil {
		t.Fatal(err)
	}

	newPath := filepath.Join(tmp, "newname")
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Fatal("renamed folder should exist")
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatal("old path should not exist")
	}
}

func TestFolderManagerMovePaths(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src")
	dst := filepath.Join(tmp, "dst")
	os.MkdirAll(src, 0o755)
	os.MkdirAll(dst, 0o755)

	f1 := filepath.Join(src, "file1.txt")
	f2 := filepath.Join(src, "file2.txt")
	os.WriteFile(f1, []byte("hello"), 0o644)
	os.WriteFile(f2, []byte("world"), 0o644)

	dir := t.TempDir()
	fm := NewFolderManager(dir)

	failed := fm.MovePaths([]string{f1, f2}, dst)
	if len(failed) > 0 {
		t.Fatalf("expected no failures, got: %v", failed)
	}

	if _, err := os.Stat(filepath.Join(dst, "file1.txt")); os.IsNotExist(err) {
		t.Fatal("file1 should be in dest")
	}
	if _, err := os.Stat(filepath.Join(dst, "file2.txt")); os.IsNotExist(err) {
		t.Fatal("file2 should be in dest")
	}
}

func TestFolderManagerMovePathsPartialFailure(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src")
	dst := filepath.Join(tmp, "dst")
	os.MkdirAll(src, 0o755)
	os.MkdirAll(dst, 0o755)

	existing := filepath.Join(src, "existing.txt")
	os.WriteFile(existing, []byte("data"), 0o644)

	dir := t.TempDir()
	fm := NewFolderManager(dir)

	failed := fm.MovePaths([]string{existing, "/nonexistent/file.txt"}, dst)
	if len(failed) != 1 {
		t.Fatalf("expected 1 failure, got %d: %v", len(failed), failed)
	}
	if failed[0] != "/nonexistent/file.txt" {
		t.Fatalf("unexpected failed path: %s", failed[0])
	}
}

func TestFolderManagerDeleteFolder(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "todelete")
	os.MkdirAll(target, 0o755)
	os.WriteFile(filepath.Join(target, "file.txt"), []byte("data"), 0o644)

	dir := t.TempDir()
	fm := NewFolderManager(dir)

	err := fm.DeleteFolder(target)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("folder should be deleted")
	}
}

func TestFolderManagerDeleteNonexistent(t *testing.T) {
	dir := t.TempDir()
	fm := NewFolderManager(dir)

	// DeleteFolder uses RemoveAll which succeeds on nonexistent paths
	err := fm.DeleteFolder("/nonexistent/path/for/deletion")
	if err != nil {
		t.Fatal(err)
	}
}
