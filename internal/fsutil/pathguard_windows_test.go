//go:build windows

package fsutil

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// A junction planted inside a root redirects to a directory outside it; the
// guard must resolve it and refuse, exactly like a symlink. Covers both an
// existing target file and a not-yet-created child under the junction.
func TestAuthorizeRejectsJunctionEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "x.docx"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "junction")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, outside).CombinedOutput(); err != nil {
		t.Skipf("mklink /J unavailable: %v (%s)", err, out)
	}
	g := mustGuard(t, root)
	if _, err := g.Authorize(link); err == nil {
		t.Fatal("expected rejection after resolving a junction to an outside directory")
	}
	if _, err := g.Authorize(filepath.Join(link, "new.docx")); err == nil {
		t.Fatal("expected rejection for a non-existent path under a junction")
	}

	// A junction that stays inside the root must not break legitimate access:
	// authors resolve it, then find the target inside the roots.
	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "y.docx"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	inner := filepath.Join(root, "inner")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", inner, sub).CombinedOutput(); err != nil {
		t.Skipf("mklink /J unavailable: %v (%s)", err, out)
	}
	if _, err := g.Authorize(filepath.Join(inner, "y.docx")); err != nil {
		t.Fatalf("junction inside the root rejected: %v", err)
	}
}

// Windows exposes some directories in 8.3 short form (GitHub runners put TEMP
// there). A path built from the short form must still authorise against a
// long-form root, because canonicalisation expands it.
func TestAuthorizeAcceptsShortFormRootPath(t *testing.T) {
	root := t.TempDir()
	short, ok := shortPath(root)
	if !ok || strings.EqualFold(short, root) {
		t.Skip("volume has 8.3 name generation disabled")
	}
	raw := filepath.Join(short, "Sub", "File.DOCX")
	if _, err := mustGuard(t, root).Authorize(raw); err != nil {
		t.Fatalf("short-form path %q under root %q rejected: %v", raw, root, err)
	}
}

// shortPath returns the 8.3 short form of path, if the volume generates one.
func shortPath(path string) (string, bool) {
	long, err := syscall.UTF16FromString(path)
	if err != nil {
		return "", false
	}
	// GetShortPathName needs room for the 12-character "NAME~1.EXT" form of
	// every component; the long name plus a wide margin is enough.
	buf := make([]uint16, len(long)*2+16)
	n, err := syscall.GetShortPathName(&long[0], &buf[0], uint32(len(buf)))
	if err != nil || n == 0 || int(n) >= len(buf) {
		return "", false
	}
	return syscall.UTF16ToString(buf[:n]), true
}
