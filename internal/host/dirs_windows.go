//go:build windows

package host

import (
	"os"
	"path/filepath"
)

// AppDataDir returns %APPDATA%\YiiOffice, creating it when missing.
func AppDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "YiiOffice")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
