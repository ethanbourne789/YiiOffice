package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
		return "", fmt.Errorf("%s", ErrAppUnavailable)
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle("Choose Save Folder").
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return "", codedError(ErrSaveDialogFailed, err)
	}
	if dir == "" {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", codedError(ErrSaveDirectoryFailed, err)
	}
	GrantDir(dir)
	if err := s.store.SetDefaultSaveDir(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// --- Recents & starred ---

const defaultRecentPageSize = 50

// recentCursorToken encodes the last row of a page. ts alone is not a total
// order (several opens can share a millisecond), so the path disambiguates and
// lets the next page resume after that exact record instead of an offset that
// would shift when a new recent is prepended.
func recentCursorToken(ts int64, path string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(ts, 10) + "\x00" + path))
}

func decodeRecentCursor(token string) (int64, string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, "", false
	}
	sep := strings.IndexByte(string(raw), 0)
	if sep < 0 {
		return 0, "", false
	}
	ts, err := strconv.ParseInt(string(raw[:sep]), 10, 64)
	if err != nil {
		return 0, "", false
	}
	return ts, string(raw[sep+1:]), true
}

// Recents returns one page of the recent list plus the home counters.
// Paging is cursor-based: the token names the last row already shown, so rows
// opened while the user scrolls are inserted above the cursor and are neither
// repeated nor skipped. A page is a snapshot of the list at call time; a
// concurrent removal can drop one row from the remaining pages, which the
// renderer already de-duplicates by path.
func (s *HomeService) Recents(query RecentPageQuery) *RecentPageResult {
	all := s.rm.RecentsSnapshot()
	visible := make([]host.RecentEntry, 0, len(all))
	allReal := 0
	family := resolveExtFamily(query.Ext)
	if strings.EqualFold(strings.TrimSpace(query.Ext), "all") {
		family = nil
	}
	for _, r := range all {
		// Legacy files may still hold the blank rows the old builds wrote.
		if p := filepath.Clean(strings.TrimSpace(r.Path)); p == "" || p == "." {
			continue
		}
		allReal++
		if family != nil && !containsString(family, strings.ToLower(strings.TrimPrefix(filepath.Ext(r.Path), "."))) {
			continue
		}
		visible = append(visible, r)
	}

	page := &RecentPageResult{Entries: []host.DocumentEntry{}, Total: len(visible), TotalAll: allReal}

	start := 0
	if query.Cursor != "" {
		if ts, path, ok := decodeRecentCursor(query.Cursor); ok {
			found := -1
			for i, r := range visible {
				if r.Ts == ts && strings.EqualFold(r.Path, path) {
					found = i
					break
				}
			}
			if found >= 0 {
				start = found + 1
			} else {
				// The cursor row was removed between pages; the array is newest
				// first, so resume at the first older record.
				start = len(visible)
				for i, r := range visible {
					if r.Ts < ts {
						start = i
						break
					}
				}
			}
		}
	}

	limit := query.Limit
	if limit < 0 {
		limit = defaultRecentPageSize
	}
	if limit == 0 || start >= len(visible) {
		return page
	}
	end := start + limit
	if end > len(visible) {
		end = len(visible)
	}

	rows := make([]host.DocumentEntry, 0, end-start)
	for _, r := range visible[start:end] {
		entry := host.StatDocument(r.Path)
		entry.Starred = s.rm.IsStarred(r.Path)
		rows = append(rows, entry)
	}
	page.Entries = rows
	if end < len(visible) {
		last := visible[end-1]
		page.NextCursor = recentCursorToken(last.Ts, last.Path)
	}
	return page
}

// containsString reports whether want is in list (family lookups are tiny).
func containsString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
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
		return fmt.Errorf("%s: unsupported file type: %s", ErrOpenUnsupportedType, path)
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

// fileOpRoots is the root set destructive file-manager operations may touch:
// the sidebar roots plus the user profile — the same set reads are authorised
// against. A nil folder manager still yields the profile root.
func (s *HomeService) fileOpRoots() []string {
	var configured func() []string
	if s.fm != nil {
		configured = s.fm.RootPaths
	}
	return localReadRoots(configured)
}

// RenameFile renames a file and returns a result with the new path.
func (s *HomeService) RenameFile(path string, newName string) RenameResult {
	name := sanitizeFileName(newName)
	roots := s.fileOpRoots()
	if _, err := authoriseDestructive(roots, path); err != nil {
		return RenameResult{Error: err.Error()}
	}
	if _, err := authoriseWriteInRoots(roots, filepath.Join(filepath.Dir(path), name)); err != nil {
		return RenameResult{Error: err.Error()}
	}
	newPath, err := s.fo.Rename(path, name)
	if err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: newPath}
}

// DuplicateFile duplicates a file and returns the new path.
func (s *HomeService) DuplicateFile(path string) (string, error) {
	roots := s.fileOpRoots()
	resolved, err := authoriseDestructive(roots, path)
	if err != nil {
		return "", err
	}
	// The copy lands beside the source, so it inherits the source's
	// authorisation: duplicating cannot place bytes in a folder the source
	// was not already in.
	if err := authoriseWriteBeside(roots, resolved, filepath.Dir(path)); err != nil {
		return "", err
	}
	return s.fo.Duplicate(path)
}

// DeleteFiles deletes the given paths and returns those that failed. An
// unauthorised path is reported as failed instead of being removed.
func (s *HomeService) DeleteFiles(paths []string) []string {
	roots := s.fileOpRoots()
	allowed := make([]string, 0, len(paths))
	rejected := make([]string, 0, len(paths))
	for _, p := range paths {
		if _, err := authoriseDestructive(roots, p); err != nil {
			rejected = append(rejected, p)
			continue
		}
		allowed = append(allowed, p)
	}
	failed := s.fo.Delete(allowed)
	return append(rejected, failed...)
}

// OpenTrash opens the system Recycle Bin.
func (s *HomeService) OpenTrash() { platform.OpenExternal("shell:RecycleBin") }

// --- Folder operations ---

// FolderRoots returns the sidebar folder roots.
func (s *HomeService) FolderRoots() []host.FolderRoot { return s.fm.GetRoots() }

// AddFolderRoot opens a directory picker and adds the chosen folder to the tree.
func (s *HomeService) AddFolderRoot() (*host.FolderRoot, error) {
	app := platform.App()
	if app == nil {
		return nil, fmt.Errorf("%s", ErrAppUnavailable)
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle("Add Folder").
		CanChooseFiles(false).
		CanChooseDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return nil, codedError(ErrOpenDialogFailed, err)
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
	roots := s.fileOpRoots()
	if _, err := authoriseDirInRoots(roots, parentPath); err != nil {
		return RenameResult{Error: err.Error()}
	}
	path := filepath.Join(parentPath, name)
	if _, err := authoriseWriteInRoots(roots, path); err != nil {
		return RenameResult{Error: err.Error()}
	}
	if err := s.fm.CreateFolder(parentPath, name); err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: path}
}

// RenameFolder renames a folder and returns a result with the new path.
func (s *HomeService) RenameFolder(oldPath string, newName string) RenameResult {
	newName = sanitizeFileName(newName)
	roots := s.fileOpRoots()
	if _, err := authoriseDestructive(roots, oldPath); err != nil {
		return RenameResult{Error: err.Error()}
	}
	newPath := filepath.Join(filepath.Dir(oldPath), newName)
	if _, err := authoriseWriteInRoots(roots, newPath); err != nil {
		return RenameResult{Error: err.Error()}
	}
	if err := s.fm.RenameFolder(oldPath, newName); err != nil {
		return RenameResult{Error: err.Error()}
	}
	return RenameResult{OK: true, Path: newPath}
}

// MovePaths moves items into a destination directory. Every source and the
// destination are authorised before anything moves, so one rejected path
// cannot leave a batch partially executed.
func (s *HomeService) MovePaths(paths []string, destDir string) error {
	if len(paths) == 0 {
		return nil
	}
	roots := s.fileOpRoots()
	if _, err := authoriseDirInRoots(roots, destDir); err != nil {
		return err
	}
	for _, p := range paths {
		if _, err := authoriseDestructive(roots, p); err != nil {
			return err
		}
	}
	failed := s.fm.MovePaths(paths, destDir)
	if len(failed) > 0 {
		return fmt.Errorf("failed to move %d items", len(failed))
	}
	return nil
}

// DeleteFolder deletes a folder by path. The whole subtree is authorised
// before anything is removed: if one entry resolves outside the exposed
// folders the delete is refused outright rather than executed partially.
func (s *HomeService) DeleteFolder(path string) error {
	roots := s.fileOpRoots()
	resolved, err := authoriseDestructive(roots, path)
	if err != nil {
		return err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory: %s", path)
	}
	if err := validateDeleteTree(resolved, roots); err != nil {
		return err
	}
	return s.fm.DeleteFolder(path)
}

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

// searchIndexInfo reports the live index state the search UI polls while the
// background scan is still catching up.
func (s *HomeService) searchIndexInfo() FileSearchIndex {
	if s.idxLc == nil {
		return FileSearchIndex{}
	}
	indexed, err := s.idxLc.Store().CountFiles()
	if err != nil {
		indexed = 0
	}
	pending, scanning := s.idxLc.Indexer().Status()
	return FileSearchIndex{Indexed: indexed, Pending: pending, Scanning: scanning}
}

// SearchFiles runs a full-text search and returns the paged results.
func (s *HomeService) SearchFiles(query FileSearchQuery) (*FileSearchPage, error) {
	status := index.GetIndexStatus()
	if !status.Ready {
		reason := status.Reason
		return &FileSearchPage{
			Hits: []SearchHitWithStar{}, Index: s.searchIndexInfo(),
			Unavailable: &FileSearchUnavailable{Reason: reason},
		}, nil
	}
	if s.idxLc == nil {
		reason := "index not initialized"
		return &FileSearchPage{
			Hits: []SearchHitWithStar{}, Index: s.searchIndexInfo(),
			Unavailable: &FileSearchUnavailable{Reason: reason},
		}, nil
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
	return &FileSearchPage{Hits: hits, Total: result.Total, Index: s.searchIndexInfo()}, nil
}
