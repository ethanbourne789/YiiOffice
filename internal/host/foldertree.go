package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FolderRoot represents a user-added folder root in the sidebar.
type FolderRoot struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

// FolderEntry is a single item in a folder listing.
type FolderEntry struct {
	Name     string `json:"name"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

// FolderManager handles folder tree operations.
type FolderManager struct {
	dataDir   string
	rootsFile string
	roots     []FolderRoot
}

// NewFolderManager creates a folder manager that stores roots in dataDir.
func NewFolderManager(dataDir string) *FolderManager {
	fm := &FolderManager{
		dataDir:   dataDir,
		rootsFile: filepath.Join(dataDir, "folder-roots.json"),
	}
	fm.loadRoots()
	return fm
}

func (fm *FolderManager) loadRoots() {
	raw, err := os.ReadFile(fm.rootsFile)
	if err == nil {
		json.Unmarshal(raw, &fm.roots)
	}
	if fm.roots == nil {
		fm.roots = make([]FolderRoot, 0)
	}
	// Add default: Documents/YiiOffice
	if home, err := os.UserHomeDir(); err == nil {
		defaultRoot := filepath.Join(home, "Documents", "YiiOffice")
		found := false
		for _, r := range fm.roots {
			if strings.EqualFold(r.Path, defaultRoot) {
				found = true
				break
			}
		}
		if !found {
			fm.roots = append(fm.roots, FolderRoot{Path: defaultRoot, Label: "YiiOffice"})
		}
	}
}

func (fm *FolderManager) saveRoots() {
	data, _ := json.MarshalIndent(fm.roots, "", "  ")
	os.WriteFile(fm.rootsFile, append(data, '\n'), 0o644)
}

// GetRoots returns the current folder roots.
func (fm *FolderManager) GetRoots() []FolderRoot {
	return fm.roots
}

// AddRoot adds a new folder root.
func (fm *FolderManager) AddRoot(path string, label string) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return
	}
	for _, r := range fm.roots {
		if strings.EqualFold(r.Path, path) {
			return
		}
	}
	if label == "" {
		label = filepath.Base(path)
	}
	fm.roots = append(fm.roots, FolderRoot{Path: path, Label: label})
	fm.saveRoots()
}

// RemoveRoot removes a folder root by path.
func (fm *FolderManager) RemoveRoot(path string) {
	for i, r := range fm.roots {
		if strings.EqualFold(r.Path, path) {
			fm.roots = append(fm.roots[:i], fm.roots[i+1:]...)
			break
		}
	}
	fm.saveRoots()
}

// ListFolder lists the contents of a directory.
func (fm *FolderManager) ListFolder(path string) ([]FolderEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("list folder: %w", err)
	}
	result := make([]FolderEntry, 0, len(entries))
	for _, e := range entries {
		info := FolderEntry{Name: e.Name(), IsDir: e.IsDir()}
		stat, err := e.Info()
		if err == nil {
			info.Size = stat.Size()
			info.Modified = stat.ModTime().UnixMilli()
		}
		result = append(result, info)
	}
	// Sort: directories first, then alphabetically
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
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
