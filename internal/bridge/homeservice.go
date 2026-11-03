package bridge

import (
	"fmt"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// HomeService exposes the home-screen surface (settings, recents, starred,
// folders, file ops, default-app, search) as an official Wails V3 named binding
// service. It is the single owner of the shared get/set settings channels
// (language, theme, document-theme, auto-save-default) — editor services must
// not redeclare them.
type HomeService struct {
	version    string
	store      *host.SettingsStore
	rm         *host.RecentManager
	fm         *host.FolderManager
	th         *host.TabHost
	fo         *host.FileOps
	dam        *host.DefaultAppManager
	idxLc      *index.Lifecycle
	openFile   func() ([]string, error)
	revealPath func(string) error
}

// NewHomeService builds a HomeService from its host dependencies.
func NewHomeService(version string, store *host.SettingsStore, rm *host.RecentManager,
	fm *host.FolderManager, th *host.TabHost, fo *host.FileOps, dam *host.DefaultAppManager,
	idxLc *index.Lifecycle, openFile func() ([]string, error), revealPath func(string) error) *HomeService {
	return &HomeService{
		version: version, store: store, rm: rm, fm: fm, th: th, fo: fo, dam: dam,
		idxLc: idxLc, openFile: openFile, revealPath: revealPath,
	}
}

// --- Settings ---

// GetAppVersion returns the application build version.
func (s *HomeService) GetAppVersion() string { return s.version }

// GetLanguage returns the current UI language (e.g. "zh").
func (s *HomeService) GetLanguage() string { return s.store.Snapshot().Language }

// SetLanguage persists the UI language and broadcasts the change.
func (s *HomeService) SetLanguage(lang string) error {
	if err := s.store.SetLanguage(lang); err != nil {
		return err
	}
	platform.Emit(EventLanguageChanged, lang)
	return nil
}

// GetTheme returns the current app theme ("light"/"dark"/"system").
func (s *HomeService) GetTheme() string { return s.store.Snapshot().Theme }

// SetTheme persists the app theme and broadcasts the change.
func (s *HomeService) SetTheme(theme string) error {
	if err := s.store.SetTheme(theme); err != nil {
		return err
	}
	platform.Emit(EventThemeChanged, theme)
	return nil
}

// GetDocumentTheme returns the current document theme.
func (s *HomeService) GetDocumentTheme() string { return s.store.Snapshot().DocumentTheme }

// SetDocumentTheme persists the document theme and broadcasts the change.
func (s *HomeService) SetDocumentTheme(theme string) error {
	if err := s.store.SetDocumentTheme(theme); err != nil {
		return err
	}
	platform.Emit(EventDocumentThemeChanged, theme)
	return nil
}

// AutoSaveStatus is the auto-save default setting with its last-updated timestamp.
type AutoSaveStatus struct {
	On        bool  `json:"on"`
	UpdatedAt int64 `json:"updatedAt"`
}

// RenameResult reports whether a rename/create succeeded. JSON shape matches
// frontend RenameResult ({ok, path?, error?}).
type RenameResult struct {
	OK    bool   `json:"ok"`
	Path  string `json:"path,omitempty"`
	Error string `json:"error,omitempty"`
}

// GetAutoSaveDefault returns the auto-save default toggle with its timestamp.
func (s *HomeService) GetAutoSaveDefault() AutoSaveStatus {
	snap := s.store.Snapshot()
	return AutoSaveStatus{On: snap.AutoSaveDefault, UpdatedAt: snap.AutoSaveDefaultUpdated}
}

// SetAutoSaveDefault persists the auto-save default and broadcasts the change.
func (s *HomeService) SetAutoSaveDefault(enabled bool) error {
	if err := s.store.SetAutoSaveDefault(enabled); err != nil {
		return err
	}
	snap := s.store.Snapshot()
	platform.Emit(EventAutoSaveDefaultChanged, AutoSaveStatus{On: snap.AutoSaveDefault, UpdatedAt: snap.AutoSaveDefaultUpdated})
	return nil
}

// GetDefaultSaveDir returns the configured default save directory, falling
// back to the Documents/YiiOffice folder the app creates on first use.
func (s *HomeService) GetDefaultSaveDir() string {
	if dir := s.store.Snapshot().DefaultSaveDir; dir != "" {
		return dir
	}
	docs, err := host.DocumentsDir()
	if err != nil {
		return ""
	}
	return filepath.Join(docs, "YiiOffice")
}

// PickDefaultSaveDir opens a directory picker and persists the choice. It
// returns "" when the user cancels.
func (s *HomeService) PickDefaultSaveDir() (string, error) {
	app := platform.App()
	if app == nil {
		return "", fmt.Errorf("app not available")
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle("Choose Save Folder").
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil || dir == "" {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create save folder: %w", err)
	}
	GrantDir(dir)
	if err := s.store.SetDefaultSaveDir(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// --- Recents & starred ---

// Recents returns the recent files page.
func (s *HomeService) Recents(offset int, limit int) []host.DocumentEntry {
	if limit == 0 {
		limit = 50
	}
	return s.rm.GetRecents(offset, limit)
}

// RemoveRecent removes a single path from the recent list.
func (s *HomeService) RemoveRecent(path string) { s.rm.RemoveRecent(path) }

// Starred returns the starred files.
func (s *HomeService) Starred() []host.DocumentEntry { return s.rm.GetStarred() }

// StarredGroups returns the distinct starred group labels.
func (s *HomeService) StarredGroups() []string { return s.rm.GetStarredGroups() }

// SetStarredGroup assigns a star to a group label.
func (s *HomeService) SetStarredGroup(path string, group string) { s.rm.SetStarredGroup(path, group) }

// ToggleStar flips the starred state of a path.
func (s *HomeService) ToggleStar(path string) bool { return s.rm.ToggleStar(path) }

// UnstarPaths removes stars from the given paths.
func (s *HomeService) UnstarPaths(paths []string) { s.rm.UnstarPaths(paths) }

// StatPaths returns file metadata for the given paths.
func (s *HomeService) StatPaths(paths []string) []host.FileInfo { return s.rm.StatPaths(paths) }

// --- File operations ---

func (s *HomeService) newTab(kind host.TabKind, title string) {
	s.th.AddTab(kind, title, "")
	platform.Emit(EventTabsChanged, s.th.List())
}

// NewDocument opens a new untitled document tab.
func (s *HomeService) NewDocument() { s.newTab(host.TabKindDocs, "Untitled Document") }

// NewSheet opens a new untitled spreadsheet tab.
func (s *HomeService) NewSheet() { s.newTab(host.TabKindSheets, "Untitled Spreadsheet") }

// NewSlide opens a new untitled presentation tab.
func (s *HomeService) NewSlide() { s.newTab(host.TabKindSlides, "Untitled Presentation") }

// NewMarkdown opens a new untitled markdown tab.
func (s *HomeService) NewMarkdown() { s.newTab(host.TabKindMarkdown, "Untitled Markdown") }

// NewPdf opens a new untitled PDF tab.
func (s *HomeService) NewPdf() { s.newTab(host.TabKindPDF, "Untitled PDF") }

// OpenPath routes a file into the appropriate editor tab.
func (s *HomeService) OpenPath(path string) error {
	kind, ok := host.RouteByExt(path)
	if !ok {
		return fmt.Errorf("unsupported file type: %s", path)
	}
	// Opening a document is the trusted grant point: this exact file was
	// routed from the sidebar, recents, a dialog or the shell, so later
	// saves back to it are authorised for the session.
	GrantFile(path)
	s.th.AddTab(kind, filepath.Base(path), path)
	if s.rm != nil {
		s.rm.AddRecent(path)
	}
	platform.Emit(EventTabsChanged, s.th.List())
	return nil
}

// Browse opens the file dialog and returns the selected paths.
func (s *HomeService) Browse() ([]string, error) {
	if s.openFile == nil {
		return nil, fmt.Errorf("file browser not configured")
	}
	return s.openFile()
}

// RevealPath reveals a path in the system file manager.
func (s *HomeService) RevealPath(path string) error {
	if s.revealPath == nil {
		return fmt.Errorf("revealPath not configured")
	}
	return s.revealPath(path)
}

// RenameFile renames a file and returns a result with the new path.
func (s *HomeService) RenameFile(path string, newName string) RenameResult {
	newPath, err := s.fo.Rename(path, sanitizeFileName(newName))
	if err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: newPath}
}

// DuplicateFile duplicates a file and returns the new path.
func (s *HomeService) DuplicateFile(path string) (string, error) { return s.fo.Duplicate(path) }

// DeleteFiles deletes the given paths and returns those that failed.
func (s *HomeService) DeleteFiles(paths []string) []string { return s.fo.Delete(paths) }

// OpenTrash opens the system Recycle Bin.
func (s *HomeService) OpenTrash() { platform.OpenExternal("shell:RecycleBin") }

// --- Folder operations ---

// FolderRoots returns the sidebar folder roots.
func (s *HomeService) FolderRoots() []host.FolderRoot { return s.fm.GetRoots() }

// AddFolderRoot opens a directory picker and adds the chosen folder to the tree.
func (s *HomeService) AddFolderRoot() (*host.FolderRoot, error) {
	app := platform.App()
	if app == nil {
		return nil, fmt.Errorf("app not available")
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle("Add Folder").
		CanChooseFiles(false).
		CanChooseDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if dir == "" {
		return nil, nil
	}
	s.fm.AddRoot(dir, "")
	s.SyncIndexRoots()
	row, ok := s.fm.FindRoot(dir)
	if !ok {
		return nil, nil
	}
	return &row, nil
}

// DropFolderRoots adds multiple dropped folder roots without labels.
func (s *HomeService) DropFolderRoots(paths []string) []host.FolderRoot {
	for _, p := range paths {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			s.fm.AddRoot(p, "")
		}
	}
	s.SyncIndexRoots()
	return s.fm.GetRoots()
}

// RemoveFolderRoot removes a folder root by path.
func (s *HomeService) RemoveFolderRoot(path string) {
	s.fm.RemoveRoot(path)
	s.SyncIndexRoots()
}

// SyncIndexRoots pushes the current sidebar root set to the file index
// watcher. Called after every folder root mutation so incremental indexing
// stays in sync without a restart.
func (s *HomeService) SyncIndexRoots() {
	if s.idxLc != nil {
		s.idxLc.SyncRoots(s.fm.RootPaths())
	}
}

// ListFolder lists the entries under a folder path.
func (s *HomeService) ListFolder(path string) host.FolderListing {
	listing, err := s.fm.ListFolder(path)
	if err != nil {
		// A directory that vanished is reported to the renderer as missing
		// rather than as a failed binding call, so the tree can grey it out.
		return host.FolderListing{Dir: path, Folders: []host.FolderEntry{}, Files: []host.DocumentEntry{}, Missing: true}
	}
	return listing
}

// CreateFolder creates a folder under the given parent.
func (s *HomeService) CreateFolder(parentPath string, name string) RenameResult {
	name = sanitizeFileName(name)
	path := filepath.Join(parentPath, name)
	if err := s.fm.CreateFolder(parentPath, name); err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: path}
}

// RenameFolder renames a folder and returns a result with the new path.
func (s *HomeService) RenameFolder(oldPath string, newName string) RenameResult {
	newName = sanitizeFileName(newName)
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if err := s.fm.RenameFolder(oldPath, newName); err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: newPath}
}

// MovePaths moves items into a destination directory.
func (s *HomeService) MovePaths(paths []string, destDir string) error {
	failed := s.fm.MovePaths(paths, destDir)
	if len(failed) > 0 {
		return fmt.Errorf("failed to move %d items", len(failed))
	}
	return nil
}

// DeleteFolder deletes a folder by path.
func (s *HomeService) DeleteFolder(path string) error { return s.fm.DeleteFolder(path) }

// --- Default app ---

// GetDefaultAppStatus reports whether the app is the default file handler.
func (s *HomeService) GetDefaultAppStatus() map[string]string { return s.dam.GetDefaultAppStatus() }

// SetDefaultApp opens the OS page to set the app as default.
func (s *HomeService) SetDefaultApp() {
	platform.OpenExternal(s.dam.SetDefaultApp())
}

// GetFileAssocStatus reports the live per-extension association state, read
// from the registry so the UI reconciles with what Windows actually holds.
func (s *HomeService) GetFileAssocStatus() []host.FileAssocEntry {
	return s.dam.GetFileAssocStatus()
}

// SetFileAssocEnabled toggles the per-user "Open with" registration for one
// extension and persists the intent. The default-program choice itself is
// Windows' UserChoice and stays with the user.
func (s *HomeService) SetFileAssocEnabled(ext string, enabled bool) error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	if err := host.SetExtensionAssoc(ext, exePath, enabled); err != nil {
		return err
	}
	return s.store.SetFileAssocEnabled(host.NormalizeExt(ext), enabled)
}

// OpenDefaultAppSettings opens the Windows default-apps page; the user must
// confirm YiiOffice there — no program may write the hash-protected choice.
func (s *HomeService) OpenDefaultAppSettings() {
	platform.OpenExternal(s.dam.SetDefaultApp())
}

// RefreshEnabledAssociations re-registers every extension the user enabled so
// a moved/upgraded executable refreshes its stored open-command path.
func (s *HomeService) RefreshEnabledAssociations() {
	exePath, err := os.Executable()
	if err != nil {
		platform.Logger().Warn("resolve executable for associations", "error", err)
		return
	}
	for ext, enabled := range s.store.Snapshot().FileAssocEnabled {
		if !enabled {
			continue
		}
		if err := host.RegisterExtension(ext, exePath); err != nil {
			platform.Logger().Warn("refresh file association", "ext", ext, "error", err)
		}
	}
}

// --- Search ---

// SearchFiles runs a full-text search and returns the paged results.
func (s *HomeService) SearchFiles(query FileSearchQuery) (*FileSearchPage, error) {
	status := index.GetIndexStatus()
	if !status.Ready {
		reason := status.Reason
		return &FileSearchPage{Hits: []SearchHitWithStar{}, Unavailable: &reason}, nil
	}
	if s.idxLc == nil {
		reason := "index not initialized"
		return &FileSearchPage{Hits: []SearchHitWithStar{}, Unavailable: &reason}, nil
	}

	runes := []rune(query.Q)
	if len(runes) > 200 {
		query.Q = string(runes[:200])
	}
	store := s.idxLc.Store()
	result, err := store.Search(query.Q, index.SearchOptions{
		Ext:    resolveExtFamily(query.Ext),
		Offset: query.Offset,
		Limit:  query.Limit,
	})
	if err != nil {
		return nil, err
	}

	hits := make([]SearchHitWithStar, len(result.Hits))
	for i, h := range result.Hits {
		body, _ := store.GetBody(h.Path)
		var snippet []index.SnippetPart
		var excerpt string
		if body != nil {
			snippet = index.BuildSnippet(*body, []string{query.Q})
			excerpt = index.BuildExcerpt(*body, []string{query.Q}, 200)
		}
		hits[i] = SearchHitWithStar{
			Path: h.Path, Name: h.Name, Ext: h.Ext, MtimeMs: h.MtimeMs,
			SizeBytes: h.SizeBytes, Snippet: snippet, Needles: []string{query.Q},
			Excerpt: excerpt, Starred: s.rm.IsStarred(h.Path),
		}
	}
	return &FileSearchPage{Hits: hits, Total: result.Total, Index: "ok"}, nil
}
