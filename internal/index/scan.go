package index

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

const (
	// ScanMaxDepth is the maximum directory nesting depth.
	ScanMaxDepth = 32
	// ScanMaxFiles is the maximum number of files returned per scan.
	ScanMaxFiles = 200000
)

// ScannedFile is a file found on disk during a scan.
type ScannedFile struct {
	Path      string
	MtimeMs   int64
	SizeBytes int64
}

// ScanResult holds the output of a directory scan.
type ScanResult struct {
	Files     []ScannedFile
	Truncated bool
}

// supportedExts is the set of file extensions that should be indexed.
var supportedExts = map[string]struct{}{
	".docx": {}, ".doc": {},
	".xlsx": {}, ".xls": {}, ".xlsm": {}, ".csv": {}, ".tsv": {},
	".pptx": {}, ".ppt": {}, ".pptm": {},
	".pdf":  {},
	".md":   {}, ".markdown": {},
	".txt":  {}, ".text": {},
	".rtf":  {},
	".html": {}, ".htm": {},
	".json": {}, ".xml": {},
}

// ScanDir recursively scans a directory and returns all indexable files.
func ScanDir(root string) ScanResult {
	result := ScanResult{}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return result
	}

	var scanRecursive func(dir string, depth int) bool
	scanRecursive = func(dir string, depth int) bool {
		if depth > ScanMaxDepth {
			return false
		}
		if len(result.Files) >= ScanMaxFiles {
			result.Truncated = true
			return true // stop
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			return false
		}

		for _, entry := range entries {
			if len(result.Files) >= ScanMaxFiles {
				result.Truncated = true
				return true
			}

			// Skip hidden files/dirs on Windows
			if isHidden(dir, entry.Name()) {
				continue
			}

			fullPath := filepath.Join(dir, entry.Name())

			if entry.IsDir() {
				// Skip symlinks
				info, err := entry.Info()
				if err == nil && info.Mode()&os.ModeSymlink != 0 {
					continue
				}
				if scanRecursive(fullPath, depth+1) {
					return true
				}
			} else {
				// Check supported extension
				ext := strings.ToLower(filepath.Ext(entry.Name()))
				if _, ok := supportedExts[ext]; ok {
					info, err := entry.Info()
					if err != nil {
						continue
					}
					result.Files = append(result.Files, ScannedFile{
						Path:      fullPath,
						MtimeMs:   info.ModTime().UnixMilli(),
						SizeBytes: info.Size(),
					})
				}
			}
		}
		return false
	}

	scanRecursive(absRoot, 0)
	return result
}

// isHidden checks if a file/directory is hidden on Windows.
func isHidden(dir string, name string) bool {
	fullPath := filepath.Join(dir, name)
	utf16Path, err := windows.UTF16PtrFromString(fullPath)
	if err != nil {
		return false
	}
	attrs, err := windows.GetFileAttributes(utf16Path)
	if err != nil {
		return false
	}
	return (attrs & windows.FILE_ATTRIBUTE_HIDDEN) != 0
}
