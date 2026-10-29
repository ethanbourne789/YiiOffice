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
	if !strings.EqualFold(got, nested) {
		t.Fatalf("got %q", got)
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
