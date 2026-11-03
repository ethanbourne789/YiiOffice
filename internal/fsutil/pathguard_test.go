package fsutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func mustGuard(t *testing.T, roots ...string) *Guard {
	t.Helper()
	g, err := NewGuard(roots)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestAuthorizeAcceptsNestedPathUnderRoot(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "a", "b", "c.docx")
	g := mustGuard(t, root)
	got, err := g.Authorize(nested)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Authorize returns the canonical path: on Windows the root may arrive in
	// 8.3 short form (e.g. via TEMP) but comes back resolved to long form.
	rootCanonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(rootCanonical, "a", "b", "c.docx")
	if !strings.EqualFold(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAuthorizeRejectsEscapeWithDotDot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(root, "..", "evil.docx")
	_, err := mustGuard(t, root).Authorize(outside)
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsAbsoluteOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(other, "x.docx"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsAlternateDataStream(t *testing.T) {
	root := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(root, "a.docx:secret"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsReservedDeviceName(t *testing.T) {
	root := t.TempDir()
	_, err := mustGuard(t, root).Authorize(filepath.Join(root, "CON.docx"))
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeRejectsEmptyPath(t *testing.T) {
	root := t.TempDir()
	if _, err := mustGuard(t, root).Authorize(""); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthorizeFollowsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(outside, "x.docx")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := mustGuard(t, root).Authorize(link); err == nil {
		t.Fatal("expected rejection after resolving symlink")
	}
}

// A non-existent file under a symlinked directory inside a root must not be
// authorised: the existing prefix resolves outside the root, and the caller
// would follow the symlink when creating the file.
func TestAuthorizeRejectsNonExistentPathUnderSymlinkedDir(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := mustGuard(t, root).Authorize(filepath.Join(link, "new.docx")); err == nil {
		t.Fatal("expected rejection for escape via symlinked directory")
	}
}
