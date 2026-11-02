package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

func TestShellServiceOpenExternalWithValidURL(t *testing.T) {
	var captured string
	opener := func(url string) error {
		captured = url
		return nil
	}
	svc := NewShellService(opener, nil)

	err := svc.OpenExternal("https://example.com")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if captured != "https://example.com" {
		t.Fatalf("expected captured URL to be https://example.com, got %s", captured)
	}
}

func TestShellServiceOpenExternalWithNilOpener(t *testing.T) {
	svc := NewShellService(nil, nil)
	err := svc.OpenExternal("https://example.com")
	if err == nil {
		t.Fatal("expected error when opener is nil")
	}
	if err.Error() != "shell opener is not configured" {
		t.Fatalf("unexpected error message: %s", err.Error())
	}
}

func TestShellServiceOpenExternalWithInvalidURLs(t *testing.T) {
	opener := func(url string) error { return nil }
	svc := NewShellService(opener, nil)

	tests := []struct {
		name string
		url  string
	}{
		{"empty url", ""},
		{"too long", string(make([]byte, 2049))},
		{"non-http scheme ftp", "ftp://example.com/file"},
		{"non-http scheme file", "file:///C:/path"},
		{"non-http scheme javascript", "javascript:alert(1)"},
		{"credentials in url", "https://user:pass@example.com"},
		{"missing host", "https://"},
		{"control char CR", "https://example.com\r"},
		{"control char LF", "https://example.com\n"},
		{"control char tab", "https://example.com\t"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.OpenExternal(tc.url)
			if err == nil {
				t.Fatalf("expected error for url: %q", tc.url)
			}
		})
	}
}

func TestShellServiceReadLocalImage(t *testing.T) {
	tmp := t.TempDir()
	svc := NewShellService(nil, func() []string { return []string{tmp} })

	// Create a temp file with image extension (png)
	testFile := filepath.Join(tmp, "test.png")
	content := []byte("hello world")
	if err := os.WriteFile(testFile, content, 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := svc.ReadLocalImage(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result == "" {
		t.Fatal("expected non-empty result")
	}
	// Verify it's valid base64 of the original content
	decoded, err := base64.StdEncoding.DecodeString(result)
	if err != nil {
		t.Fatalf("result is not valid base64: %v", err)
	}
	if string(decoded) != string(content) {
		t.Fatalf("expected decoded content %q, got %q", content, decoded)
	}
}

func TestShellServiceReadLocalImageNonExistent(t *testing.T) {
	tmp := t.TempDir()
	svc := NewShellService(nil, func() []string { return []string{tmp} })
	if _, err := svc.ReadLocalImage(filepath.Join(tmp, "missing.png")); err == nil {
		t.Fatal("expected error for non-existent file")
	}
}

// A .exe (or any non-image) must never come back through an image channel.
func TestShellServiceReadLocalImageRejectsNonImage(t *testing.T) {
	tmp := t.TempDir()
	svc := NewShellService(nil, func() []string { return []string{tmp} })
	testFile := filepath.Join(tmp, "payload.exe")
	if err := os.WriteFile(testFile, []byte("MZ"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReadLocalImage(testFile); err == nil {
		t.Fatal("expected rejection for a non-image extension")
	}
}

func newTestGuard(t *testing.T, roots ...string) *fsutil.Guard {
	t.Helper()
	guard, err := fsutil.NewGuard(roots)
	if err != nil {
		t.Fatalf("guard: %v", err)
	}
	return guard
}

func TestValidateLocalPathRejectsOutsideRoots(t *testing.T) {
	inside := t.TempDir()
	outside := t.TempDir()
	file := filepath.Join(outside, "x.png")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateLocalPath(newTestGuard(t, inside), file); err == nil {
		t.Fatal("expected rejection for a path outside the root set")
	}
}

func TestValidateLocalPathAcceptsNestedImageUnderRoot(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "assets", "photo.png")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := ValidateLocalPath(newTestGuard(t, root), file)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Fatalf("expected an absolute path, got %q", got)
	}
}

func TestValidateLocalPathRejectsNonImageExtension(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateLocalPath(newTestGuard(t, root), file); err == nil {
		t.Fatal("expected rejection for a non-image extension")
	}
}

func TestValidateLocalPathWithoutGuard(t *testing.T) {
	if _, err := ValidateLocalPath(nil, "/tmp/x.png"); err == nil {
		t.Fatal("expected rejection when no roots are configured")
	}
}

func TestLocalReadRootsKeepsConfiguredRootOutsideHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	// The parent of the profile is outside it and always exists; before this
	// change a folder root there was silently unreadable.
	parent := filepath.Dir(home)
	roots := localReadRoots(func() []string { return []string{parent} })
	if !containsPath(roots, parent) {
		t.Fatalf("configured root %q missing from %v", parent, roots)
	}
}

func TestLocalReadRootsDropsMissingAndDuplicates(t *testing.T) {
	tmp := t.TempDir()
	roots := localReadRoots(func() []string {
		return []string{tmp, filepath.Join(tmp, "gone"), tmp, "  "}
	})
	if n := countPath(roots, tmp); n != 1 {
		t.Fatalf("expected %q once, got %d in %v", tmp, n, roots)
	}
	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			t.Fatalf("root %q should exist: %v", root, err)
		}
	}
}

func containsPath(paths []string, want string) bool { return countPath(paths, want) > 0 }

func countPath(paths []string, want string) int {
	n := 0
	for _, p := range paths {
		if filepath.Clean(p) == filepath.Clean(want) {
			n++
		}
	}
	return n
}
