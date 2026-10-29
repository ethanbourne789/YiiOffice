package bridge

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
)

func newTestSearchEnv(t *testing.T) (*Router, *index.FileIndexStore, *host.RecentManager) {
	t.Helper()

	rmDir := t.TempDir()
	rm := host.NewRecentManager(rmDir)

	r := NewRouter()
	idxLc, err := index.Init(t.TempDir(), []string{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { idxLc.Shutdown() })

	RegisterSearch(r, idxLc, rm)

	// Mark index as ready
	index.SetIndexStatus(true, "")

	return r, idxLc.Store(), rm
}

func callSearch(t *testing.T, r *Router, q FileSearchQuery) *FileSearchPage {
	t.Helper()
	raw, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.Invoke(context.Background(), ChannelSearchFiles, []json.RawMessage{raw})
	if err != nil {
		t.Fatalf("%v", err)
	}
	page, ok := result.(*FileSearchPage)
	if !ok {
		t.Fatalf("expected *FileSearchPage, got %T", result)
	}
	return page
}

func TestSearchReturnsUnavailableWhenIndexNotReady(t *testing.T) {
	index.SetIndexStatus(false, "initializing")
	defer index.SetIndexStatus(true, "")

	r := NewRouter()
	rm := host.NewRecentManager(t.TempDir())
	RegisterSearch(r, nil, rm)

	page := callSearch(t, r, FileSearchQuery{Q: "test"})
	if page.Unavailable == nil {
		t.Fatal("expected unavailable")
	}
	if page.Total != 0 {
		t.Fatal("expected 0 total")
	}
}

func TestSearchReturnsEmptyForNoMatch(t *testing.T) {
	r, _, _ := newTestSearchEnv(t)

	page := callSearch(t, r, FileSearchQuery{Q: "nonexistent"})
	if page.Total != 0 {
		t.Fatalf("expected 0, got %d", page.Total)
	}
	if page.Unavailable != nil {
		t.Fatal("should be available")
	}
}

func TestSearchFindsIndexedFiles(t *testing.T) {
	r, store, _ := newTestSearchEnv(t)

	// Create a test file and index it
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "hello world.docx")
	if err := os.WriteFile(testFile, []byte("dummy"), 0o644); err != nil {
		t.Fatal(err)
	}

	nameTokens := index.Tokenize("hello world.docx")
	pathTokens := index.Tokenize(tmpDir)
	filenameTokens := index.Tokenize("hello world.docx")
	pathTokens.Bi = append(pathTokens.Bi, filenameTokens.Bi...)
	pathTokens.Uni = append(pathTokens.Uni, filenameTokens.Uni...)

	status := index.IndexNameOnly
	if err := store.Upsert(testFile, "hello world.docx", "docx", 0, 5, status, nil,
		nameTokens.Bi, pathTokens.Bi, nil,
		nameTokens.Uni, pathTokens.Uni, nil); err != nil {
		t.Fatal(err)
	}

	page := callSearch(t, r, FileSearchQuery{Q: "hello"})
	if page.Total < 1 {
		t.Fatalf("expected at least 1 hit, got %d", page.Total)
	}
}

func TestSearchExtFamilyResolution(t *testing.T) {
	tests := []struct {
		ext  string
		want []string
	}{
		{"", nil},
		{"docx", []string{"docx", "doc"}},
		{"xlsx", []string{"xlsx", "xlsm", "xls", "csv", "tsv"}},
		{"pdf", []string{"pdf"}},
		{"unknown", []string{"unknown"}},
	}

	for _, tc := range tests {
		got := resolveExtFamily(tc.ext)
		if len(got) != len(tc.want) {
			t.Errorf("ext %q: got %v, want %v", tc.ext, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("ext %q: got %v, want %v", tc.ext, got, tc.want)
				break
			}
		}
	}
}

func TestSearchStarredFlag(t *testing.T) {
	r, store, rm := newTestSearchEnv(t)

	// Index a file
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "report.txt")
	if err := os.WriteFile(testFile, []byte("quarterly report"), 0o644); err != nil {
		t.Fatal(err)
	}

	nameTokens := index.Tokenize("report.txt")
	dirTokens := index.Tokenize(tmpDir)
	filenameTokens := index.Tokenize("report.txt")
	dirTokens.Bi = append(dirTokens.Bi, filenameTokens.Bi...)
	dirTokens.Uni = append(dirTokens.Uni, filenameTokens.Uni...)

	body := "quarterly report data"
	bodyTokens := index.Tokenize(body)

	if err := store.Upsert(testFile, "report.txt", "txt", 0, 20, index.IndexOK, &body,
		nameTokens.Bi, dirTokens.Bi, bodyTokens.Bi,
		nameTokens.Uni, dirTokens.Uni, bodyTokens.Uni); err != nil {
		t.Fatal(err)
	}

	// Search before starring
	page := callSearch(t, r, FileSearchQuery{Q: "report"})
	if len(page.Hits) > 0 && page.Hits[0].Starred {
		t.Fatal("should not be starred yet")
	}

	// Star the file
	rm.ToggleStar(testFile)

	// Search after starring
	page = callSearch(t, r, FileSearchQuery{Q: "report"})
	if len(page.Hits) > 0 && !page.Hits[0].Starred {
		t.Fatal("should be starred now")
	}
}
