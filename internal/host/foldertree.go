package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

// FolderRoot is a row of the home sidebar tree. The default save folder is
// always the first row and cannot be removed; folder rows added by the user
// follow it. The JSON shape matches frontend/apps/shell/src/shared/home-api.ts.
type FolderRoot struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Usable    bool   `json:"usable"`
	Readable  bool   `json:"readable"`
	Removable bool   `json:"removable"`
}

// FolderEntry is a sub-folder row of a folder listing.
type FolderEntry struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// MtimeMs drives nothing today but keeps the row shape uniform.
	MtimeMs int64 `json:"mtimeMs"`
	// HasSubfolders drives the expand chevron.
	HasSubfolders bool `json:"hasSubfolders"`
}

// FolderListing is one directory of the tree: its sub-folders and the
// document files sitting directly inside it.
type FolderListing struct {
	Dir     string        `json:"dir"`
	Folders []FolderEntry `json:"folders"`
	Files   []DocumentEntry `json:"files"`
	// Missing is set when the directory could not be read (deleted, moved or
	// on a disconnected drive).
	Missing bool `json:"missing,omitempty"`
}

// folderRootRecord is the persisted form of a user-added root.
type folderRootRecord struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

// FolderManager handles folder tree operations.
type FolderManager struct {
	mu         sync.RWMutex
	dataDir    string
	rootsFile  string
	added      []folderRootRecord
	defaultDir func() string
}

// NewFolderManager creates a folder manager that stores added roots in dataDir.
// defaultDir resolves the default save folder; nil falls back to
// <Documents>/YiiOffice.
func NewFolderManager(dataDir string, defaultDir func() string) *FolderManager {
	fm := &FolderManager{
		dataDir:    dataDir,
		rootsFile:  filepath.Join(dataDir, "folder-roots.json"),
		defaultDir: defaultDir,
	}
	fm.loadRoots()
	return fm
}

func (fm *FolderManager) loadRoots() {
	fm.mu.Lock()
	defer fm.mu.Unlock()
	raw, err := os.ReadFile(fm.rootsFile)
	if err == nil {
		if err := json.Unmarshal(raw, &fm.added); err != nil {
			fmt.Printf("error unmarshaling folder roots: %v\n", err)
		}
	}
	if fm.added == nil {
		fm.added = make([]folderRootRecord, 0)
	}
}

func (fm *FolderManager) saveRoots() {
	if err := fsutil.WriteJSONAtomic(fm.rootsFile, fm.added, 0o644); err != nil {
		fmt.Printf("error saving folder roots: %v\n", err)
	}
}

// defaultRootPath resolves the default save folder, creating it when the
// configured folder or the Documents fallback is missing.
func (fm *FolderManager) defaultRootPath() string {
	if fm.defaultDir != nil {
		if dir := strings.TrimSpace(fm.defaultDir()); dir != "" {
			return dir
		}
	}
	docs, err := DocumentsDir()
	if err != nil {
		return ""
	}
	return filepath.Join(docs, "YiiOffice")
}

// GetRoots returns the tree rows: the default save folder first, then every
// folder the user added.
func (fm *FolderManager) GetRoots() []FolderRoot {
	fm.mu.RLock()
	added := make([]folderRootRecord, len(fm.added))
	copy(added, fm.added)
	fm.mu.RUnlock()
	roots := make([]FolderRoot, 0, len(added)+1)
	if def := fm.defaultRootPath(); def != "" {
		roots = append(roots, rootRow(def, false))
	}
	for _, r := range added {
		roots = append(roots, rootRow(r.Path, true))
	}
	return roots
}

// rootRow builds a tree row, probing the folder on disk.
func rootRow(path string, removable bool) FolderRoot {
	row := FolderRoot{
		Path:      path,
		Name:      filepath.Base(path),
		Removable: removable,
	}
	if row.Name == "" || row.Name == "." || row.Name == string(os.PathSeparator) {
		row.Name = path
	}

	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		// A missing default folder is re-created so the tree stays usable;
		// an added folder that vanished is reported as unusable instead.
		if !removable {
			if mkErr := os.MkdirAll(path, 0o755); mkErr != nil {
				return row
			}
		} else {
			return row
		}
	} else if _, err := os.ReadDir(path); err != nil {
		// Exists but cannot be listed (permissions, disconnected drive).
		if !removable {
			row.Usable = info.Mode().Perm()&0o200 != 0
		}
		return row
	}

	row.Usable = true
	row.Readable = true
	return row
}

// AddRoot adds a new folder root.
func (fm *FolderManager) AddRoot(path string, label string) {
	if _, err := os.Stat(path); err != nil {
		return
	}
	fm.mu.Lock()
	if fm.hasPathLocked(path) {
		fm.mu.Unlock()
		return
	}
	if label == "" {
		label = filepath.Base(path)
	}
	fm.added = append(fm.added, folderRootRecord{Path: path, Label: label})
	fm.saveRoots()
	fm.mu.Unlock()
}

// hasPath reports whether path is already the default root or an added root.
func (fm *FolderManager) hasPath(path string) bool {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	return fm.hasPathLocked(path)
}

// hasPathLocked checks if path exists; caller must hold fm.mu.
func (fm *FolderManager) hasPathLocked(path string) bool {
	if def := fm.defaultRootPath(); def != "" && strings.EqualFold(def, path) {
		return true
	}
	for _, r := range fm.added {
		if strings.EqualFold(r.Path, path) {
			return true
		}
	}
	return false
}

// FindRoot returns the tree row for an added or default root path.
func (fm *FolderManager) FindRoot(path string) (FolderRoot, bool) {
	for _, r := range fm.GetRoots() {
		if strings.EqualFold(r.Path, path) {
			return r, true
		}
	}
	return FolderRoot{}, false
}

// RootPaths returns the paths of every root (used for the search index).
func (fm *FolderManager) RootPaths() []string {
	roots := fm.GetRoots()
	out := make([]string, 0, len(roots))
	for _, r := range roots {
		out = append(out, r.Path)
	}
	return out
}

// RemoveRoot removes a folder root by path. The default root is ignored.
func (fm *FolderManager) RemoveRoot(path string) {
	fm.mu.Lock()
	found := false
	for i, r := range fm.added {
		if strings.EqualFold(r.Path, path) {
			fm.added = append(fm.added[:i], fm.added[i+1:]...)
			found = true
			break
		}
	}
	if found {
		fm.saveRoots()
	}
	fm.mu.Unlock()
}

// ListFolder lists the contents of a directory.
func (fm *FolderManager) ListFolder(path string) (FolderListing, error) {
	listing := FolderListing{Dir: path, Folders: []FolderEntry{}, Files: []DocumentEntry{}}
	entries, err := os.ReadDir(path)
	if err != nil {
		listing.Missing = true
		return listing, fmt.Errorf("list folder: %w", err)
	}

	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(path, name)
		info, err := e.Info()
		if err != nil {
			continue
		}
		if e.IsDir() {
			listing.Folders = append(listing.Folders, FolderEntry{
				Path:          full,
				Name:          name,
				MtimeMs:       info.ModTime().UnixMilli(),
				HasSubfolders: hasVisibleSubfolder(full),
			})
			continue
		}
		if !IsDocumentPath(name) {
			continue
		}
		listing.Files = append(listing.Files, DocumentEntry{
			Path:      full,
			Name:      name,
			Ext:       strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")),
			MtimeMs:   info.ModTime().UnixMilli(),
			SizeBytes: info.Size(),
			Starred:   false,
		})
	}

	sort.Slice(listing.Folders, func(i, j int) bool {
		return strings.ToLower(listing.Folders[i].Name) < strings.ToLower(listing.Folders[j].Name)
	})
	// Newest first, like the home recents list.
	sort.Slice(listing.Files, func(i, j int) bool {
		return listing.Files[i].MtimeMs > listing.Files[j].MtimeMs
	})
	return listing, nil
}

// hasVisibleSubfolder reports whether dir holds at least one non-hidden
// sub-directory (the tree's chevron only expands when there is something to show).
func hasVisibleSubfolder(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			return true
		}
	}
	return false
}

// CreateFolder creates a new directory.
func (fm *FolderManager) CreateFolder(parentPath, name string) error {
	path := filepath.Join(parentPath, name)
	if err := os.Mkdir(path, 0o755); err != nil {
		return fmt.Errorf("create folder: %w", err)
	}
	return nil
}

// RenameFolder renames a directory.
func (fm *FolderManager) RenameFolder(oldPath, newName string) error {
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if err := os.Rename(oldPath, newPath); err != nil {
		return fmt.Errorf("rename folder: %w", err)
	}
	return nil
}

// MovePaths moves files/folders to a destination directory.
func (fm *FolderManager) MovePaths(paths []string, destDir string) []string {
	failed := make([]string, 0)
	for _, p := range paths {
		dest := filepath.Join(destDir, filepath.Base(p))
		if err := os.Rename(p, dest); err != nil {
			failed = append(failed, p)
		}
	}
	return failed
}

// DeleteFolder deletes a directory and its contents.
func (fm *FolderManager) DeleteFolder(path string) error {
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	return nil
}
