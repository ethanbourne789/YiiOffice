package sidecar

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewXlsxManagerMissingBinary(t *testing.T) {
	tmpDir := t.TempDir()
	// Binary does not exist.
	_, err := NewXlsxManager(tmpDir)
	if err == nil {
		t.Fatal("expected error when binary is missing")
	}
}

func TestNewXlsxManagerBinaryPath(t *testing.T) {
	tmpDir := t.TempDir()
	binaryPath := filepath.Join(tmpDir, "xlsx-sidecar.exe")
	// Create a dummy file.
	if err := os.WriteFile(binaryPath, []byte("dummy"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Should fail to start (not a valid executable), but the error
	// should be about starting the process, not finding it.
	_, err := NewXlsxManager(tmpDir)
	if err == nil {
		t.Fatal("expected error when binary is not executable")
	}
}
