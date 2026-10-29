package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaults(t *testing.T) {
	s, err := NewSettingsStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got := s.Snapshot()
	if got.Language != "zh" || got.Theme != "system" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
}

func TestSettingsPersistAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetLanguage("en"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTheme("dark"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Snapshot()
	if got.Language != "en" || got.Theme != "dark" {
		t.Fatalf("got %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
}

func TestSettingsRejectInvalidValues(t *testing.T) {
	s, _ := NewSettingsStore(t.TempDir())
	if err := s.SetLanguage("fr"); err == nil {
		t.Fatal("expected rejection")
	}
	if err := s.SetTheme("sepia"); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestSettingsRecoversFromCorruptFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Snapshot(); got.Language != "zh" {
		t.Fatalf("got %+v", got)
	}
}
