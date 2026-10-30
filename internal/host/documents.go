package host

import (
	"os"
	"path/filepath"
	"strings"
)

// DocumentEntry is one document row of the home lists (recents, starred and
// the files part of a folder listing). Its JSON shape is the renderer contract
// used by frontend/apps/shell/src/shared/home-api.ts.
type DocumentEntry struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Ext       string `json:"ext"`
	MtimeMs   int64  `json:"mtimeMs"`
	SizeBytes int64  `json:"sizeBytes"`
	Starred   bool   `json:"starred"`
	Group     string `json:"group,omitempty"`
	Missing   bool   `json:"missing,omitempty"`
}

// StatDocument builds a DocumentEntry for path, marking it missing when it can
// no longer be stat'd so the list still shows it like Word's recents do.
func StatDocument(path string) DocumentEntry {
	name := filepath.Base(path)
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	entry := DocumentEntry{
		Path: path,
		Name: name,
		Ext:  ext,
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		entry.Missing = true
		return entry
	}
	entry.MtimeMs = info.ModTime().UnixMilli()
	entry.SizeBytes = info.Size()
	return entry
}

// IsDocumentPath reports whether path has an extension the app can open.
func IsDocumentPath(path string) bool {
	_, ok := RouteByExt(path)
	return ok
}
