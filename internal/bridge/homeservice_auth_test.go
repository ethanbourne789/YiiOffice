package bridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// makeLinkTo creates a directory link so the escape checks can be exercised.
// Windows refuses os.Symlink without the symlink privilege, but a directory
// junction (mklink /J) needs no elevation, so CI still covers the escape path.
func makeLinkTo(t *testing.T, link, target string) {
	t.Helper()
	if err := os.Symlink(target, link); err == nil {
		return
	}
	if runtime.GOOS == "windows" {
		if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err == nil {
			return
		} else {
			t.Skipf("cannot create a link (%v): %s", err, out)
		}
	}
	t.Skip("symlinks unavailable on this platform")
}

// TestAuthoriseDestructiveRejectsParentEscape covers a "..\\" path that walks
// out of the folder the UI exposed.
func TestAuthoriseDestructiveRejectsParentEscape(t *testing.T) {
	parent := outsideProfileDir(t)
	root := filepath.Join(parent, "inside")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(parent, "outside.txt")
	if err := os.WriteFile(outside, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	escape := filepath.Join(root, "..", "outside.txt")
	if _, err := authoriseDestructive([]string{root}, escape); err == nil {
		t.Fatalf("expected %q to be rejected", escape)
	}

	// The same path is a normal child of the parent, so widening the roots to
	// the parent must accept it — the check follows the path, not the text.
	if _, err := authoriseDestructive([]string{parent}, escape); err != nil {
		t.Fatalf("expected %q to be accepted once its real folder is authorised: %v", escape, err)
	}
}

// TestAuthoriseDestructiveRejectsAbsolutePathOutsideWhitelist covers deleting
// a folder that lies entirely outside the exposed roots.
func TestAuthoriseDestructiveRejectsAbsolutePathOutsideWhitelist(t *testing.T) {
	root := t.TempDir()
	outside := outsideProfileDir(t)

	if _, err := authoriseDestructive([]string{root}, outside); err == nil {
		t.Fatal("expected a folder outside the whitelisted root to be rejected")
	}
	if _, err := authoriseDirInRoots([]string{root}, outside); err == nil {
		t.Fatal("expected a destination folder outside the whitelisted root to be rejected")
	}
}

// TestHomeServiceDeleteFolderRejectsOutsideWhitelist is the binding-level
// version: no partial execution, the folder and its contents stay on disk.
func TestHomeServiceDeleteFolderRejectsOutsideWhitelist(t *testing.T) {
	svc := newTestHomeService(t, t.TempDir())
	outside := outsideProfileDir(t)
	victim := filepath.Join(outside, "victim")
	if err := os.MkdirAll(victim, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(victim, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := svc.DeleteFolder(victim); err == nil {
		t.Fatal("expected a folder outside the exposed roots to be refused")
	}
	if _, err := os.Stat(filepath.Join(victim, "keep.txt")); err != nil {
		t.Fatalf("refused delete must not remove anything: %v", err)
	}
}

// TestAuthoriseDestructiveAcceptsGrantedFile covers the "already opened this
// session" arm: a file outside the roots is writable because the user opened
// it through the app.
func TestAuthoriseDestructiveAcceptsGrantedFile(t *testing.T) {
	root := t.TempDir()
	outside := outsideProfileDir(t)
	opened := filepath.Join(outside, "opened.txt")
	if err := os.WriteFile(opened, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	GrantFile(opened)

	if _, err := authoriseDestructive([]string{root}, opened); err != nil {
		t.Fatalf("an opened file must be authorised: %v", err)
	}
}

// TestValidateDeleteTreeRejectsSymlinkEscape is the recursive-delete guard:
// the folder itself is inside the whitelist, but it contains a link pointing
// at a folder outside it.
func TestValidateDeleteTreeRejectsSymlinkEscape(t *testing.T) {
	base := outsideProfileDir(t)
	root := filepath.Join(base, "authorised")
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "inside.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	makeLinkTo(t, filepath.Join(root, "escape"), outside)

	if err := validateDeleteTree(root, []string{root}); err == nil {
		t.Fatal("expected a subtree containing a link out of the root to be rejected")
	}
	if _, err := os.Stat(filepath.Join(outside, "keep.txt")); err != nil {
		t.Fatalf("the link target must be left untouched: %v", err)
	}
}

// TestValidateDeleteTreeAcceptsAuthorisedTree is the happy path: every entry
// resolves inside the root.
func TestValidateDeleteTreeAcceptsAuthorisedTree(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "a", "b"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a", "b", "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateDeleteTree(root, []string{root}); err != nil {
		t.Fatalf("an authorised tree must pass validation: %v", err)
	}
}

// TestHomeServiceDeleteFolderAuthorised covers the normal delete path the
// sidebar uses.
func TestHomeServiceDeleteFolderAuthorised(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)
	// The temp folder is the picked export folder in this scenario, so the
	// test does not depend on TEMP living under the profile.
	GrantDir(tmp)

	dir := filepath.Join(tmp, "to-delete")
	if err := os.MkdirAll(filepath.Join(dir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nested", "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := svc.DeleteFolder(dir); err != nil {
		t.Fatalf("expected delete to succeed: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("expected the folder to be gone")
	}
}

// TestHomeServiceMovePathsRejectsBatchBeforeMoving proves a rejected batch
// does not partially execute: the valid item must stay where it was.
func TestHomeServiceMovePathsRejectsBatchBeforeMoving(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)
	GrantDir(tmp)

	dest := filepath.Join(tmp, "dest")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	valid := filepath.Join(tmp, "keep.txt")
	if err := os.WriteFile(valid, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	// "relative.txt" fails canonicalisation, so the whole call is refused.
	if err := svc.MovePaths([]string{valid, "relative.txt"}, dest); err == nil {
		t.Fatal("expected the batch to be rejected")
	}
	if _, err := os.Stat(valid); err != nil {
		t.Fatalf("rejected batch must not move any item: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "keep.txt")); !os.IsNotExist(err) {
		t.Fatal("rejected batch must not copy the item to the destination")
	}
}

// TestHomeServiceDeleteFilesReportsRejectedPaths keeps the binding's failure
// contract: unauthorised paths come back in the failed list and stay on disk.
func TestHomeServiceDeleteFilesReportsRejectedPaths(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)
	GrantDir(tmp)

	keep := filepath.Join(tmp, "keep.txt")
	if err := os.WriteFile(keep, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	failed := svc.DeleteFiles([]string{keep, "relative.txt"})
	if len(failed) != 1 || failed[0] != "relative.txt" {
		t.Fatalf("expected only the relative path to fail, got %v", failed)
	}
	if _, err := os.Stat(keep); !os.IsNotExist(err) {
		t.Fatal("expected the authorised file to be deleted")
	}
}
