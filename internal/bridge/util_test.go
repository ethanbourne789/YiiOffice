package bridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateExternalURLValidHTTPS(t *testing.T) {
	err := ValidateExternalURL("https://example.com")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidateExternalURLValidHTTP(t *testing.T) {
	err := ValidateExternalURL("http://example.com/path?query=1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidateExternalURLEmpty(t *testing.T) {
	err := ValidateExternalURL("")
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
}

func TestValidateExternalURLTooLong(t *testing.T) {
	long := make([]byte, 2049)
	for i := range long {
		long[i] = 'a'
	}
	err := ValidateExternalURL(string(long))
	if err == nil {
		t.Fatal("expected error for URL too long")
	}
}

func TestValidateExternalURLRejectsNonHTTPScheme(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"ftp scheme", "ftp://example.com/file"},
		{"file scheme", "file:///C:/path"},
		{"javascript scheme", "javascript:alert(1)"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateExternalURL(tc.url)
			if err == nil {
				t.Fatalf("expected error for %s, got nil", tc.url)
			}
		})
	}
}

func TestValidateExternalURLRejectsCredentials(t *testing.T) {
	err := ValidateExternalURL("https://user:pass@example.com")
	if err == nil {
		t.Fatal("expected error for URL with credentials")
	}
}

func TestValidateExternalURLRejectsMissingHost(t *testing.T) {
	err := ValidateExternalURL("https://")
	if err == nil {
		t.Fatal("expected error for URL with missing host")
	}
}

func TestValidateExternalURLRejectsControlCharacters(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"CR", "https://example.com\r"},
		{"LF", "https://example.com\n"},
		{"tab", "https://example.com\t"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateExternalURL(tc.url)
			if err == nil {
				t.Fatalf("expected error for URL with %s, got nil", tc.name)
			}
		})
	}
}

func TestSanitizeFileNameRemovesInvalidChars(t *testing.T) {
	result := sanitizeFileName(`hello<world>:test|file`)
	if result != "hello_world__test_file" {
		t.Fatalf("expected 'hello_world__test_file', got %q", result)
	}
}

func TestSanitizeFileNameStripsPathComponents(t *testing.T) {
	result := sanitizeFileName("/path/to/file")
	if result != "file" {
		t.Fatalf("expected 'file', got %q", result)
	}
}

func TestSanitizeFileNameHandlesControlRunes(t *testing.T) {
	result := sanitizeFileName("hello\x00world")
	if result != "hello_world" {
		t.Fatalf("expected 'hello_world', got %q", result)
	}
}

func TestSanitizeFileNameFallbackEmpty(t *testing.T) {
	result := sanitizeFileName("")
	if result != "document" {
		t.Fatalf("expected 'document', got %q", result)
	}
}

func TestSanitizeFileNameFallbackDot(t *testing.T) {
	result := sanitizeFileName(".")
	if result != "document" {
		t.Fatalf("expected 'document', got %q", result)
	}
}

func TestSanitizeFileNameFallbackDotDot(t *testing.T) {
	result := sanitizeFileName("..")
	if result != "document" {
		t.Fatalf("expected 'document', got %q", result)
	}
}

func TestSanitizeFileNameAllInvalidChars(t *testing.T) {
	result := sanitizeFileName(`<>:"/\\|?*`)
	if result != "document" {
		t.Fatalf("expected 'document' for all invalid chars, got %q", result)
	}
}

func TestDefaultCreateDir(t *testing.T) {
	dir, err := defaultCreateDir()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if dir == "" {
		t.Fatal("expected non-empty directory")
	}

	// Verify the directory exists
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("expected directory to exist: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("expected a directory")
	}

	// Should be an absolute path
	if !filepath.IsAbs(dir) {
		t.Fatal("expected absolute path")
	}
}
