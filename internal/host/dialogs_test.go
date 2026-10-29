package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDialogMemoryLastDirectory(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	dm := NewDialogMemory(store)

	// Empty default -> should return Documents/YiiOffice or ""
	_ = dm.LastDirectory() // just verify no panic

	// Set a valid directory
	subdir := filepath.Join(dir, "saved")
	os.MkdirAll(subdir, 0o755)
	_ = store.SetDefaultSaveDir(subdir)

	got := dm.LastDirectory()
	if got != subdir {
		t.Errorf("LastDirectory() = %q, want %q", got, subdir)
	}
}

func TestDialogMemoryLastDirectoryInvalidFallback(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	// Set non-existent dir
	_ = store.SetDefaultSaveDir("/nonexistent/path/that/does/not/exist")

	dm := NewDialogMemory(store)
	// Should fall back (empty or Documents/YiiOffice)
	result := dm.LastDirectory()
	// We just verify it doesn't panic and returns something valid
	if result != "" {
		info, err := os.Stat(result)
		if err != nil || !info.IsDir() {
			t.Errorf("LastDirectory() returned invalid dir: %q", result)
		}
	}
}

func TestDialogMemoryRememberDirectory(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	dm := NewDialogMemory(store)

	// Empty path should be ignored
	dm.RememberDirectory("")
	snap := store.Snapshot()
	if snap.DefaultSaveDir != "" {
		t.Errorf("RememberDirectory(\"\") should not change settings, got %q", snap.DefaultSaveDir)
	}

	// Valid path should save the directory
	subdir := filepath.Join(dir, "mydocs")
	os.MkdirAll(subdir, 0o755)
	dm.RememberDirectory(filepath.Join(subdir, "file.docx"))

	snap = store.Snapshot()
	if snap.DefaultSaveDir != subdir {
		t.Errorf("RememberDirectory() = %q, want %q", snap.DefaultSaveDir, subdir)
	}
}

func TestDialogMemoryRememberDirectoryNonexistent(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	dm := NewDialogMemory(store)

	// Non-existent directory should be ignored
	dm.RememberDirectory("/nonexistent/path/file.docx")
	snap := store.Snapshot()
	if snap.DefaultSaveDir != "" {
		t.Errorf("RememberDirectory with nonexistent dir should not change settings, got %q", snap.DefaultSaveDir)
	}
}
