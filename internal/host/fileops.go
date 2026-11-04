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
//
// Legacy 97-2003 binary formats (.doc/.xls/.ppt) are deliberately absent: none
// of the bundled editors can parse them, so routing them would only open a tab
// that immediately fails. Droppers report them through LegacyOfficeReplacement
// instead of silently pretending they can be opened.
func RouteByExt(path string) (TabKind, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".docx":
		return TabKindDocs, true
	case ".xlsx", ".xlsm", ".csv", ".tsv":
		return TabKindSheets, true
	case ".pptx":
		return TabKindSlides, true
	case ".pdf":
		return TabKindPDF, true
	case ".md", ".markdown", ".txt", ".json":
		return TabKindMarkdown, true
	}
	return "", false
}

// LegacyOfficeReplacement reports whether path is a legacy 97-2003 Office file
// and the modern extension it should be saved as before it can be opened.
func LegacyOfficeReplacement(path string) (string, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".doc":
		return ".docx", true
	case ".xls":
		return ".xlsx", true
	case ".ppt":
		return ".pptx", true
	}
	return "", false
}

func splitNameExt(name string) (string, string) {
	ext := filepath.Ext(name)
	return name[:len(name)-len(ext)], ext
}
