package index

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// benchCorpus builds a ~1 MB mixed CJK/ASCII body. The needle "the" is
// deliberately common: it is what turned the old byte-by-byte matcher into an
// O(n²) walk (every hit rescanned the prefix to convert bytes to runes).
func benchCorpus() string {
	unit := "季度报表显示营收增长明显，the quick brown fox jumps over the lazy dog。"
	var b strings.Builder
	for b.Len() < 1<<20 {
		b.WriteString(unit)
	}
	return b.String()
}

func BenchmarkBuildExcerpt(b *testing.B) {
	text := benchCorpus()
	needles := []string{"the", "营收", "报表"}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if got := BuildExcerpt(text, needles, 200); got == "" {
			b.Fatal("expected a match")
		}
	}
}

func BenchmarkFindTextRangesInRunes(b *testing.B) {
	lower := []rune(strings.ToLower(benchCorpus()))
	needles := []string{"the", "营收", "报表"}
	b.ReportAllocs()
	b.ResetTimer()
	var hits int
	for i := 0; i < b.N; i++ {
		hits = len(findTextRangesInRunes(lower, needles))
	}
	if hits == 0 {
		b.Fatal("expected hits")
	}
}

// benchIndexCorpus writes n docx files into dir. Each holds a body large enough
// to make extraction cost visible (about 40 paragraphs) while staying small
// enough that the per-file fsync of the index write stays in the same order of
// magnitude — which is the point: the scan is measured as a whole, so a change
// that only speeds up extraction will not show up as a win if the writes dominate.
func benchIndexCorpus(b *testing.B, dir string, n int) {
	b.Helper()
	var body strings.Builder
	body.WriteString(`<w:document xmlns:w="x"><w:body>`)
	for p := 0; p < 40; p++ {
		body.WriteString(`<w:p><w:r><w:t>季度报表显示营收增长明显 the quick brown fox jumps over the lazy dog</w:t></w:r></w:p>`)
	}
	body.WriteString(`</w:body></w:document>`)
	doc := body.String()

	for i := 0; i < n; i++ {
		path := filepath.Join(dir, fmt.Sprintf("doc-%03d.docx", i))
		f, err := os.Create(path)
		if err != nil {
			b.Fatal(err)
		}
		zw := zip.NewWriter(f)
		w, err := zw.Create("word/document.xml")
		if err != nil {
			b.Fatal(err)
		}
		if _, err := w.Write([]byte(doc)); err != nil {
			b.Fatal(err)
		}
		if err := zw.Close(); err != nil {
			b.Fatal(err)
		}
		if err := f.Close(); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkIndexScan measures a full first scan: walk, diff, extract, tokenize
// and one index write per file. Fixture creation is excluded from the timing.
func BenchmarkIndexScan(b *testing.B) {
	const files = 200
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		docsDir := b.TempDir()
		dbDir := b.TempDir()
		benchIndexCorpus(b, docsDir, files)
		store, err := NewFileIndexStore(filepath.Join(dbDir, "index.db"))
		if err != nil {
			b.Fatal(err)
		}
		ix := NewFileIndexer(store, []string{docsDir})
		b.StartTimer()

		ix.RunOnce()

		b.StopTimer()
		if pending, _ := ix.Status(); pending != 0 {
			b.Fatalf("scan left %d files pending", pending)
		}
		if err := store.Close(); err != nil {
			b.Fatal(err)
		}
	}
}
