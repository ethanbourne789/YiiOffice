package bridge

import (
	"os"
	"path/filepath"
	"testing"

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

	if !svc.GetAutoSaveDefault() {
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
	if svc.GetAutoSaveDefault() {
		t.Fatal("expected auto save default to be false")
	}
}

func TestHomeServiceGetDefaultSaveDir(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	// Before the user picks a folder the contract falls back to Documents/YiiOffice.
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}
	want := filepath.Join(home, "Documents", "YiiOffice")
	if dir := svc.GetDefaultSaveDir(); dir != want {
		t.Fatalf("expected fallback %q, got %q", want, dir)
	}
}

func TestHomeServiceRecents(t *testing.T) {
	tmp := t.TempDir()
	svc := newTestHomeService(t, tmp)

	recents := svc.Recents(0, 50)
	// GetRecents returns nil when there are no recents (not empty slice)
	_ = recents // nil or empty slice, both are valid
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
		ext       string
		wantKind  host.TabKind
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

	newPath, err := svc.RenameFile(testFile, "new.txt")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	expectedPath := filepath.Join(tmp, "new.txt")
	if newPath != expectedPath {
		t.Fatalf("expected path %s, got %s", expectedPath, newPath)
	}
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
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
	if *page.Unavailable != "sidecar not running" {
		t.Fatalf("expected reason 'sidecar not running', got %s", *page.Unavailable)
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
	if *page.Unavailable != "index not initialized" {
		t.Fatalf("expected reason 'index not initialized', got %s", *page.Unavailable)
	}
}