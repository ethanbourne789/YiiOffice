package host

import (
	"os"
	"path/filepath"
	"testing"
)

// newTestFolderManager builds a manager whose default save folder is a fresh
// temp dir, so tests never touch the real Documents folder.
func newTestFolderManager(t *testing.T) (*FolderManager, string) {
	t.Helper()
	dataDir := t.TempDir()
	defDir := filepath.Join(t.TempDir(), "YiiOffice")
	if err := os.MkdirAll(defDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return NewFolderManager(dataDir, func() string { return defDir }), defDir
}

func rootByPath(roots []FolderRoot, path string) (FolderRoot, bool) {
	for _, r := range roots {
		if r.Path == path {
			return r, true
		}
	}
	return FolderRoot{}, false
}

func TestFolderManagerAddAndGetRoots(t *testing.T) {
	fm, defDir := newTestFolderManager(t)
	rootDir := t.TempDir()

	fm.AddRoot(rootDir, "")
	roots := fm.GetRoots()

	// The default save folder is always the first row and not removable.
	if len(roots) == 0 || roots[0].Path != defDir {
		t.Fatalf("first root should be the default save folder, got %+v", roots)
	}
	if roots[0].Removable {
		t.Fatal("the default save folder must not be removable")
	}
	if !roots[0].Usable || !roots[0].Readable {
		t.Fatalf("default root should be usable, got %+v", roots[0])
	}

	added, ok := rootByPath(roots, rootDir)
	if !ok {
		t.Fatal("added root not found")
	}
	if added.Name != filepath.Base(rootDir) || !added.Removable || !added.Usable {
		t.Fatalf("unexpected added root row: %+v", added)
	}
}

func TestFolderManagerAddRootRejectsNonexistent(t *testing.T) {
	fm, _ := newTestFolderManager(t)
	initialLen := len(fm.GetRoots())

	fm.AddRoot("/nonexistent/path/that/does/not/exist", "Fake")
	if len(fm.GetRoots()) != initialLen {
		t.Fatal("should not add nonexistent root")
	}
}

func TestFolderManagerAddRootDuplicate(t *testing.T) {
	fm, _ := newTestFolderManager(t)
	rootDir := t.TempDir()

	fm.AddRoot(rootDir, "First")
	fm.AddRoot(rootDir, "Second")

	count := 0
	for _, r := range fm.GetRoots() {
		if r.Path == rootDir {
			count++
		}
	}
	if count != 1 {
		t.Fatal("should not add duplicate root")
	}
}

func TestFolderManagerRemoveRoot(t *testing.T) {
	fm, _ := newTestFolderManager(t)
	rootDir := t.TempDir()

	fm.AddRoot(rootDir, "TestRoot")
	fm.RemoveRoot(rootDir)

	for _, r := range fm.GetRoots() {
		if r.Path == rootDir {
			t.Fatal("root should be removed")
		}
	}
}

func TestFolderManagerRemoveDefaultRootIsIgnored(t *testing.T) {
	fm, defDir := newTestFolderManager(t)

	fm.RemoveRoot(defDir)

	if _, ok := rootByPath(fm.GetRoots(), defDir); !ok {
		t.Fatal("the default save folder must stay listed")
	}
}

func TestFolderManagerPersistRoots(t *testing.T) {
	fm, _ := newTestFolderManager(t)
	rootDir := t.TempDir()
	fm.AddRoot(rootDir, "")

	// Same data dir, new manager: the added root survives a restart.
	reloaded := NewFolderManager(fm.dataDir, fm.defaultDir)
	if _, ok := rootByPath(reloaded.GetRoots(), rootDir); !ok {
		t.Fatal("persisted root not found after reload")
	}
}

func TestFolderManagerListFolder(t *testing.T) {
	tmp := t.TempDir()

	if err := os.MkdirAll(filepath.Join(tmp, "alpha", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(tmp, "beta"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(tmp, "Zebra"), 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(tmp, "a.docx"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(tmp, "b.pdf"), []byte("b"), 0o644)
	// Unsupported extensions never show up in the tree.
	os.WriteFile(filepath.Join(tmp, "notes.exe"), []byte("c"), 0o644)

	fm, _ := newTestFolderManager(t)
	listing, err := fm.ListFolder(tmp)
	if err != nil {
		t.Fatal(err)
	}

	if listing.Dir != tmp {
		t.Fatalf("listing dir = %q", listing.Dir)
	}
	names := []string{}
	for _, f := range listing.Folders {
		names = append(names, f.Name)
	}
	want := []string{"alpha", "beta", "Zebra"}
	if len(names) != len(want) {
		t.Fatalf("folders = %v", names)
	}
	for i, n := range want {
		if names[i] != n {
			t.Fatalf("folder order: %v", names)
		}
	}
	if !listing.Folders[0].HasSubfolders {
		t.Fatal("alpha has a nested folder, the chevron must show")
	}
	if listing.Folders[1].HasSubfolders {
		t.Fatal("beta is empty, the chevron must not show")
	}
	if len(listing.Files) != 2 {
		t.Fatalf("files = %+v", listing.Files)
	}
	if listing.Files[0].Ext != "pdf" && listing.Files[0].Ext != "docx" {
		t.Fatalf("unexpected file row: %+v", listing.Files[0])
	}
	if listing.Files[0].Path == "" || listing.Files[0].Name == "" {
		t.Fatalf("file rows need path and name: %+v", listing.Files[0])
	}
}

func TestFolderManagerListFolderMissing(t *testing.T) {
	fm, _ := newTestFolderManager(t)

	listing, err := fm.ListFolder(filepath.Join(t.TempDir(), "gone"))
	if err == nil {
		t.Fatal("expected an error for a missing directory")
	}
	if !listing.Missing {
		t.Fatal("missing flag should be set")
	}
	if len(listing.Folders) != 0 || len(listing.Files) != 0 {
		t.Fatalf("missing listing should be empty: %+v", listing)
	}
}

func TestFolderManagerCreateFolder(t *testing.T) {
	tmp := t.TempDir()
	fm, _ := newTestFolderManager(t)

	if err := fm.CreateFolder(tmp, "newdir"); err != nil {
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
	fm, _ := newTestFolderManager(t)

	os.MkdirAll(filepath.Join(tmp, "exists"), 0o755)
	if err := fm.CreateFolder(tmp, "exists"); err == nil {
		t.Fatal("should error on existing folder")
	}
}

func TestFolderManagerRenameFolder(t *testing.T) {
	tmp := t.TempDir()
	fm, _ := newTestFolderManager(t)

	oldPath := filepath.Join(tmp, "oldname")
	os.MkdirAll(oldPath, 0o755)

	if err := fm.RenameFolder(oldPath, "newname"); err != nil {
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

	fm, _ := newTestFolderManager(t)

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

	fm, _ := newTestFolderManager(t)

	failed := fm.MovePaths([]string{existing, filepath.Join(tmp, "missing", "file.txt")}, dst)
	if len(failed) != 1 {
		t.Fatalf("expected 1 failure, got %d: %v", len(failed), failed)
	}
}

func TestFolderManagerDeleteFolder(t *testing.T) {
	tmp := t.TempDir()
	target := filepath.Join(tmp, "todelete")
	os.MkdirAll(target, 0o755)
	os.WriteFile(filepath.Join(target, "file.txt"), []byte("data"), 0o644)

	fm, _ := newTestFolderManager(t)

	if err := fm.DeleteFolder(target); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("folder should be deleted")
	}
}

func TestFolderManagerDeleteNonexistent(t *testing.T) {
	fm, _ := newTestFolderManager(t)

	// DeleteFolder uses RemoveAll which succeeds on nonexistent paths
	if err := fm.DeleteFolder(filepath.Join(t.TempDir(), "nothing")); err != nil {
		t.Fatal(err)
	}
}
