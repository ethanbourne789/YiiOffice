package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

// Path security model for the bridge bindings.
//
// Every binding that touches the filesystem takes a path handed in by the
// renderer, which is untrusted: a crafted document (a Markdown image link, a
// PPTX media ref, an editor "Save Image As" on a link) can make the renderer
// ask for any path. Two policies close that hole:
//
//   - READS are authorised against the guard root set (the sidebar folders plus
//     the user profile) via fsutil.Guard — see authoriseLocalImageRead and
//     ValidateLocalPath. A file the user browses to is by definition inside
//     those roots, so this never blocks a legitimate open.
//   - WRITES are authorised against a per-session grant set (PathGrants). A path
//     becomes writable only when a native dialog handed it back (save dialog,
//     export folder picker), when the user opened the file through the app, or
//     when it lives under an app-managed directory. Anything else is refused
//     with an explicit error rather than silently written or falling back to a
//     dialog.
//
// The grant set is deliberately narrow for writes: it is what stops an escaped
// path (a "../.." in a suggested name, or a hard-coded outPath) from overwriting
// a file the user never chose this session, even when that file sits under the
// user's home directory.
type PathGrants struct {
	mu    sync.RWMutex
	files map[string]struct{} // exact file paths, canonical + case-folded
	dirs  map[string]struct{} // directories whose whole subtree is writable
	order []string            // insertion order of every key, for bounded eviction
}

// maxGrants bounds the grant set. It only has to cover one editing session's
// worth of opened + picked + exported paths; the oldest entries roll off.
const maxGrants = 512

// caseInsensitivePath mirrors fsutil: Windows and macOS compare names
// case-insensitively, so grants must be keyed the same way or a re-opened file
// with different casing would look ungranted.
var caseInsensitivePath = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

var globalGrants = NewPathGrants()

// NewPathGrants returns an empty grant set.
func NewPathGrants() *PathGrants {
	return &PathGrants{files: map[string]struct{}{}, dirs: map[string]struct{}{}}
}

func grantKey(path string) string {
	if caseInsensitivePath {
		return strings.ToLower(path)
	}
	return path
}

// canonicalWritePath turns a renderer-supplied path into a clean absolute path.
// It rejects empty paths, NUL bytes and relative paths: a write target must be
// fully qualified so it can be matched against the grant set deterministically.
func canonicalWritePath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", fmt.Errorf("empty path")
	}
	if strings.ContainsRune(trimmed, 0) {
		return "", fmt.Errorf("path contains NUL")
	}
	if !filepath.IsAbs(trimmed) {
		return "", fmt.Errorf("path must be absolute: %s", path)
	}
	return filepath.Clean(trimmed), nil
}

// GrantFile marks one exact file path as writable (a save-dialog result, or a
// file the user opened). Errors are ignored: a path we cannot canonicalise was
// never going to match a write anyway.
func (g *PathGrants) GrantFile(path string) {
	clean, err := canonicalWritePath(path)
	if err != nil {
		return
	}
	g.add(grantKey(clean), g.files)
}

// GrantDir marks a directory (and its whole subtree) as writable — an export
// folder the user picked, or an app-managed directory.
func (g *PathGrants) GrantDir(dir string) {
	clean, err := canonicalWritePath(dir)
	if err != nil {
		return
	}
	g.add(grantKey(clean), g.dirs)
}

func (g *PathGrants) add(key string, set map[string]struct{}) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, dup := set[key]; dup {
		return
	}
	set[key] = struct{}{}
	g.order = append(g.order, key)
	if len(g.order) > maxGrants {
		g.evictLocked()
	}
}

// evictLocked drops the oldest keys that are no longer present in either set.
// The caller holds g.mu.
func (g *PathGrants) evictLocked() {
	keep := g.order
	for len(keep) > maxGrants/2 {
		next := make([]string, 0, len(keep)/2)
		// Drop the older half; surviving re-grants simply re-add themselves.
		for i := len(keep) / 2; i < len(keep); i++ {
			next = append(next, keep[i])
		}
		keep = next
	}
	// Rebuild the sets from the kept keys.
	files := make(map[string]struct{}, len(g.files))
	for k := range g.files {
		if contains(keep, k) {
			files[k] = struct{}{}
		}
	}
	dirs := make(map[string]struct{}, len(g.dirs))
	for k := range g.dirs {
		if contains(keep, k) {
			dirs[k] = struct{}{}
		}
	}
	g.files, g.dirs, g.order = files, dirs, keep
}

func contains(s []string, k string) bool {
	for _, v := range s {
		if v == k {
			return true
		}
	}
	return false
}

// Allowed reports whether path (a clean absolute path) is covered by a file
// grant or sits inside a granted directory.
func (g *PathGrants) Allowed(path string) bool {
	clean, err := canonicalWritePath(path)
	if err != nil {
		return false
	}
	key := grantKey(clean)
	g.mu.RLock()
	defer g.mu.RUnlock()
	if _, ok := g.files[key]; ok {
		return true
	}
	for dir := filepath.Dir(clean); ; dir = filepath.Dir(dir) {
		if _, ok := g.dirs[grantKey(dir)]; ok {
			return true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	return false
}

// AuthoriseWrite validates a renderer-supplied write target and returns the
// canonical absolute path to use. A path that was never granted (not picked in
// a dialog, not opened, not under an app-managed directory) is rejected here —
// the caller must surface the error, never fall back to a dialog or write
// anyway.
func (g *PathGrants) AuthoriseWrite(path string) (string, error) {
	clean, err := canonicalWritePath(path)
	if err != nil {
		return "", err
	}
	if !g.Allowed(clean) {
		return "", fmt.Errorf("write path not authorised for this session (choose a location in a save dialog or open the file first): %s", path)
	}
	return clean, nil
}

// GrantFile / GrantDir / AuthoriseWrite operate on the process-wide grant set
// shared by every service.

// GrantFile records a writable file path in the process-wide grant set.
func GrantFile(path string) { globalGrants.GrantFile(path) }

// GrantDir records a writable directory subtree in the process-wide grant set.
func GrantDir(dir string) { globalGrants.GrantDir(dir) }

// AuthoriseWrite validates a write target against the process-wide grant set.
func AuthoriseWrite(path string) (string, error) { return globalGrants.AuthoriseWrite(path) }

// InitManagedGrants marks the app-managed directories writable so headless
// exports, recovery copies and the "open in Docs" temp flow keep working. It is
// called once at startup (and is safe to call from tests).
func InitManagedGrants() error {
	dataDir, err := host.AppDataDir()
	if err != nil {
		return err
	}
	for _, sub := range []string{"exports", "documents", "documents/recovery", "temp"} {
		GrantDir(filepath.Join(dataDir, sub))
	}
	// The system temp dir backs RenderPdfBase64 / MergePdfParts scratch files.
	GrantDir(os.TempDir())
	return nil
}

// AllowedDir reports whether dir itself, or one of its ancestors, is a granted
// directory. Unlike Allowed it accepts a path that is exactly a granted dir —
// folder-picker results (split / export-to-folder targets) are directories.
func (g *PathGrants) AllowedDir(dir string) bool {
	clean, err := canonicalWritePath(dir)
	if err != nil {
		return false
	}
	key := grantKey(clean)
	g.mu.RLock()
	defer g.mu.RUnlock()
	if _, ok := g.dirs[key]; ok {
		return true
	}
	for parent := filepath.Dir(clean); ; parent = filepath.Dir(parent) {
		if _, ok := g.dirs[grantKey(parent)]; ok {
			return true
		}
		up := filepath.Dir(parent)
		if up == parent {
			break
		}
	}
	return false
}

// AuthoriseWriteDir validates a renderer-supplied folder write target and
// returns the canonical absolute path. Refuses folders that were never picked
// in a folder dialog or granted as app-managed.
func (g *PathGrants) AuthoriseWriteDir(dir string) (string, error) {
	clean, err := canonicalWritePath(dir)
	if err != nil {
		return "", err
	}
	if !g.AllowedDir(clean) {
		return "", fmt.Errorf("write folder not authorised for this session (choose a folder in a folder picker first): %s", dir)
	}
	return clean, nil
}

// AuthoriseWriteDir validates a folder write target against the process-wide
// grant set.
func AuthoriseWriteDir(dir string) (string, error) { return globalGrants.AuthoriseWriteDir(dir) }
