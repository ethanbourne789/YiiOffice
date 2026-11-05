package index

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeZip builds a container from name→content pairs. The fixtures are
// deliberately minimal: extraction only reads the text-bearing parts, so a
// full OOXML package (rels, content types) is not needed.
func writeZip(t *testing.T, path string, parts map[string]string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	// map iteration order is fine: part order comes from ooxmlParts, not zip
	for name, body := range parts {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestExtractDocxBody(t *testing.T) {
	path := filepath.Join(t.TempDir(), "quarterly.docx")
	writeZip(t, path, map[string]string{
		"word/document.xml": `<w:document xmlns:w="x"><w:body>
			<w:p><w:r><w:t>Quarterly revenue</w:t></w:r></w:p>
			<w:p><w:r><w:t>营收增长 12%</w:t></w:r></w:p>
		</w:body></w:document>`,
	})

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s (%v)", res.Kind, res.Error)
	}
	for _, want := range []string{"Quarterly revenue", "营收增长 12%"} {
		if !strings.Contains(res.Text, want) {
			t.Fatalf("body %q missing %q", res.Text, want)
		}
	}
	// Paragraph boundaries stay separate so snippets do not glue tokens.
	if !strings.Contains(res.Text, "revenue\n") && !strings.Contains(res.Text, "revenue ") {
		t.Fatalf("paragraph separator missing in %q", res.Text)
	}
}

func TestExtractPptxSlidesInOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "deck.pptx")
	slide := func(text string) string {
		return `<p:sld xmlns:a="a" xmlns:p="p"><a:t>` + text + `</a:t></p:sld>`
	}
	writeZip(t, path, map[string]string{
		"ppt/slides/slide1.xml":  slide("opening"),
		"ppt/slides/slide2.xml":  slide("second"),
		"ppt/slides/slide10.xml": slide("tenth"),
	})

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s", res.Kind)
	}
	// Numeric ordering: slide10 must not land between slide1 and slide2.
	opening := strings.Index(res.Text, "opening")
	second := strings.Index(res.Text, "second")
	tenth := strings.Index(res.Text, "tenth")
	if opening < 0 || second < 0 || tenth < 0 || opening > second || second > tenth {
		t.Fatalf("slides out of order: %q", res.Text)
	}
}

func TestExtractXlsxSharedStrings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.xlsx")
	writeZip(t, path, map[string]string{
		"xl/sharedStrings.xml": `<sst xmlns="x">
			<si><t>Revenue</t></si>
			<si><t>成本</t></si>
		</sst>`,
	})

	res := ExtractText(path)
	if res.Kind != "text" {
		t.Fatalf("expected kind=text, got %s", res.Kind)
	}
	if !strings.Contains(res.Text, "Revenue") || !strings.Contains(res.Text, "成本") {
		t.Fatalf("unexpected body %q", res.Text)
	}
}

func TestExtractXlsxInlineStringsFallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "inline.xlsx")
	writeZip(t, path, map[string]string{
		"xl/worksheets/sheet1.xml": `<worksheet xmlns="x"><sheetData><row r="1">
			<is><t>InlineCell</t></is></row></sheetData></worksheet>`,
	})

	res := ExtractText(path)
	if res.Kind != "text" || !strings.Contains(res.Text, "InlineCell") {
		t.Fatalf("expected inline string, got kind=%s body=%q", res.Kind, res.Text)
	}
}

func TestExtractOOXMLWithoutTextIsNameOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.docx")
	writeZip(t, path, map[string]string{
		"word/document.xml": `<w:document xmlns:w="x"><w:body></w:body></w:document>`,
		"docProps/app.xml":  `<Properties><Application>Word</Application></Properties>`,
	})

	res := ExtractText(path)
	if res.Kind != "name-only" {
		t.Fatalf("expected name-only for a text-less document, got %s", res.Kind)
	}
}

func TestExtractCorruptDocxIsNameOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.docx")
	if err := os.WriteFile(path, []byte("not a zip at all"), 0o644); err != nil {
		t.Fatal(err)
	}

	res := ExtractText(path)
	if res.Kind != "name-only" {
		t.Fatalf("expected name-only for an unreadable container, got %s", res.Kind)
	}
}
