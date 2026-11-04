package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
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

// ── Case sensitivity (Windows/macOS semantics) ──

// PathKey must treat the same path written with different casing as one key on
// case-insensitive platforms, and must keep them apart on Linux.
func TestPathKeyFollowsPlatformCaseSensitivity(t *testing.T) {
	mixed := filepath.Join("root", "Sub", "Note.DOCX")
	plain := filepath.Join("root", "sub", "note.docx")
	gotMixed, gotPlain := PathKey(mixed), PathKey(plain)
	if caseInsensitivePath {
		if gotMixed != gotPlain {
			t.Fatalf("case variants must share a key on %s: %q vs %q", runtime.GOOS, gotMixed, gotPlain)
		}
	} else if gotMixed == gotPlain {
		t.Fatalf("case variants must stay distinct on %s", runtime.GOOS)
	}
}

// A trailing separator is not part of a path's identity on any platform.
func TestPathKeyIgnoresTrailingSeparator(t *testing.T) {
	root := t.TempDir()
	withSep := root + string(filepath.Separator)
	if got, want := PathKey(withSep), PathKey(root); got != want {
		t.Fatalf("trailing separator changed the key: %q vs %q", got, want)
	}
}

// The fold must not be a naive strings.ToLower: Windows keeps 'İ' (U+0130)
// and 'i' apart, but ToLower maps both onto 'i'. The key must preserve that
// distinction, otherwise a grant for one file would authorise the other.
func TestPathKeyDoesNotCollapseLookalikeRunes(t *testing.T) {
	a := PathKey(filepath.Join("root", "İ.docx"))
	b := PathKey(filepath.Join("root", "i.docx"))
	if a == b {
		t.Fatalf("distinct runes must not share a key: %q", a)
	}
}

// The UNC and extended-length prefixes are path structure, not case, and must
// survive folding byte-for-byte (Windows-only: backslash is literal on Unix).
func TestPathKeyPreservesUNCPrefixes(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("UNC and \\\\?\\ prefixes only exist on Windows")
	}
	for _, in := range []string{`\\server\share\Dir\File.DocX`, `\\?\C:\Long\Dir\File.DocX`} {
		key := PathKey(in)
		switch {
		case strings.HasPrefix(in, `\\?\`) && !strings.HasPrefix(key, `\\?\`):
			t.Fatalf("extended-length prefix lost: %q -> %q", in, key)
		case strings.HasPrefix(in, `\\`) && !strings.HasPrefix(key, `\\`):
			t.Fatalf("UNC prefix lost: %q -> %q", in, key)
		}
		if strings.ContainsAny(key, "/") {
			t.Fatalf("separators rewritten: %q -> %q", in, key)
		}
	}
}

// A path under an authorised root must be accepted even when its casing differs
// from the root's: on Windows both spell the same file.
func TestAuthorizeAcceptsDifferentCaseUnderRoot(t *testing.T) {
	if !caseInsensitivePath {
		t.Skip("case-sensitive filesystem")
	}
	root := t.TempDir()
	g := mustGuard(t, root)
	raw := filepath.Join(flipASCIICase(root), "Sub", "File.DOCX")
	if _, err := g.Authorize(raw); err != nil {
		t.Fatalf("case variant of a path under the root rejected: %v", err)
	}
}

// A case variant must not widen the boundary: a path outside every root stays
// rejected whatever its casing.
func TestAuthorizeRejectsDifferentCaseOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	raw := filepath.Join(flipASCIICase(other), "x.docx")
	if _, err := mustGuard(t, root).Authorize(raw); err == nil {
		t.Fatal("expected rejection for an outside path")
	}
}

// flipASCIICase flips the case of ASCII letters only. strings.ToLower/ToUpper
// would also rewrite non-ASCII letters, which is not what this test is about.
func flipASCIICase(s string) string {
	b := []byte(s)
	for i, c := range b {
		switch {
		case c >= 'a' && c <= 'z':
			b[i] = c - 'a' + 'A'
		case c >= 'A' && c <= 'Z':
			b[i] = c - 'A' + 'a'
		}
	}
	return string(b)
}
