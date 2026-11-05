// Package host implements desktop services independent of any UI framework.
package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

// Settings is the persisted preference document.
type Settings struct {
	Language               string `json:"language"`
	Theme                  string `json:"theme"`
	DocumentTheme          string `json:"documentTheme"`
	AutoSaveDefault        bool   `json:"autoSaveDefault"`
	AutoSaveDefaultUpdated int64  `json:"autoSaveDefaultUpdated"`
	DefaultSaveDir         string `json:"defaultSaveDir"`
	// FileAssocEnabled records the user's intent per extension (".docx" ->
	// true). The registry stays the source of truth for display; this map
	// only tells startup which ProgIDs to refresh when the exe path moved.
	FileAssocEnabled map[string]bool `json:"fileAssocEnabled"`
}

var (
	validLanguages       = map[string]bool{"zh": true, "en": true}
	validThemes          = map[string]bool{"light": true, "dark": true, "system": true}
	validDocumentThemes  = map[string]bool{"light": true, "dark": true, "auto": true}
)

// SettingsStore serialises reads and writes of settings.json.
// Settings contains a map, so every copy handed across the lock boundary is
// deep-copied: a shallow struct copy would keep sharing FileAssocEnabled and
// let a concurrent RefreshEnabledAssociations range race with a write.
type SettingsStore struct {
	mu   sync.RWMutex
	path string
	data Settings
}

// cloneSettings returns a copy that shares no mutable state with src.
func cloneSettings(src Settings) Settings {
	out := src
	if src.FileAssocEnabled != nil {
		out.FileAssocEnabled = make(map[string]bool, len(src.FileAssocEnabled))
		for k, v := range src.FileAssocEnabled {
			out.FileAssocEnabled[k] = v
		}
	}
	return out
}

// NewSettingsStore loads (or initialises) settings from dir.
// A corrupt file is discarded rather than fatal.
func NewSettingsStore(dir string) (*SettingsStore, error) {
	s := &SettingsStore{
		path: filepath.Join(dir, "settings.json"),
		data: Settings{Language: "zh", Theme: "system", DocumentTheme: "auto", AutoSaveDefault: true},
	}
	raw, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		var loaded Settings
		if jsonErr := unmarshalSettings(raw, &loaded); jsonErr == nil {
			s.data = mergeDefaults(loaded)
		}
	case os.IsNotExist(err):
	default:
		return nil, fmt.Errorf("read settings: %w", err)
	}
	return s, nil
}

// Snapshot returns an immutable copy of the current settings. Callers may
// range over FileAssocEnabled without holding the store lock.
func (s *SettingsStore) Snapshot() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSettings(s.data)
}

// SetLanguage validates and persists the UI language.
func (s *SettingsStore) SetLanguage(lang string) error {
	if !validLanguages[lang] {
		return fmt.Errorf("invalid language: %s", lang)
	}
	return s.update(func(d *Settings) { d.Language = lang })
}

// SetTheme validates and persists the application theme.
func (s *SettingsStore) SetTheme(theme string) error {
	if !validThemes[theme] {
		return fmt.Errorf("invalid theme: %s", theme)
	}
	return s.update(func(d *Settings) { d.Theme = theme })
}

// SetDocumentTheme validates and persists the document editor theme.
func (s *SettingsStore) SetDocumentTheme(theme string) error {
	if !validDocumentThemes[theme] {
		return fmt.Errorf("invalid document theme: %s", theme)
	}
	return s.update(func(d *Settings) { d.DocumentTheme = theme })
}

// SetAutoSaveDefault persists the auto-save default toggle and records the time.
func (s *SettingsStore) SetAutoSaveDefault(enabled bool) error {
	return s.update(func(d *Settings) {
		d.AutoSaveDefault = enabled
		d.AutoSaveDefaultUpdated = time.Now().UnixMilli()
	})
}

// SetDefaultSaveDir persists the default save directory.
func (s *SettingsStore) SetDefaultSaveDir(dir string) error {
	return s.update(func(d *Settings) { d.DefaultSaveDir = dir })
}

// SetFileAssocEnabled persists the file-association intent for one extension.
func (s *SettingsStore) SetFileAssocEnabled(ext string, enabled bool) error {
	return s.update(func(d *Settings) {
		if d.FileAssocEnabled == nil {
			d.FileAssocEnabled = map[string]bool{}
		}
		d.FileAssocEnabled[ext] = enabled
	})
}

func (s *SettingsStore) update(mutate func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Mutate a deep copy: on a write failure the in-memory state must stay
	// exactly as it was, including the association map.
	next := cloneSettings(s.data)
	mutate(&next)
	if err := fsutil.WriteJSONAtomic(s.path, next, 0o644); err != nil {
		return err
	}
	s.data = next
	return nil
}

func mergeDefaults(loaded Settings) Settings {
	out := Settings{Language: "zh", Theme: "system", DocumentTheme: "auto", AutoSaveDefault: true}
	if validLanguages[loaded.Language] {
		out.Language = loaded.Language
	}
	if validThemes[loaded.Theme] {
		out.Theme = loaded.Theme
	}
	if validDocumentThemes[loaded.DocumentTheme] {
		out.DocumentTheme = loaded.DocumentTheme
	}
	if loaded.AutoSaveDefault != out.AutoSaveDefault {
		out.AutoSaveDefault = loaded.AutoSaveDefault
	}
	if loaded.DefaultSaveDir != "" {
		out.DefaultSaveDir = loaded.DefaultSaveDir
	}
	if loaded.FileAssocEnabled != nil {
		out.FileAssocEnabled = cloneSettings(loaded).FileAssocEnabled
	}
	return out
}

func unmarshalSettings(raw []byte, dst *Settings) error {
	return json.Unmarshal(raw, dst)
}
