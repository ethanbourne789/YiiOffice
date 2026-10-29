// Package host implements desktop services independent of any UI framework.
package host

import (
	"os"
	"path/filepath"
)

// DialogMemory remembers the last directory used for file dialogs.
// It reads/writes DefaultSaveDir from the settings store.
type DialogMemory struct {
	store *SettingsStore
}

// NewDialogMemory creates a dialog memory backed by a settings store.
func NewDialogMemory(store *SettingsStore) *DialogMemory {
	return &DialogMemory{store: store}
}

// LastDirectory returns the last used directory, or the default save dir.
func (d *DialogMemory) LastDirectory() string {
	dir := d.store.Snapshot().DefaultSaveDir
	if dir == "" {
		// Fallback to Documents/YiiOffice
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, "Documents", "YiiOffice")
		}
	}
	if dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

// RememberDirectory saves the directory of the given path.
func (d *DialogMemory) RememberDirectory(path string) {
	if path == "" {
		return
	}
	dir := filepath.Dir(path)
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		_ = d.store.SetDefaultSaveDir(dir)
	}
}
