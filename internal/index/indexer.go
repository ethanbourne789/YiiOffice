package index

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"golang.org/x/sync/errgroup"
)

// FileIndexer keeps the store in sync with the filesystem.
type FileIndexer struct {
	store     *FileIndexStore
	roots     []string
	mu        sync.Mutex
	refreshCh chan struct{}
	done      chan struct{}
	running   bool
}

// NewFileIndexer creates an indexer for the given roots.
func NewFileIndexer(store *FileIndexStore, roots []string) *FileIndexer {
	if roots == nil {
		roots = []string{}
	}
	return &FileIndexer{
		store:     store,
		roots:     roots,
		refreshCh: make(chan struct{}, 1),
		done:      make(chan struct{}),
	}
}

// SetRoots updates the directories to index.
func (ix *FileIndexer) SetRoots(roots []string) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.roots = roots
}

// Refresh schedules a full index refresh (debounced).
func (ix *FileIndexer) Refresh() {
	select {
	case ix.refreshCh <- struct{}{}:
	default:
	}
	ix.mu.Lock()
	wasRunning := ix.running
	ix.mu.Unlock()
	if !wasRunning {
		go ix.loop()
	}
}

// Stop shuts down the indexer gracefully.
func (ix *FileIndexer) Stop() {
	close(ix.done)
}

// RunOnce performs a single index refresh synchronously (for testing).
func (ix *FileIndexer) RunOnce() {
	ix.run()
}

func (ix *FileIndexer) loop() {
	ix.mu.Lock()
	ix.running = true
	ix.mu.Unlock()

	for {
		select {
		case <-ix.done:
			ix.mu.Lock()
			ix.running = false
			ix.mu.Unlock()
			return
		case <-ix.refreshCh:
			ix.run()
			select {
			case <-ix.refreshCh:
			default:
				ix.mu.Lock()
				ix.running = false
				ix.mu.Unlock()
				return
			}
		}
	}
}

// scanParallelism bounds concurrent directory walks during a full refresh.
const scanParallelism = 4

func (ix *FileIndexer) run() {
	ix.mu.Lock()
	roots := make([]string, len(ix.roots))
	copy(roots, ix.roots)
	ix.mu.Unlock()

	// 1. Scan all roots. Each root is split into one task per first-level
	// subdirectory (root-level files are collected inline) so several
	// goroutines walk in parallel. Results are merged under a mutex; the
	// downstream diff logic is unchanged, so duplicate paths from nested
	// tasks are impossible (tasks are disjoint subtrees).
	var allFiles []ScannedFile
	var tasks []string
	for _, root := range roots {
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		entries, err := os.ReadDir(absRoot)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			full := filepath.Join(absRoot, entry.Name())
			if entry.IsDir() {
				if isHidden(absRoot, entry.Name()) {
					continue
				}
				if info, err := entry.Info(); err == nil && info.Mode()&os.ModeSymlink != 0 {
					continue
				}
				tasks = append(tasks, full)
				continue
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if _, ok := supportedExts[ext]; !ok {
				continue
			}
			if isHidden(absRoot, entry.Name()) {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			allFiles = append(allFiles, ScannedFile{
				Path:      full,
				MtimeMs:   info.ModTime().UnixMilli(),
				SizeBytes: info.Size(),
			})
		}
	}

	var mu sync.Mutex
	g := new(errgroup.Group)
	g.SetLimit(scanParallelism)
	for _, task := range tasks {
		task := task
		g.Go(func() error {
			res := ScanDir(task)
			mu.Lock()
			allFiles = append(allFiles, res.Files...)
			mu.Unlock()
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		platform.Logger().Warn("index: parallel scan failed", "error", err)
	}

	// 2. Diff against existing index
	existing, err := ix.store.GetIndexedFiles()
	if err != nil {
		platform.Logger().Warn("index: failed to load existing files", "error", err)
		existing = []IndexedFile{}
	}

	existingMap := make(map[string]IndexedFile, len(existing))
	for _, f := range existing {
		existingMap[f.Path] = f
	}

	diskMap := make(map[string]ScannedFile, len(allFiles))
	for _, f := range allFiles {
		diskMap[f.Path] = f
	}

	// 3. Remove deleted files
	var removed []string
	for _, e := range existing {
		if _, ok := diskMap[e.Path]; !ok {
			removed = append(removed, e.Path)
		}
	}
	if len(removed) > 0 {
		if err := ix.store.Remove(removed); err != nil {
			platform.Logger().Warn("index: failed to remove files", "error", err)
		}
	}

	// 4. Find changed files
	var changed []ScannedFile
	for _, f := range allFiles {
		ex, ok := existingMap[f.Path]
		if !ok || ex.MtimeMs != f.MtimeMs || ex.SizeBytes != f.SizeBytes {
			changed = append(changed, f)
		}
	}

	// 5. Index changed files
	for _, f := range changed {
		if err := ix.indexFile(f); err != nil {
			platform.Logger().Warn("index: failed to index file", "path", f.Path, "error", err)
		}
	}
}

func (ix *FileIndexer) indexFile(sf ScannedFile) error {
	name := filepath.Base(sf.Path)
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(sf.Path)), ".")

	result := ExtractText(sf.Path)

	var status IndexStatus
	var body *string
	var nameTokens, pathTokens, bodyTokens TokenResult

	nameTokens = Tokenize(name)
	pathTokens = Tokenize(filepath.Dir(sf.Path))
	// Append the filename tokens to the path tokens for full path search
	filenameTokens := Tokenize(name)
	pathTokens.Bi = append(pathTokens.Bi, filenameTokens.Bi...)
	pathTokens.Uni = append(pathTokens.Uni, filenameTokens.Uni...)

	switch result.Kind {
	case "text":
		status = IndexOK
		body = &result.Text
		bodyTokens = Tokenize(result.Text)
	case "name-only":
		status = IndexNameOnly
	default:
		status = IndexError
	}

	nameU := nameTokens.Uni
	pathU := pathTokens.Uni
	bodyU := bodyTokens.Uni

	return ix.store.Upsert(
		sf.Path, name, ext, sf.MtimeMs, sf.SizeBytes, status, body,
		nameTokens.Bi, pathTokens.Bi, bodyTokens.Bi,
		nameU, pathU, bodyU,
	)
}

// IndexOne incrementally (re-)indexes a single path. A missing path is
// removed from the index, which covers delete and rename-from events in one
// call. Unsupported extensions and directories are skipped so the watcher
// can feed raw filesystem events straight in.
func (ix *FileIndexer) IndexOne(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ix.store.Remove([]string{path})
		}
		return err
	}
	if info.IsDir() {
		return nil
	}
	ext := strings.ToLower(filepath.Ext(path))
	if _, ok := supportedExts[ext]; !ok {
		return nil
	}
	return ix.indexFile(ScannedFile{
		Path:      path,
		MtimeMs:   info.ModTime().UnixMilli(),
		SizeBytes: info.Size(),
	})
}

// RemoveIndexed deletes a single path from the index (metadata + FTS rows).
func (ix *FileIndexer) RemoveIndexed(path string) error {
	return ix.store.Remove([]string{path})
}
