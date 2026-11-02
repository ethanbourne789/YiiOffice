//go:build windows

package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppDataDirHonoursUserDataOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "profile")
	t.Setenv(userDataEnvVar, dir)

	got, err := AppDataDir()
	if err != nil {
		t.Fatalf("AppDataDir: %v", err)
	}
	if got != dir {
		t.Fatalf("got %q, want %q", got, dir)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatalf("override dir not created: %v", err)
	}
}

func TestAppDataDirRejectsRelativeOverride(t *testing.T) {
	t.Setenv(userDataEnvVar, "relative/profile")
	if _, err := AppDataDir(); err == nil {
		t.Fatal("relative override must be rejected")
	}
}

func TestAppDataDirDefaultsToConfigDir(t *testing.T) {
	t.Setenv(userDataEnvVar, "")
	got, err := AppDataDir()
	if err != nil {
		t.Fatalf("AppDataDir: %v", err)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir: %v", err)
	}
	if want := filepath.Join(base, "YiiOffice"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
