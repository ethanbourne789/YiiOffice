package index

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	// MaxExtractBytes is the maximum file size (in bytes) for extraction.
	MaxExtractBytes = 64 * 1024 * 1024
	// MaxBodyChars is the maximum number of runes extracted from a file.
	MaxBodyChars = 1_000_000
)

// plainTextExts are extensions that can be read as plain text.
var plainTextExts = map[string]struct{}{
	".txt": {}, ".md": {}, ".markdown": {}, ".csv": {}, ".tsv": {},
	".json": {}, ".xml": {}, ".html": {}, ".htm": {},
	".log": {}, ".ini": {}, ".cfg": {}, ".conf": {},
	".yaml": {}, ".yml": {}, ".toml": {},
	".js": {}, ".ts": {}, ".go": {}, ".py": {},
	".c": {}, ".h": {}, ".cpp": {}, ".java": {},
	".sql": {}, ".sh": {}, ".bat": {}, ".ps1": {},
}

// ExtractResult holds the outcome of text extraction.
type ExtractResult struct {
	Kind  string // "text", "name-only", "error"
	Text  string
	Error error
}

// ExtractText extracts searchable text from a file.
func ExtractText(path string) ExtractResult {
	info, err := os.Stat(path)
	if err != nil {
		return ExtractResult{Kind: "error", Error: err}
	}
	if info.IsDir() {
		return ExtractResult{Kind: "name-only"}
	}
	if info.Size() > MaxExtractBytes {
		return ExtractResult{Kind: "name-only"}
	}

	ext := strings.ToLower(filepath.Ext(path))
	if _, ok := plainTextExts[ext]; ok {
		return extractPlainText(path)
	}

	// Binary / OOXML / PDF: name-only for now.
	return ExtractResult{Kind: "name-only"}
}

func extractPlainText(path string) ExtractResult {
	data, err := os.ReadFile(path)
	if err != nil {
		return ExtractResult{Kind: "error", Error: err}
	}
	// Truncate to MaxBodyChars rune boundary
	runes := []rune(string(data))
	if len(runes) > MaxBodyChars {
		runes = runes[:MaxBodyChars]
	}
	return ExtractResult{Kind: "text", Text: string(runes)}
}
