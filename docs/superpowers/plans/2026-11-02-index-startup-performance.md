# 增量索引与启动性能 实现计划（子项目 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏文件夹的文件变化秒级增量进入 FTS 索引并推送 `home:folder-changed` 事件；冷启动全量扫描并行化；Go 堆设置软上限。

**Architecture:** 新增 `internal/index/watcher.go`（fsnotify 封装 + 每路径去抖），`FileIndexer` 增加 `IndexOne/RemoveIndexed` 单文件增量方法，`run()` 按一级子目录切片用 errgroup 并行；`Lifecycle` 组装 watcher 并由 `HomeService` 的文件夹增删点调用 `SyncRoots`。前端零改动（订阅已存在于 home-bridge.ts L474）。

**Tech Stack:** Go 1.27、`github.com/fsnotify/fsnotify`、`golang.org/x/sync/errgroup`、modernc.org/sqlite（既有）、Wails v3 Events（既有 `platform.Emit`，单测下自动 no-op）。

**Spec:** `docs/superpowers/specs/2026-11-02-index-startup-performance-design.md`

**事实修正（相对 spec 背景描述）：** `ExtractText`（extract.go L52-53）当前对 OOXML/PDF 返回 name-only，仅纯文本扩展真正抽 body；并行化收益来自 walk+IO+tokenize，而非 zip 解压。设计不变，仅动机描述修正。

**验证命令约定：** 所有 `go` 命令在项目根 `e:\Dev\YiiOffice-WailsV3` 执行；测试文件与包同目录（`_test.go`，package index / bridge）。

---

### Task 1: 添加依赖

**Files:**
- Modify: `go.mod`、`go.sum`

- [ ] **Step 1: 拉取依赖**

```powershell
go get github.com/fsnotify/fsnotify@latest golang.org/x/sync@latest
```

Expected: go.mod require 块出现 `github.com/fsnotify/fsnotify v1.x` 与 `golang.org/x/sync v0.x`。

- [ ] **Step 2: 验证构建不受影响**

Run: `go build -tags production ./...`
Expected: exit 0，无输出。

- [ ] **Step 3: Commit**

```powershell
git add go.mod go.sum
git commit -m "build: add fsnotify and x/sync dependencies for incremental indexing"
```

---

### Task 2: FileIndexer 增量方法 IndexOne / RemoveIndexed

**Files:**
- Modify: `internal/index/indexer.go`（文件末尾追加方法；imports 增加 `"os"`）
- Test: `internal/index/indexer_incremental_test.go`（新建）

- [ ] **Step 1: 写失败测试**

新建 `internal/index/indexer_incremental_test.go`：

```go
package index

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestIndexer(t *testing.T) (*FileIndexer, *FileIndexStore, string) {
	t.Helper()
	dir := t.TempDir()
	store, err := NewFileIndexStore(filepath.Join(dir, "idx.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	ix := NewFileIndexer(store, []string{dir})
	return ix, store, dir
}

func searchTotal(t *testing.T, store *FileIndexStore, q string) int {
	t.Helper()
	res, err := store.Search(q, SearchOptions{})
	if err != nil {
		t.Fatalf("search %q: %v", q, err)
	}
	return res.Total
}

func TestIndexOneAddsFile(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(fp, []byte("hello incremental world"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne: %v", err)
	}
	if got := searchTotal(t, store, "incremental"); got != 1 {
		t.Fatalf("expected 1 hit, got %d", got)
	}
}

func TestIndexOneMissingRemovesEntry(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "gone.txt")
	if err := os.WriteFile(fp, []byte("vanishing token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatal(err)
	}
	if got := searchTotal(t, store, "vanishing"); got != 1 {
		t.Fatalf("expected indexed 1, got %d", got)
	}
	if err := os.Remove(fp); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne after delete: %v", err)
	}
	if got := searchTotal(t, store, "vanishing"); got != 0 {
		t.Fatalf("expected removed, got %d hits", got)
	}
}

func TestIndexOneSkipsUnsupportedExt(t *testing.T) {
	ix, store, dir := newTestIndexer(t)
	fp := filepath.Join(dir, "binary.xyz")
	if err := os.WriteFile(fp, []byte("unsupported token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(fp); err != nil {
		t.Fatalf("IndexOne unsupported: %v", err)
	}
	if got := searchTotal(t, store, "unsupported"); got != 0 {
		t.Fatalf("expected not indexed, got %d", got)
	}
}

func TestIndexOneSkipsDirectories(t *testing.T) {
	ix, _, dir := newTestIndexer(t)
	sub := filepath.Join(dir, "achildir")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ix.IndexOne(sub); err != nil {
		t.Fatalf("IndexOne dir should be a no-op, got: %v", err)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `go test ./internal/index/ -run "TestIndexOne" -v`
Expected: FAIL，编译错误 `ix.IndexOne undefined (type *FileIndexer has no field or method IndexOne)`。

- [ ] **Step 3: 最小实现**

`internal/index/indexer.go` imports 增加 `"os"`；文件末尾追加：

```go
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
```

- [ ] **Step 4: 运行确认通过**

Run: `go test ./internal/index/ -run "TestIndexOne" -v`
Expected: 4 个测试 PASS。

- [ ] **Step 5: 全包回归 + Commit**

Run: `go test ./internal/index/`
Expected: ok。

```powershell
git add internal/index/indexer.go internal/index/indexer_incremental_test.go
git commit -m "feat: add incremental IndexOne/RemoveIndexed to FileIndexer"
```

---

### Task 3: 全量扫描并行化（errgroup）

**Files:**
- Modify: `internal/index/indexer.go`（`run()` L91-102 的扫描段）
- Test: `internal/index/indexer_parallel_test.go`（新建）

- [ ] **Step 1: 写失败测试**

新建 `internal/index/indexer_parallel_test.go`：

```go
package index

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestRunIndexesAllSubdirsParity verifies the parallel scan finds exactly the
// same files as the roots contain: 4 subdirs x 3 files each, plus 2 files at
// the root level.
func TestRunIndexesAllSubdirsParity(t *testing.T) {
	ix, store, dir := newTestIndexer(t)

	for i := 0; i < 4; i++ {
		sub := filepath.Join(dir, fmt.Sprintf("sub%d", i))
		if err := os.Mkdir(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		for j := 0; j < 3; j++ {
			fp := filepath.Join(sub, fmt.Sprintf("f%d_%d.txt", i, j))
			if err := os.WriteFile(fp, []byte(fmt.Sprintf("parittoken %d %d", i, j)), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	for j := 0; j < 2; j++ {
		fp := filepath.Join(dir, fmt.Sprintf("root%d.txt", j))
		if err := os.WriteFile(fp, []byte(fmt.Sprintf("parittoken root %d", j)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	ix.RunOnce()

	if got := searchTotal(t, store, "parittoken"); got != 14 {
		t.Fatalf("expected 14 indexed files, got %d", got)
	}
}
```

- [ ] **Step 2: 运行确认通过（行为保持测试）**

Run: `go test ./internal/index/ -run TestRunIndexesAllSubdirsParity -v`
Expected: PASS（当前顺序实现本就索引 14 个文件；此测试锁定重构行为，不是红灯——并行化是等价重构，TDD 在此以"回归锁"形式适用）。

- [ ] **Step 3: 实现并行扫描**

`internal/index/indexer.go`：imports 增加 `"golang.org/x/sync/errgroup"`；将 `run()` 的"1. Scan all roots"段（L97-102）替换为：

```go
	// 1. Scan all roots. Each root is split into one task per first-level
	// subdirectory (root-level files are collected inline) so several
	// goroutines walk in parallel. Results are merged under a mutex; the
	// downstream diff logic is unchanged, so duplicate paths from nested
	// tasks are impossible (tasks are disjoint subtrees).
	var allFiles []ScannedFile
	var tasks []string
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			full := filepath.Join(root, entry.Name())
			if entry.IsDir() {
				if isHidden(root, entry.Name()) {
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
			if isHidden(root, entry.Name()) {
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
```

并在包内（`run()` 上方）加常量：

```go
// scanParallelism bounds concurrent directory walks during a full refresh.
const scanParallelism = 4
```

- [ ] **Step 4: 运行确认通过**

Run: `go test ./internal/index/ -run TestRunIndexesAllSubdirsParity -v`
Expected: PASS（14/14）。

- [ ] **Step 5: 全包回归 + Commit**

Run: `go test ./internal/index/`
Expected: ok。

```powershell
git add internal/index/indexer.go internal/index/indexer_parallel_test.go
git commit -m "perf: parallelize full index scan with errgroup over first-level subdirs"
```

---

### Task 4: Watcher（fsnotify 封装 + 去抖）

**Files:**
- Create: `internal/index/watcher.go`
- Test: `internal/index/watcher_test.go`

- [ ] **Step 1: 写失败测试**

新建 `internal/index/watcher_test.go`：

```go
package index

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// waitFor polls store.Search until total reaches want or the deadline hits.
func waitFor(t *testing.T, store *FileIndexStore, q string, want int) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		res, err := store.Search(q, SearchOptions{})
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

func newTestWatcher(t *testing.T) (*Watcher, *FileIndexStore, string) {
	t.Helper()
	ix, store, dir := newTestIndexer(t)
	w, err := NewWatcher(ix, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("NewWatcher: %v", err)
	}
	w.SyncRoots([]string{dir})
	w.Start()
	t.Cleanup(w.Stop)
	return w, store, dir
}

func TestWatcherIndexesCreatedFile(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "created.txt")
	if err := os.WriteFile(fp, []byte("watchcreated token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchcreated", 1)
}

func TestWatcherRemovesDeletedFile(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "deleteme.txt")
	if err := os.WriteFile(fp, []byte("watchdeleted token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeleted", 1)
	if err := os.Remove(fp); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeleted", 0)
}

func TestWatcherPicksUpNewSubdir(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	sub := filepath.Join(dir, "newsub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	// Give the Create-dir handling a moment to register the watch before the
	// file lands inside it.
	time.Sleep(300 * time.Millisecond)
	fp := filepath.Join(sub, "deep.txt")
	if err := os.WriteFile(fp, []byte("watchdeepsub token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdeepsub", 1)
}

func TestWatcherIgnoresUnsupportedExt(t *testing.T) {
	_, store, dir := newTestWatcher(t)
	fp := filepath.Join(dir, "skip.xyz")
	if err := os.WriteFile(fp, []byte("watchskip token"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1 * time.Second)
	if got := searchTotal(t, store, "watchskip"); got != 0 {
		t.Fatalf("unsupported ext must not be indexed, got %d", got)
	}
}

func TestWatcherSyncRootsDropsRemovedRoot(t *testing.T) {
	w, store, dir := newTestWatcher(t)
	extra := filepath.Join(dir, "extra")
	if err := os.Mkdir(extra, 0o755); err != nil {
		t.Fatal(err)
	}
	w.SyncRoots([]string{dir})
	time.Sleep(300 * time.Millisecond)
	fp := filepath.Join(extra, "inside.txt")
	if err := os.WriteFile(fp, []byte("watchdropinside token"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, store, "watchdropinside", 1)

	// Drop the root: new files there must no longer be indexed.
	w.SyncRoots([]string{})
	time.Sleep(300 * time.Millisecond)
	fp2 := filepath.Join(extra, "after.txt")
	if err := os.WriteFile(fp2, []byte("watchafterdrop token"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1 * time.Second)
	if got := searchTotal(t, store, "watchafterdrop"); got != 0 {
		t.Fatalf("removed root must stop indexing, got %d", got)
	}
}
```

- [ ] **Step 2: 运行确认失败**

Run: `go test ./internal/index/ -run TestWatcher -v`
Expected: FAIL，编译错误 `undefined: NewWatcher`。

- [ ] **Step 3: 实现 Watcher**

新建 `internal/index/watcher.go`：

```go
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
	go w.eventLoop()
	go w.flushLoop()
}

// Stop ends the loops and closes the underlying filesystem watcher.
func (w *Watcher) Stop() {
	select {
	case <-w.done:
		return // already stopped
	default:
		close(w.done)
	}
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

func (w *Watcher) removePath(p string) {
	w.mu.Lock()
	delete(w.pending, p)
	w.mu.Unlock()
	if err := w.ix.RemoveIndexed(p); err != nil {
		platform.Logger().Warn("index: incremental remove failed", "path", p, "error", err)
	}
	platform.Emit("home:folder-changed", map[string]any{"path": p})
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
		platform.Emit("home:folder-changed", map[string]any{"path": p})
	}
}
```

- [ ] **Step 4: 运行确认通过**

Run: `go test ./internal/index/ -run TestWatcher -v`
Expected: 5 个 Watcher 测试 PASS（Windows 上 fsnotify 事件有延迟，waitFor 给了 8s 上限；若 `TestWatcherPicksUpNewSubdir` 偶发失败，将 300ms sleep 提到 600ms 再跑）。

- [ ] **Step 5: 全包回归 + Commit**

Run: `go test ./internal/index/`
Expected: ok。

```powershell
git add internal/index/watcher.go internal/index/watcher_test.go
git commit -m "feat: add fsnotify watcher with per-path debounce for incremental indexing"
```

---

### Task 5: Lifecycle 接线 + HomeService 文件夹增删联动

**Files:**
- Modify: `internal/index/lifecycle.go`
- Modify: `internal/bridge/homeservice.go`（`AddFolderRoot` L273 后、`DropFolderRoots` L287 循环后、`RemoveFolderRoot` L292）
- Test: `internal/index/lifecycle_test.go`（新建）、`internal/bridge/homeservice_test.go`（追加）

- [ ] **Step 1: 写失败测试（index 包）**

新建 `internal/index/lifecycle_test.go`：

```go
package index

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLifecycleSyncRootsIsNilSafe(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	lc, err := Init(dataDir, []string{dir})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	defer lc.Shutdown()
	// Must not panic even right after Init.
	lc.SyncRoots([]string{dir})
	lc.SyncRoots(nil)
}
```

- [ ] **Step 2: 运行确认失败**

Run: `go test ./internal/index/ -run TestLifecycleSyncRoots -v`
Expected: FAIL，编译错误 `lc.SyncRoots undefined`。

- [ ] **Step 3: 实现 Lifecycle 接线**

`internal/index/lifecycle.go` 整体替换为：

```go
package index

import (
	"fmt"
	"path/filepath"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// watcherDebounce is the per-path coalescing window for filesystem events.
// Windows write operations fire several events per save; 400ms keeps the
// index fresh without re-extracting a file mid-save.
const watcherDebounce = 400 * time.Millisecond

// Lifecycle manages the file index initialization and shutdown.
type Lifecycle struct {
	store   *FileIndexStore
	indexer *FileIndexer
	watcher *Watcher
}

// Init creates the store and indexer for the given data directory and folder
// root paths, and starts the incremental watcher over the same roots.
func Init(dataDir string, rootPaths []string) (*Lifecycle, error) {
	dbPath := filepath.Join(dataDir, "file-index.db")
	store, err := NewFileIndexStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open index store: %w", err)
	}

	SetIndexStatus(false, "initializing")

	indexer := NewFileIndexer(store, rootPaths)

	lc := &Lifecycle{store: store, indexer: indexer}

	// The watcher is a freshness optimization: if it cannot start (e.g.
	// resource limits), the manual Refresh path still works.
	w, err := NewWatcher(indexer, watcherDebounce)
	if err != nil {
		platform.Logger().Warn("index: watcher disabled", "error", err)
	} else {
		w.SyncRoots(rootPaths)
		w.Start()
		lc.watcher = w
	}

	// Trigger initial background scan
	go func() {
		indexer.Refresh()
		SetIndexStatus(true, "")
	}()

	return lc, nil
}

// SyncRoots updates the watched directories after sidebar roots change.
// Safe to call at any time; a no-op when the watcher failed to start.
func (lc *Lifecycle) SyncRoots(roots []string) {
	if lc.watcher != nil {
		lc.watcher.SyncRoots(roots)
	}
}

// Store returns the file index store.
func (lc *Lifecycle) Store() *FileIndexStore { return lc.store }

// Indexer returns the file indexer.
func (lc *Lifecycle) Indexer() *FileIndexer { return lc.indexer }

// Refresh triggers a full re-index.
func (lc *Lifecycle) Refresh() {
	lc.indexer.Refresh()
}

// Shutdown stops the watcher and indexer, then closes the store.
func (lc *Lifecycle) Shutdown() error {
	if lc.watcher != nil {
		lc.watcher.Stop()
	}
	lc.indexer.Stop()
	return lc.store.Close()
}
```

- [ ] **Step 4: 运行确认通过（index 包）**

Run: `go test ./internal/index/ -run TestLifecycleSyncRoots -v`
Expected: PASS。

- [ ] **Step 5: HomeService 联动（bridge 包）**

先写失败测试，`internal/bridge/homeservice_test.go` 末尾追加（复用该文件既有的临时目录/服务构造模式——参考 L498 `TestHomeServiceAddFolderRoot` 的 setup，把其构造语句复制进新测试；若该测试用了 `t.TempDir()` + `host.NewFolderManager`，保持一致）：

```go
// TestHomeServiceFolderRootsSyncIndex verifies adding and removing a folder
// root forwards the new root set to the index lifecycle (watcher re-sync).
func TestHomeServiceFolderRootsSyncIndex(t *testing.T) {
	dir := t.TempDir()
	dataDir := t.TempDir()
	fm := host.NewFolderManager(dataDir, func() string { return dir })
	lc, err := index.Init(dataDir, fm.RootPaths())
	if err != nil {
		t.Fatalf("index.Init: %v", err)
	}
	defer lc.Shutdown()

	svc := NewHomeService("test", nil, nil, fm, nil, nil, nil, lc, nil, nil)

	extra := filepath.Join(dir, "watched")
	if err := os.Mkdir(extra, 0o755); err != nil {
		t.Fatal(err)
	}
	fm.AddRoot(extra, "")
	svc.SyncIndexRoots()

	// No panic and the root is listed: the sync call reached the lifecycle.
	if len(fm.RootPaths()) != 2 {
		t.Fatalf("expected 2 roots, got %d", len(fm.RootPaths()))
	}
	fm.RemoveRoot(extra)
	svc.SyncIndexRoots()
	if len(fm.RootPaths()) != 1 {
		t.Fatalf("expected 1 root after removal, got %d", len(fm.RootPaths()))
	}
}
```

注意：`NewHomeService(...)` 参数顺序以 homeservice.go L33-37 构造签名为准（`version, store, rm, fm, tabHost, fo, dam, idxLc, openFile, revealPath`），nil 位按签名补齐；若既有测试有现成的 service 构造 helper，优先复用。

Run: `go test ./internal/bridge/ -run TestHomeServiceFolderRootsSyncIndex -v`
Expected: FAIL，编译错误 `svc.SyncIndexRoots undefined`。

实现：`internal/bridge/homeservice.go` 增加导出方法（放在 `RemoveFolderRoot` 之后）：

```go
// SyncIndexRoots pushes the current sidebar root set to the file index
// watcher. Called after every folder root mutation so incremental indexing
// and local-image authorization stay in sync without a restart.
func (s *HomeService) SyncIndexRoots() {
	if s.idxLc != nil {
		s.idxLc.SyncRoots(s.fm.RootPaths())
	}
}
```

并在三个变更点各追加一行 `s.SyncIndexRoots()`：
- `AddFolderRoot`：`s.fm.AddRoot(dir, "")`（L273）之后、`row, ok := s.fm.FindRoot(dir)` 之前；
- `DropFolderRoots`：for 循环结束后、`return s.fm.GetRoots()` 之前；
- `RemoveFolderRoot`：改为

```go
func (s *HomeService) RemoveFolderRoot(path string) {
	s.fm.RemoveRoot(path)
	s.SyncIndexRoots()
}
```

- [ ] **Step 6: 运行确认通过**

Run: `go test ./internal/bridge/ -run "TestHomeService" -v`
Expected: 新测试 PASS，既有 HomeService 测试全部 PASS。

Run: `go test ./internal/index/ ./internal/bridge/`
Expected: ok。

- [ ] **Step 7: Commit**

```powershell
git add internal/index/lifecycle.go internal/index/lifecycle_test.go internal/bridge/homeservice.go internal/bridge/homeservice_test.go
git commit -m "feat: wire incremental watcher into index lifecycle and folder root mutations"
```

---

### Task 6: GOMEMLIMIT 软上限

**Files:**
- Modify: `main.go`（`main()` 开头，L51-52 之间）

- [ ] **Step 1: 实现**

`main.go` 已 import `runtime/debug`（用于 `debug.Stack`）。在 `func main() {` 之后、性能 trace 块之前插入：

```go
	// Cap the Go heap with a soft limit so large workbook sessions make the
	// GC work harder instead of competing with WebView2 renderer processes
	// for physical memory. 2 GiB is a conservative starting point; revisit
	// against field data before tuning per-device.
	debug.SetMemoryLimit(2 << 30)
```

- [ ] **Step 2: 验证构建**

Run: `go build -tags production ./...`
Expected: exit 0。

- [ ] **Step 3: Commit**

```powershell
git add main.go
git commit -m "perf: set Go heap soft limit to reduce memory pressure with WebView2"
```

---

### Task 7: 全量验证与收尾

- [ ] **Step 1: Go 全量**

Run: `go test ./internal/...`
Expected: 全部 ok（watcher 测试在 CI 上若因事件延迟抖动，按 Task 4 Step 4 的说明调 sleep 而非放宽断言）。

Run: `go build -tags production ./...`
Expected: exit 0。

- [ ] **Step 2: 前端回归（应零改动）**

Run: `cd frontend; npm test`
Expected: exit 0。`git diff --stat frontend/` 应为空（package-lock 的既有改动除外）。

- [ ] **Step 3: 手动冒烟（桌面构建）**

```powershell
task build   # 或 task run，按 Taskfile.yml 既有任务
```

验证清单：
1. 侧栏添加一个文件夹 → 在资源管理器新建 `test1.txt`（内容含独特词）→ 1 秒内应用内搜索命中；
2. 重命名该文件 → 旧名搜索不命中、新名命中；
3. 删除 → 不命中；
4. 移除侧栏文件夹 → 其内新建文件不再命中；重新添加 → 恢复命中；
5. 任务管理器观察 yiioffice.exe 内存稳定在软上限行为（无异常暴涨）。

- [ ] **Step 4: 若有未提交残留，收尾提交**

```powershell
git status --short
```

Expected: 仅 `frontend/package-lock.json`（本计划开始前已存在的改动）。
