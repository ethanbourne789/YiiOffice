package index

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	// MaxExtractBytes is the maximum file size (in bytes) for extraction.
	MaxExtractBytes = 64 * 1024 * 1024
	// MaxBodyChars is the maximum number of runes extracted from a file.
	MaxBodyChars = 1_000_000

	// maxPartBytes caps how much of a single OOXML part is tokenised. A
	// document.xml of a huge deck can be hundreds of MB uncompressed; the index
	// only needs the first MaxBodyChars of text, and a zip entry declares its
	// uncompressed size (a zip bomb), so the read is bounded here rather than
	// after allocation.
	maxPartBytes = 32 * 1024 * 1024
	// maxOOXMLParts bounds how many parts (slides) are read from one container.
	maxOOXMLParts = 200
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
	switch ext {
	case ".docx", ".docm", ".pptx", ".pptm", ".xlsx", ".xlsm":
		return extractOOXML(path, ext)
	}

	// PDF and legacy binary formats stay name-only: pdfcpu text extraction is a
	// page-by-page layout pass, far too costly to run across a whole tree.
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

// extractOOXML pulls the visible text out of a Word/PowerPoint/Excel container.
//
// Every OOXML text run lives in an element whose local name is "t" (w:t, a:t,
// t inside si/is), so one token walker serves all three formats. Until this
// existed the indexer stored only the file name for Office documents, which made
// full-text search useless for the formats this app actually edits.
func extractOOXML(path, ext string) ExtractResult {
	zr, err := zip.OpenReader(path)
	if err != nil {
		if errors.Is(err, zip.ErrFormat) {
			// Not actually a zip: a truncated download or a file that merely
			// carries an OOXML extension. Keep it searchable by name rather
			// than marking the row as failed.
			return ExtractResult{Kind: "name-only"}
		}
		return ExtractResult{Kind: "error", Error: err}
	}
	defer zr.Close()

	parts := ooxmlParts(zr, ext)
	if len(parts) == 0 {
		return ExtractResult{Kind: "name-only"}
	}
	var b strings.Builder
	// 4 bytes per rune is the UTF-8 upper bound, so this stops the walk once
	// there is more text than truncateRunes can keep — no need to count runes
	// per part (which would rebuild the whole string on every iteration).
	budget := MaxBodyChars * 4
	for _, name := range parts {
		if b.Len() >= budget {
			break
		}
		// A malformed part must not fail the whole document: index what parses.
		_ = appendXMLText(&b, zr, name)
	}
	body := truncateRunes(b.String(), MaxBodyChars)
	if strings.TrimSpace(body) == "" {
		return ExtractResult{Kind: "name-only"}
	}
	return ExtractResult{Kind: "text", Text: body}
}

// ooxmlParts lists the zip entries that carry user-visible text, in reading
// order.
func ooxmlParts(zr *zip.ReadCloser, ext string) []string {
	has := func(name string) bool {
		for _, f := range zr.File {
			if f.Name == name {
				return true
			}
		}
		return false
	}
	switch ext {
	case ".docx", ".docm":
		parts := []string{"word/document.xml"}
		for _, extra := range []string{"word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"} {
			if has(extra) {
				parts = append(parts, extra)
			}
		}
		return parts
	case ".pptx", ".pptm":
		slides := make([]string, 0, 32)
		for _, f := range zr.File {
			if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
				slides = append(slides, f.Name)
			}
		}
		// slide2.xml must sort before slide10.xml.
		sort.Slice(slides, func(i, j int) bool {
			return slideNumber(slides[i]) < slideNumber(slides[j])
		})
		if len(slides) > maxOOXMLParts {
			slides = slides[:maxOOXMLParts]
		}
		return slides
	case ".xlsx", ".xlsm":
		// Excel stores cell text in the shared string table; workbooks written
		// by other tools may use inline strings instead, so fall back to the
		// worksheets when the table is absent.
		if has("xl/sharedStrings.xml") {
			return []string{"xl/sharedStrings.xml"}
		}
		sheets := make([]string, 0, 16)
		for _, f := range zr.File {
			if strings.HasPrefix(f.Name, "xl/worksheets/sheet") && strings.HasSuffix(f.Name, ".xml") {
				sheets = append(sheets, f.Name)
			}
		}
		sort.Strings(sheets)
		if len(sheets) > maxOOXMLParts {
			sheets = sheets[:maxOOXMLParts]
		}
		return sheets
	}
	return nil
}

var slideNumRe = regexp.MustCompile(`(\d+)\.xml$`)

// slideNumber extracts the numeric suffix of a slide part name (0 when absent).
func slideNumber(name string) int {
	if m := slideNumRe.FindStringSubmatch(name); m != nil {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return n
		}
	}
	return 0
}

// appendXMLText walks one XML part and appends its text runs to b.
func appendXMLText(b *strings.Builder, zr *zip.ReadCloser, name string) error {
	f, err := zr.Open(name)
	if err != nil {
		return fmt.Errorf("open %s: %w", name, err)
	}
	defer f.Close()

	dec := xml.NewDecoder(io.LimitReader(f, maxPartBytes))
	inText := false
	for {
		tok, err := dec.Token()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			// Truncated part: keep whatever was decoded so far.
			return fmt.Errorf("decode %s: %w", name, err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				b.WriteByte('\t')
			case "br":
				b.WriteByte('\n')
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p", "row", "si", "tc":
				// Paragraph/cell boundary: keep tokens from gluing together.
				b.WriteByte('\n')
			}
		case xml.CharData:
			if inText {
				b.Write(t)
			}
		}
	}
}

// truncateRunes cuts s to at most limit runes without splitting a character.
func truncateRunes(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	count := 0
	for i := range s {
		if count == limit {
			return s[:i]
		}
		count++
	}
	return s
}
