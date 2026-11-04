package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
)

func newTestHomeService(t *testing.T, dataDir string) *HomeService {
	t.Helper()
	store, err := host.NewSettingsStore(dataDir)
	if err != nil {
		t.Fatalf("failed to create settings store: %v", err)
	}
	rm := host.NewRecentManager(dataDir)
	fm := host.NewFolderManager(dataDir, func() string { return filepath.Join(dataDir, "Documents") })
	th := host.NewTabHost()
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}

	return NewHomeService(
		"1.0.0", store, rm, fm, th, fo, dam,
		nil, // idxLc
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil },
	)
}

func TestHomeServiceGetAppVersion(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	version := svc.GetAppVersion()
	if version != "1.0.0" {
		t.Fatalf("expected version 1.0.0, got %s", version)
	}
}

func TestHomeServiceGetLanguage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	lang := svc.GetLanguage()
	if lang != "zh" {
		t.Fatalf("expected default language zh, got %s", lang)
	}
}

func TestHomeServiceSetLanguage(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetLanguage("en")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if svc.GetLanguage() != "en" {
		t.Fatalf("expected language en, got %s", svc.GetLanguage())
	}
}

func TestHomeServiceSetLanguageInvalid(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetLanguage("fr")
	if err == nil {
		t.Fatal("expected error for invalid language")
	}
}

func TestHomeServiceGetTheme(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	theme := svc.GetTheme()
	if theme != "system" {
		t.Fatalf("expected default theme system, got %s", theme)
	}
}

func TestHomeServiceSetTheme(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetTheme("dark")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if svc.GetTheme() != "dark" {
		t.Fatalf("expected theme dark, got %s", svc.GetTheme())
	}
}

func TestHomeServiceSetThemeInvalid(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetTheme("purple")
	if err == nil {
		t.Fatal("expected error for invalid theme")
	}
}

func TestHomeServiceGetDocumentTheme(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	theme := svc.GetDocumentTheme()
	if theme != "auto" {
		t.Fatalf("expected default document theme auto, got %s", theme)
	}
}

func TestHomeServiceSetDocumentTheme(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetDocumentTheme("light")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if svc.GetDocumentTheme() != "light" {
		t.Fatalf("expected document theme light, got %s", svc.GetDocumentTheme())
	}
}

func TestHomeServiceSetDocumentThemeInvalid(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetDocumentTheme("neon")
	if err == nil {
		t.Fatal("expected error for invalid document theme")
	}
}

func TestHomeServiceGetAutoSaveDefault(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	status := svc.GetAutoSaveDefault()
	if !status.On {
		t.Fatal("expected auto save default to be true")
	}
}

func TestHomeServiceSetAutoSaveDefault(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	err := svc.SetAutoSaveDefault(false)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	status := svc.GetAutoSaveDefault()
	if status.On {
		t.Fatal("expected auto save default to be false")
	}
	if status.UpdatedAt == 0 {
		t.Fatal("expected updatedAt to be set after SetAutoSaveDefault")
	}
}

func TestHomeServiceGetDefaultSaveDir(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Before the user picks a folder the contract falls back to Documents/YiiOffice.
	docs, err := host.DocumentsDir()
	if err != nil {
		t.Skip("no documents dir")
	}
	want := filepath.Join(docs, "YiiOffice")
	if dir := svc.GetDefaultSaveDir(); dir != want {
		t.Fatalf("expected fallback %q, got %q", want, dir)
	}
}

func TestHomeServiceRecents(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	page := svc.Recents(RecentPageQuery{Limit: 50})
	if page.Total != 0 || page.TotalAll != 0 || len(page.Entries) != 0 {
		t.Fatalf("expected an empty first page, got %+v", page)
	}
}

func TestHomeServiceRemoveRecent(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Should not panic even with empty recent list
	svc.RemoveRecent("/nonexistent/path")
}

func TestHomeServiceStarred(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	starred := svc.Starred()
	if starred == nil {
		t.Fatal("expected non-nil starred (empty)")
	}
}

func TestHomeServiceFolderRoots(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	roots := svc.FolderRoots()
	if len(roots) == 0 {
		t.Fatal("expected the default save folder row")
	}
	if !roots[0].Usable || !roots[0].Readable {
		t.Fatalf("default row must be usable, got %+v", roots[0])
	}
	if roots[0].Removable {
		t.Fatal("the default save folder cannot be removed")
	}
}

func TestHomeServiceListFolder(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	if err := os.MkdirAll(filepath.Join(tmp, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "doc.docx"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	listing := svc.ListFolder(tmp)
	if listing.Dir != tmp {
		t.Fatalf("dir = %q", listing.Dir)
	}
	if len(listing.Folders) != 1 || listing.Folders[0].Name != "sub" {
		t.Fatalf("folders = %+v", listing.Folders)
	}
	if len(listing.Files) != 1 || listing.Files[0].Ext != "docx" {
		t.Fatalf("files = %+v", listing.Files)
	}
}

func TestHomeServiceListFolderMissing(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	listing := svc.ListFolder(filepath.Join(tmp, "gone"))
	if !listing.Missing {
		t.Fatal("a vanished folder must be reported as missing")
	}
}

func TestHomeServiceToggleStar(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	testPath := "/fake/path.docx"

	// First toggle should star (return true)
	result := svc.ToggleStar(testPath)
	if !result {
		t.Fatal("expected first toggle to return true (star)")
	}

	// Second toggle should unstar (return false)
	result = svc.ToggleStar(testPath)
	if result {
		t.Fatal("expected second toggle to return false (unstar)")
	}
}

func TestHomeServiceUnstarPaths(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Star a path first
	testPath := "/fake/path.docx"
	svc.ToggleStar(testPath)

	// Unstar it
	svc.UnstarPaths([]string{testPath})

	starred := svc.Starred()
	for _, s := range starred {
		if s.Path == testPath {
			t.Fatal("expected path to be unstarred")
		}
	}
}

func TestHomeServiceStatPaths(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Create a real file for testing
	testFile := filepath.Join(tmp, "test.txt")
	if err := os.WriteFile(testFile, []byte("hello"), 0o644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	stats := svc.StatPaths([]string{testFile, "/nonexistent"})
	if len(stats) != 2 {
		t.Fatalf("expected 2 stats, got %d", len(stats))
	}

	if !stats[0].Available {
		t.Fatal("expected first path to be available")
	}
	if stats[0].Size <= 0 {
		t.Fatal("expected positive file size")
	}

	if stats[1].Available {
		t.Fatal("expected second path to not be available")
	}
}

func TestHomeServiceNewDocument(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	initialCount := len(th.List())

	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	svc.NewDocument()

	if len(th.List()) != initialCount+1 {
		t.Fatalf("expected one more tab, got %d tabs", len(th.List()))
	}
	last := th.List()[len(th.List())-1]
	if last.Kind != host.TabKindDocs {
		t.Fatalf("expected docs tab kind, got %s", last.Kind)
	}
	if last.Title != "Untitled Document" {
		t.Fatalf("expected title 'Untitled Document', got %s", last.Title)
	}
}

func TestHomeServiceNewSheet(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	svc.NewSheet()
	last := th.List()[len(th.List())-1]
	if last.Kind != host.TabKindSheets {
		t.Fatalf("expected sheets tab kind, got %s", last.Kind)
	}
}

func TestHomeServiceNewSlide(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	svc.NewSlide()
	last := th.List()[len(th.List())-1]
	if last.Kind != host.TabKindSlides {
		t.Fatalf("expected slides tab kind, got %s", last.Kind)
	}
}

func TestHomeServiceNewMarkdown(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	svc.NewMarkdown()
	last := th.List()[len(th.List())-1]
	if last.Kind != host.TabKindMarkdown {
		t.Fatalf("expected markdown tab kind, got %s", last.Kind)
	}
}

func TestHomeServiceNewPdf(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	svc.NewPdf()
	last := th.List()[len(th.List())-1]
	if last.Kind != host.TabKindPDF {
		t.Fatalf("expected pdf tab kind, got %s", last.Kind)
	}
}

func TestHomeServiceOpenPathRoutesByExtension(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	tests := []struct {
		ext      string
		wantKind host.TabKind
	}{
		{".docx", host.TabKindDocs},
		{".doc", host.TabKindDocs},
		{".xlsx", host.TabKindSheets},
		{".xls", host.TabKindSheets},
		{".csv", host.TabKindSheets},
		{".tsv", host.TabKindSheets},
		{".pptx", host.TabKindSlides},
		{".ppt", host.TabKindSlides},
		{".pdf", host.TabKindPDF},
		{".md", host.TabKindMarkdown},
		{".markdown", host.TabKindMarkdown},
	}

	for _, tc := range tests {
		t.Run(tc.ext, func(t *testing.T) {
			testFile := filepath.Join(tmp, "test"+tc.ext)
			if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
				t.Fatalf("failed to create test file: %v", err)
			}

			err := svc.OpenPath(testFile)
			if err != nil {
				t.Fatalf("expected no error for ext %s, got %v", tc.ext, err)
			}

			last := th.List()[len(th.List())-1]
			if last.Kind != tc.wantKind {
				t.Fatalf("expected kind %s for ext %s, got %s", tc.wantKind, tc.ext, last.Kind)
			}

			// Reset for next test
			th.CloseTab(last.ID)
		})
	}
}

func TestHomeServiceOpenPathUnsupportedExtension(t *testing.T) {
	tmp := t.TempDir()
	th := host.NewTabHost()
	store, _ := host.NewSettingsStore(tmp)
	rm := host.NewRecentManager(tmp)
	fm := host.NewFolderManager(tmp, func() string { return filepath.Join(tmp, "Documents") })
	fo := &host.FileOps{}
	dam := &host.DefaultAppManager{}
	svc := NewHomeService("1.0.0", store, rm, fm, th, fo, dam, nil,
		func() ([]string, error) { return nil, nil },
		func(string) error { return nil })

	err := svc.OpenPath("/path/to/file.xyz")
	if err == nil {
		t.Fatal("expected error for unsupported extension")
	}
}

func TestHomeServiceAddFolderRoot(t *testing.T) {
	tmp := t.TempDir()
	extra := t.TempDir()
	svc := newTestHomeService(t, tmp)

	initialCount := len(svc.FolderRoots())
	svc.fm.AddRoot(extra, "")

	if len(svc.FolderRoots()) <= initialCount {
		t.Fatal("expected at least one more root after adding")
	}
}

func TestHomeServiceRemoveFolderRoot(t *testing.T) {
	tmp := t.TempDir()
	extra := t.TempDir()
	svc := newTestHomeService(t, tmp)

	svc.fm.AddRoot(extra, "")
	initialCount := len(svc.FolderRoots())

	svc.RemoveFolderRoot(extra)
	if len(svc.FolderRoots()) >= initialCount {
		t.Fatal("expected one less root after removing")
	}
}

func TestHomeServiceRenameFile(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	testFile := filepath.Join(tmp, "old.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	result := svc.RenameFile(testFile, "new.txt")
	if !result.OK {
		t.Fatalf("expected ok, got error: %s", result.Error)
	}
	expectedPath := filepath.Join(tmp, "new.txt")
	if result.Path != expectedPath {
		t.Fatalf("expected path %s, got %s", expectedPath, result.Path)
	}
	if _, err := os.Stat(result.Path); os.IsNotExist(err) {
		t.Fatal("expected renamed file to exist")
	}
}

func TestHomeServiceDuplicateFile(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	testFile := filepath.Join(tmp, "original.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	newPath, err := svc.DuplicateFile(testFile)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if newPath == testFile {
		t.Fatal("expected different path for duplicate")
	}
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		t.Fatal("expected duplicated file to exist")
	}
}

func TestHomeServiceDeleteFiles(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	testFile := filepath.Join(tmp, "delete_me.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	failed := svc.DeleteFiles([]string{testFile, "/nonexistent"})
	if len(failed) != 1 {
		t.Fatalf("expected 1 failed deletion, got %d", len(failed))
	}
	if failed[0] != "/nonexistent" {
		t.Fatalf("expected /nonexistent to fail, got %s", failed[0])
	}
	if _, err := os.Stat(testFile); !os.IsNotExist(err) {
		t.Fatal("expected file to be deleted")
	}
}

func TestHomeServiceGetDefaultAppStatus(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	status := svc.GetDefaultAppStatus()
	if status == nil {
		t.Fatal("expected non-nil status map")
	}
	// Should have entries for common extensions
	if len(status) == 0 {
		t.Fatal("expected at least one status entry")
	}
}

func TestHomeServiceSearchFilesWithNilIndex(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Set index status to not ready
	index.SetIndexStatus(false, "sidecar not running")
	defer index.SetIndexStatus(false, "") // restore

	page, err := svc.SearchFiles(FileSearchQuery{Q: "test"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if page.Unavailable == nil {
		t.Fatal("expected unavailable reason when index is not ready")
	}
	if page.Unavailable.Reason != "sidecar not running" {
		t.Fatalf("expected reason 'sidecar not running', got %s", page.Unavailable.Reason)
	}
}

func TestHomeServiceSearchFilesWithReadyIndexButNilLifecycle(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Set index status to ready, but idxLc is nil
	index.SetIndexStatus(true, "")
	defer index.SetIndexStatus(false, "")

	page, err := svc.SearchFiles(FileSearchQuery{Q: "test"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if page.Unavailable == nil {
		t.Fatal("expected unavailable reason when idxLc is nil")
	}
	if page.Unavailable.Reason != "index not initialized" {
		t.Fatalf("expected reason 'index not initialized', got %s", page.Unavailable.Reason)
	}
}

// waitForIndexHits polls store.Search until the query has want hits.
func waitForIndexHits(t *testing.T, store *index.FileIndexStore, q string, want int) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		res, err := store.Search(q, index.SearchOptions{})
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if res.Total == want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %q to have %d hits", q, want)
}

// TestHomeServiceRecentsCursorPaging follows the cursor to the end of a list
// larger than the old 200-entry cap and requires every row exactly once.
func TestHomeServiceRecentsCursorPaging(t *testing.T) {
	dir := t.TempDir()
	rm := host.NewRecentManager(dir)
	for i := 0; i < 320; i++ {
		rm.AddRecent(fmt.Sprintf(`c:\recents\file-%03d.docx`, i))
	}
	svc := NewHomeService("test", nil, rm, nil, nil, nil, nil, nil, nil, nil)

	seen := make(map[string]bool, 320)
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > 20 {
			t.Fatal("cursor paging did not terminate")
		}
		page := svc.Recents(RecentPageQuery{Cursor: cursor, Limit: 40})
		if page.TotalAll != 320 || page.Total != 320 {
			t.Fatalf("counters drifted: total=%d totalAll=%d", page.Total, page.TotalAll)
		}
		for _, e := range page.Entries {
			if seen[e.Path] {
				t.Fatalf("duplicate row %q", e.Path)
			}
			seen[e.Path] = true
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != 320 {
		t.Fatalf("expected all 320 rows, got %d", len(seen))
	}
}

// TestHomeServiceRecentsCursorStableOnInsert pins the cursor contract: a file
// opened while the user is scrolled must not shift the next page, which is the
// failure mode of offset paging.
func TestHomeServiceRecentsCursorStableOnInsert(t *testing.T) {
	dir := t.TempDir()
	rm := host.NewRecentManager(dir)
	for i := 0; i < 90; i++ {
		rm.AddRecent(fmt.Sprintf(`c:\recents\file-%03d.docx`, i))
	}
	svc := NewHomeService("test", nil, rm, nil, nil, nil, nil, nil, nil, nil)

	first := svc.Recents(RecentPageQuery{Limit: 30})
	rm.AddRecent(`c:\recents\opened-while-scrolling.xlsx`)

	next := svc.Recents(RecentPageQuery{Cursor: first.NextCursor, Limit: 30})
	if next.TotalAll != 91 {
		t.Fatalf("expected the new recent in the collection counter, got %d", next.TotalAll)
	}
	if len(next.Entries) != 30 {
		t.Fatalf("expected a full next page, got %d", len(next.Entries))
	}
	if next.Entries[0].Path != `c:\recents\file-059.docx` {
		t.Fatalf("expected the next page to continue at file-059, got %q", next.Entries[0].Path)
	}
	for _, e := range next.Entries {
		if e.Path == `c:\recents\file-060.docx` {
			t.Fatal("the next page repeated the last row of the first page")
		}
		if e.Path == `c:\recents\opened-while-scrolling.xlsx` {
			t.Fatal("a row inserted above the cursor leaked into the next page")
		}
	}
}

// TestHomeServiceRecentsCursorFilter covers the filtered view the sidebar pills
// produce: total shrinks to the family, totalAll stays global, and the cursor
// keeps walking the filtered set.
func TestHomeServiceRecentsCursorFilter(t *testing.T) {
	dir := t.TempDir()
	rm := host.NewRecentManager(dir)
	for i := 0; i < 30; i++ {
		rm.AddRecent(fmt.Sprintf(`c:\recents\file-%03d.xlsx`, i))
		rm.AddRecent(fmt.Sprintf(`c:\recents\file-%03d.docx`, i))
	}
	svc := NewHomeService("test", nil, rm, nil, nil, nil, nil, nil, nil, nil)

	page := svc.Recents(RecentPageQuery{Ext: "xlsx", Limit: 0})
	if page.Total != 30 || page.TotalAll != 60 || len(page.Entries) != 0 {
		t.Fatalf("counters-only page wrong: total=%d totalAll=%d rows=%d", page.Total, page.TotalAll, len(page.Entries))
	}

	cursor := ""
	got := 0
	for {
		p := svc.Recents(RecentPageQuery{Ext: "xlsx", Cursor: cursor, Limit: 12})
		for _, e := range p.Entries {
			if e.Ext != "xlsx" {
				t.Fatalf("filter leaked %q", e.Path)
			}
		}
		got += len(p.Entries)
		if p.NextCursor == "" {
			break
		}
		cursor = p.NextCursor
	}
	if got != 30 {
		t.Fatalf("expected 30 filtered rows across pages, got %d", got)
	}
}

// TestHomeServiceSearchFilesIndexContract locks the shape the renderer polls:
// page.index must be the live {indexed,pending,scanning} object. Returning a
// bare string made the polling loop never restart, so results stayed stale
// until the user retyped the query.
func TestHomeServiceSearchFilesIndexContract(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()

	if err := os.WriteFile(filepath.Join(dir, "contract.txt"), []byte("contract token"), 0o644); err != nil {
		t.Fatal(err)
	}

	fm := host.NewFolderManager(dataDir, func() string { return dir })
	lc, err := index.Init(dataDir, fm.RootPaths())
	if err != nil {
		t.Fatalf("index.Init: %v", err)
	}
	defer func() {
		_ = lc.Shutdown()
		index.SetIndexStatus(false, "")
	}()

	deadline := time.Now().Add(8 * time.Second)
	for !index.GetIndexStatus().Ready && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !index.GetIndexStatus().Ready {
		t.Fatal("index never became ready")
	}

	rm := host.NewRecentManager(dataDir)
	svc := NewHomeService("test", nil, rm, fm, nil, nil, nil, lc, nil, nil)
	page, err := svc.SearchFiles(FileSearchQuery{Q: "contract"})
	if err != nil {
		t.Fatalf("SearchFiles: %v", err)
	}
	if page.Unavailable != nil {
		t.Fatalf("unexpected unavailable page: %s", page.Unavailable.Reason)
	}
	if page.Index.Indexed < 1 {
		t.Fatalf("expected the indexed file count to be reported, got %+v", page.Index)
	}
	if page.Index.Pending != 0 || page.Index.Scanning {
		t.Fatalf("expected an idle index between scans, got %+v", page.Index)
	}
}

// TestHomeServiceFolderRootsSyncIndex verifies that the real folder-root
// mutation bindings push the new root set into the index lifecycle: a file
// that already exists under a not-yet-added root only becomes searchable
// after DropFolderRoots triggers the SyncRoots rescan, and removing the root
// clears the ghost row again.
func TestHomeServiceFolderRootsSyncIndex(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	extra := t.TempDir()

	fm := host.NewFolderManager(dataDir, func() string { return dir })
	lc, err := index.Init(dataDir, fm.RootPaths())
	if err != nil {
		t.Fatalf("index.Init: %v", err)
	}
	defer lc.Shutdown()

	svc := NewHomeService("test", nil, nil, fm, nil, nil, nil, lc, nil, nil)

	// Stock file: written before the root is added, so only the
	// SyncRoots-triggered rescan (not the watcher) can bring it into the index.
	fp := filepath.Join(extra, "stock.txt")
	if err := os.WriteFile(fp, []byte("bridgesyncstock token"), 0o644); err != nil {
		t.Fatal(err)
	}

	svc.DropFolderRoots([]string{extra})
	waitForIndexHits(t, lc.Store(), "bridgesyncstock", 1)

	svc.RemoveFolderRoot(extra)
	waitForIndexHits(t, lc.Store(), "bridgesyncstock", 0)
}
