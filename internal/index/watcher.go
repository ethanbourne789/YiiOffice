package index

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// Watcher keeps the index in sync with filesystem changes under the
// configured roots. fsnotify has no recursive watch on Windows, so the
// full set of subdirectories under every root is tracked explicitly and
// new directories are added as they appear. File events are debounced
// per path (Windows fires several Write events for one save) and then
// applied through FileIndexer.IndexOne, followed by a
// "home:folder-changed" event for the frontend.
type Watcher struct {
	ix            *FileIndexer
	fw            *fsnotify.Watcher
	mu            sync.Mutex
	watching      map[string]struct{}
	roots         []string
	pending       map[string]time.Time
	debounce      time.Duration
	flushInterval time.Duration
	done          chan struct{}
	stopped       bool
	wg            sync.WaitGroup
}

// NewWatcher creates a watcher feeding ix. debounce is the per-path
// coalescing window; tests use short values, production uses 400ms.
func NewWatcher(ix *FileIndexer, debounce time.Duration) (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		ix:            ix,
		fw:            fw,
		watching:      map[string]struct{}{},
		pending:       map[string]time.Time{},
		debounce:      debounce,
		flushInterval: debounce / 2,
		done:          make(chan struct{}),
	}, nil
}

// SyncRoots replaces the watched root set. It rebuilds the directory
// watch set from scratch (roots plus all subdirectories, following the
// same hidden/symlink/depth rules as ScanDir) and diffs it against the
// current one.
func (w *Watcher) SyncRoots(roots []string) {
	desired := map[string]struct{}{}
	for _, root := range roots {
		desired[root] = struct{}{}
		addDirTree(desired, root)
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	w.roots = append([]string(nil), roots...)

	for dir := range w.watching {
		if _, ok := desired[dir]; !ok {
			_ = w.fw.Remove(dir)
			delete(w.watching, dir)
		}
	}
	for dir := range desired {
		if _, ok := w.watching[dir]; ok {
			continue
		}
		if err := w.fw.Add(dir); err != nil {
			platform.Logger().Warn("index watch: add failed", "dir", dir, "error", err)
			continue
		}
		w.watching[dir] = struct{}{}
	}
}

// addDirTree walks root's subdirectories (bounded by ScanMaxDepth,
// skipping hidden and symlinked dirs) and adds every directory to dst.
func addDirTree(dst map[string]struct{}, root string) {
	rootDepth := strings.Count(root, string(filepath.Separator))
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if p != root && (isHidden(filepath.Dir(p), d.Name()) ||
			strings.Count(p, string(filepath.Separator))-rootDepth > ScanMaxDepth) {
			return filepath.SkipDir
		}
		if info, err := d.Info(); err == nil && info.Mode()&os.ModeSymlink != 0 {
			return filepath.SkipDir
		}
		dst[p] = struct{}{}
		return nil
	})
}

// Start launches the event and flush loops.
func (w *Watcher) Start() {
	w.wg.Add(2)
	go func() {
		defer w.wg.Done()
		w.eventLoop()
	}()
	go func() {
		defer w.wg.Done()
		w.flushLoop()
	}()
}

// Stop ends the loops, waits for any in-flight flush (which may still be
// calling IndexOne/RemoveIndexed on the store), then closes the underlying
// filesystem watcher. Safe to call more than once; only the first call does
// the work, so the done channel is closed exactly once.
func (w *Watcher) Stop() {
	w.mu.Lock()
	if w.stopped {
		w.mu.Unlock()
		return
	}
	w.stopped = true
	close(w.done)
	w.mu.Unlock()

	w.wg.Wait()
	_ = w.fw.Close()
}

func (w *Watcher) eventLoop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fw.Events:
			if !ok {
				return
			}
			w.handle(ev)
		case err, ok := <-w.fw.Errors:
			if !ok {
				return
			}
			// Watch-level failures (dropped handles, overflow) fall back
			// to a coarse full refresh; correctness beats efficiency here.
			platform.Logger().Warn("index watch error, scheduling refresh", "error", err)
			w.ix.Refresh()
		}
	}
}

func (w *Watcher) handle(ev fsnotify.Event) {
	if ev.Op&fsnotify.Chmod != 0 {
		return
	}

	info, err := os.Stat(ev.Name)
	if err == nil && info.IsDir() {
		if ev.Op&fsnotify.Create != 0 {
			w.addWatchedDir(ev.Name)
		}
		return
	}

	if err != nil {
		// Path is gone (Remove, or rename-from on Windows).
		if w.purgeStaleWatch(ev.Name) {
			// A watched directory vanished: the backend already dropped its
			// handle, so the stale subtree entries must go or a rebuild would
			// never re-arm the watch. Refresh also clears the subtree's ghost
			// index rows (e.g. after a directory rename-away).
			w.ix.Refresh()
			platform.Emit("home:folder-changed", []string{filepath.Dir(ev.Name)})
			return
		}
		w.removePath(ev.Name)
		return
	}

	ext := strings.ToLower(filepath.Ext(ev.Name))
	if _, ok := supportedExts[ext]; !ok {
		return
	}
	if isHidden(filepath.Dir(ev.Name), filepath.Base(ev.Name)) {
		return
	}

	w.mu.Lock()
	w.pending[ev.Name] = time.Now()
	w.mu.Unlock()
}

// addWatchedDir registers a newly created directory (and its existing
// subdirectories, e.g. a moved-in subtree) with the filesystem watcher.
func (w *Watcher) addWatchedDir(dir string) {
	desired := map[string]struct{}{dir: {}}
	addDirTree(desired, dir)

	w.mu.Lock()
	defer w.mu.Unlock()
	for d := range desired {
		if _, ok := w.watching[d]; ok {
			continue
		}
		if err := w.fw.Add(d); err != nil {
			platform.Logger().Warn("index watch: add new dir failed", "dir", d, "error", err)
			continue
		}
		w.watching[d] = struct{}{}
	}
}

// purgeStaleWatch drops watching entries for a disappeared path p when p
// (or any watched directory under it) was itself watched — i.e. a watched
// directory was deleted or renamed away. Returns true if any entry was
// purged. The fsnotify backend has already released the handles, so we only
// clear our bookkeeping (Remove calls are best-effort) to let a later
// rebuild re-arm the watch via addWatchedDir/SyncRoots.
func (w *Watcher) purgeStaleWatch(p string) bool {
	prefix := p + string(filepath.Separator)
	w.mu.Lock()
	defer w.mu.Unlock()
	var purged bool
	for dir := range w.watching {
		if dir == p || strings.HasPrefix(dir, prefix) {
			_ = w.fw.Remove(dir)
			delete(w.watching, dir)
			purged = true
		}
	}
	return purged
}

func (w *Watcher) removePath(p string) {
	w.mu.Lock()
	delete(w.pending, p)
	w.mu.Unlock()
	if err := w.ix.RemoveIndexed(p); err != nil {
		platform.Logger().Warn("index: incremental remove failed", "path", p, "error", err)
	}
	platform.Emit("home:folder-changed", []string{filepath.Dir(p)})
}

func (w *Watcher) flushLoop() {
	t := time.NewTicker(w.flushInterval)
	defer t.Stop()
	for {
		select {
		case <-w.done:
			return
		case now := <-t.C:
			w.flush(now)
		}
	}
}

func (w *Watcher) flush(now time.Time) {
	w.mu.Lock()
	var ready []string
	for p, ts := range w.pending {
		if now.Sub(ts) >= w.debounce {
			delete(w.pending, p)
			ready = append(ready, p)
		}
	}
	w.mu.Unlock()

	for _, p := range ready {
		if err := w.ix.IndexOne(p); err != nil {
			platform.Logger().Warn("index: incremental index failed", "path", p, "error", err)
		}
		platform.Emit("home:folder-changed", []string{filepath.Dir(p)})
	}
}
