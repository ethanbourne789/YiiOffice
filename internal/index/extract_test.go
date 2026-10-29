package index

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExtractPlainText(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	content := "hello world plain text"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s", res.Kind)
	}
	if res.Text != content {
		t.Fatalf("expected text=%q, got %q", content, res.Text)
	}
}

func TestExtractMarkdown(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "readme.md")
	content := "# Title\n\nSome markdown content."
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s", res.Kind)
	}
	if res.Text != content {
		t.Fatalf("expected text=%q, got %q", content, res.Text)
	}
}

func TestExtractBinaryNameOnly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.docx")
	if err := os.WriteFile(path, []byte("binary-ish"), 0644); err != nil {
		t.Fatal(err)
	}

	res := ExtractText(path)
	if res.Kind != "name-only" {
		t.Fatalf("expected kind=name-only, got %s", res.Kind)
	}
}

func TestExtractLargeFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "huge.txt")

	// Create a file with size > MaxExtractBytes using Truncate (sparse on most FS)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(MaxExtractBytes + 1); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()

	res := ExtractText(path)
	if res.Kind != "name-only" {
		t.Fatalf("expected kind=name-only for large file, got %s", res.Kind)
	}
}

func TestExtractNonExistent(t *testing.T) {
	res := ExtractText("/nonexistent/path/file.txt")
	if res.Kind != "error" {
		t.Fatalf("expected kind=error, got %s", res.Kind)
	}
	if res.Error == nil {
		t.Fatal("expected non-nil error")
	}
}

func TestExtractTruncatesLongFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "long.txt")

	// Create content that exceeds MaxBodyChars in runes
	longContent := make([]rune, MaxBodyChars+500)
	for i := range longContent {
		longContent[i] = 'a' + rune(i%26)
	}
	if err := os.WriteFile(path, []byte(string(longContent)), 0644); err != nil {
		t.Fatal(err)
	}

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s", res.Kind)
	}
	if len([]rune(res.Text)) != MaxBodyChars {
		t.Fatalf("expected %d runes, got %d", MaxBodyChars, len([]rune(res.Text)))
	}
}
