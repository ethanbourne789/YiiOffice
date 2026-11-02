//go:build !windows

package host

import (
	"os"
	"path/filepath"
)

// DocumentsDir returns the user's Documents folder.
func DocumentsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Documents"), nil
}
