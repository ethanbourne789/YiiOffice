package host

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// FileOps provides file operation utilities.
type FileOps struct{}

// Rename renames a file, returning the new path.
func (*FileOps) Rename(oldPath, newName string) (string, error) {
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		return "", fmt.Errorf("file not found: %s", oldPath)
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", fmt.Errorf("rename: %w", err)
	}
	return newPath, nil
}

// Duplicate duplicates a file with a "Copy of ..." prefix.
func (*FileOps) Duplicate(path string) (string, error) {
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	name, ext := splitNameExt(base)
	newName := fmt.Sprintf("Copy of %s%s", name, ext)
	newPath := filepath.Join(dir, newName)

	counter := 1
	for ; ; counter++ {
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			break
		}
		newName = fmt.Sprintf("Copy of %s (%d)%s", name, counter, ext)
		newPath = filepath.Join(dir, newName)
	}

	src, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open source: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(newPath)
	if err != nil {
		return "", fmt.Errorf("create dest: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(newPath)
		return "", fmt.Errorf("copy: %w", err)
	}
	return newPath, nil
}

// Delete deletes files. Returns list of failed paths.
func (*FileOps) Delete(paths []string) []string {
	failed := make([]string, 0)
	for _, p := range paths {
		if err := os.Remove(p); err != nil {
			failed = append(failed, p)
		}
	}
	return failed
}

// RouteByExt returns the TabKind for a file extension.
func RouteByExt(path string) (TabKind, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".docx", ".doc":
		return TabKindDocs, true
	case ".xlsx", ".xlsm", ".xls", ".csv", ".tsv":
		return TabKindSheets, true
	case ".pptx", ".ppt":
		return TabKindSlides, true
	case ".pdf":
		return TabKindPDF, true
	case ".md", ".markdown":
		return TabKindMarkdown, true
	}
	return "", false
}

func splitNameExt(name string) (string, string) {
	ext := filepath.Ext(name)
	return name[:len(name)-len(ext)], ext
}
