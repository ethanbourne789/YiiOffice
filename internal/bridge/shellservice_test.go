package bridge

import (
	"encoding/base64"
	"os"
	"testing"
)

func TestShellServiceOpenExternalWithValidURL(t *testing.T) {
	var captured string
	opener := func(url string) error {
		captured = url
		return nil
	}
	svc := NewShellService(opener)

	err := svc.OpenExternal("https://example.com")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if captured != "https://example.com" {
		t.Fatalf("expected captured URL to be https://example.com, got %s", captured)
	}
}

func TestShellServiceOpenExternalWithNilOpener(t *testing.T) {
	svc := NewShellService(nil)
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
	svc := NewShellService(opener)

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
	svc := NewShellService(nil)

	// Create a temp file with known content
	tmp := t.TempDir()
	testFile := tmp + "/test.txt"
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
	svc := NewShellService(nil)
	_, err := svc.ReadLocalImage("/nonexistent/path/image.png")
	if err == nil {
		t.Fatal("expected error for non-existent file")
	}
}
