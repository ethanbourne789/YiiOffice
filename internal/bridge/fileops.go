package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// atomicSaveBytes atomically writes data to path via a temp-file + rename
// sequence. Creates the parent directory if it does not exist. The optional
// callback is invoked on success (after the rename).
func atomicSaveBytes(path string, data []byte, fn func()) error {
	dir := filepath.Dir(path)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create directory: %w", err)
		}
	}
	tmp, err := os.CreateTemp(dir, "*.tmp")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename: %w", err)
	}
	if fn != nil {
		fn()
	}
	return nil
}

// atomicBase64Save decodes base64 content then atomically writes it to path
// (temp file + rename). Creates the parent directory if missing. The optional
// callback is invoked on success.
func atomicBase64Save(path, content string, fn func()) error {
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return fmt.Errorf("decode content: %w", err)
	}
	return atomicSaveBytes(path, data, fn)
}
