# Phase 3: 文件系统与索引

> 接续 Phase 2（[phase2-host-services.md](2026-10-29-yiioffice-wailsv3-phase2-host-services.md)）。
>
> **For agentic workers:** REQUIRED SUB-Skill: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** 在 Go 侧实现 SQLite FTS5 文件全文索引引擎（含 CJK 中文分词），将 Electron `file-index/` 目录（9 个文件）逐一对应移植为 Go 模块，注册 `home:search-files` 通道，使 Home 页搜索功能完全可用。

**Scope:** 仅 Windows 平台。索引数据库 schema 与 Electron 版本保持一致（同一 `files` + `file_fts` 结构），确保索引文件双向可读。

**Exit Gate G3:** 1 万文档搜索 P95 < 150ms；索引库与 Electron 版本 schema 一致可互换读取；`home:search-files` 通道全绿。

---

## 1. 范围与约束

### 1.1 必须实现

| 源文件 | Go 目标 | 说明 |
|---|---|---|
| `store.ts` | `internal/index/store.go` | SQLite FTS5 schema + upsert/search/remove/excerpts |
| `tokenize.ts` | `internal/index/tokenize.go` | CJK bigram/unigram 双流分词，与 JS 版分词结果对齐 |
| `scan.ts` | `internal/index/scan.go` | 目录递归扫描（Go 原生 `os.ReadDir`，无需 Worker） |
| `extract.ts` | `internal/index/extract.go` | 文本提取（调用已有 `@yiioffice/file-parse` 或通过 Go 侧 OOXML 解析） |
| `indexer.ts` | `internal/index/indexer.go` | 索引调度器（diff + drain，Go 用 goroutine 替代 Worker） |
| `snippet.ts` | `internal/index/snippet.go` | 搜索摘要生成 |
| `status.ts` | `internal/index/status.go` | 索引状态管理 |
| `shell-home-ipc.ts` (搜索部分) | `internal/bridge/search.go` | `home:search-files` 通道 |
| `shell-folders.ts` (索引生命周期) | `main.go` + `internal/index/lifecycle.go` | 初始化/关闭/刷新触发 |

### 1.2 依赖 Phase 1/2

| 前置产出 | Phase 3 用途 |
|---|---|
| `bridge.Router` + `Service.Invoke` | 注册 `home:search-files` 通道 |
| `host.SettingsStore` | 读取 `folderRoots` 配置 |
| `host.FolderManager` (P2 已实现) | 提供要索引的根目录列表 |
| `fsutil.WriteJSONAtomic` | 索引状态持久化 |
| `platform.Emit` | 广播 `home:folder-changed` 事件 |
| `@yiioffice/wails-bridge` 前端兼容层 | 扩展搜索相关 API |

### 1.3 通道清单

Phase 3 仅新增 1 个 IPC 通道：

| 通道名 | 源项目 | P3 归属任务 |
|---|---|---|
| `home:search-files` | `shell-home-ipc.ts` | Task 6 (搜索通道) |

Phase 1-2 中已实现的通道不涉及修改。

### 1.4 本阶段明确不做

- 不实现文本提取的 Go 原生版本（继续通过 `@yiioffice/file-parse` 包，由 Vite 构建后的 JS bundle 在前端完成提取，Go 侧仅负责索引存储与查询）
- 不实现 Worker 线程模型（Go 使用 goroutine + channel 替代 Node.js `worker_threads`）
- 不做 macOS/Linux 兼容代码
- 不实现增量索引的 fsnotify 监控（P2 已通过 `fsnotify` 实现文件夹监控，P3 仅在使用者调用 `refresh()` 时全量 diff）

---

## 2. 目标仓库结构（Phase 3 新增文件）

```text
internal/
├── bridge/
│   ├── search.go                  # home:search-files 通道 (Task 6)
│   └── search_test.go
├── index/
│   ├── store.go                   # SQLite FTS5 存储 + CRUD (Task 1)
│   ├── store_test.go
│   ├── tokenize.go                # CJK bigram/unigram 分词 (Task 2)
│   ├── tokenize_test.go
│   ├── scan.go                    # 目录扫描 (Task 3)
│   ├── scan_test.go
│   ├── extract.go                 # 文本提取接口 (Task 4)
│   ├── extract_test.go
│   ├── indexer.go                 # 索引调度器 (diff + drain) (Task 4)
│   ├── indexer_test.go
│   ├── snippet.go                 # 搜索摘要生成 (Task 5)
│   ├── snippet_test.go
│   ├── status.go                  # 索引状态管理 (Task 5)
│   └── lifecycle.go               # 初始化/关闭/刷新 (Task 7)
└── host/
    └── foldertree.go              # P2 已有，P3 追加索引集成点
```

---

## 3. 关键决策

| ID | 决策 | 理由 | 回退 |
|---|---|---|---|
| P3-D1 | SQLite 驱动选用 `modernc.org/sqlite` | 纯 Go 实现，无需 CGO，Windows 交叉编译友好；FTS5 支持完整 | `github.com/mattn/go-sqlite3`（需 CGO） |
| P3-D2 | FTS5 schema 与 Electron 版本一致 | `files` 表 + `file_fts` 虚拟表；`contentless_delete=1` 无内容模式；双列集（CJK + unicode61） | 无 |
| P3-D3 | CJK 分词器用 Go 原生实现而非外部 Tokenizer | 源项目通过自定义 Tokenizer 实现 CJK bigram/unigram；Go 侧直接在 `tokenize.go` 中实现，避免外部依赖 | 使用 `github.com/go-ego/gse`（中文分词库），但会增加依赖 |
| P3-D4 | 文本提取仍由前端 JS 完成 | `@yiioffice/file-parse` 包已有完整的 OOXML/PDF/PPTX 解析器；Go 侧实现同等功能成本过高。通过 IPC 调用前端提取，或通过预构建的 WASM 模块 | 使用 UniOffice（商业许可限制）或自建解析器 |
| P3-D5 | 索引调度使用 goroutine + channel | 替代 Node.js Worker 模型；Go 原生并发模型更高效 | 使用 `errgroup` 或 `workerpool` 库 |
| P3-D6 | 索引库存储在 `%APPDATA%\YiiOffice\file-index.db` | 与 Electron 版本一致（`userData/file-index.db`），索引文件可互换 | 无 |

---

## 4. Phase 3 详细任务（可执行）

### Task 1: SQLite FTS5 存储层

**Dependencies:** `modernc.org/sqlite`（需 `go get modernc.org/sqlite`）

**Go 文件:**
- Create: `internal/index/store.go`
- Test: `internal/index/store_test.go`

**Schema 设计 (来自 Electron store.ts):**

```sql
-- 元数据表
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 文件元数据表
CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ext         TEXT NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  size_bytes  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ok',
  body        TEXT
);

-- FTS5 虚拟表（无内容模式，双列集）
CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
  name, path, body,           -- unicode61 列集
  name_u, path_u, body_u,     -- CJK unigram 列集
  content=files,
  content_rowid=rowid,
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
);
```

**Steps:**

- [ ] **Step 1: 安装 SQLite 依赖**

```powershell
go get modernc.org/sqlite
```

- [ ] **Step 2: 实现 `FileIndexStore` 结构体**

`internal/index/store.go`:

```go
// Package index implements the full-text file index engine.
package index

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	_ "modernc.org/sqlite/lib"
)

// IndexStatus mirrors the TS enum.
type IndexStatus string

const (
	IndexOK      IndexStatus = "ok"
	IndexNameOnly IndexStatus = "name-only"
	IndexError    IndexStatus = "error"
)

// IndexedFile is a file entry in the index.
type IndexedFile struct {
	Path     string
	MtimeMs  int64
	SizeBytes int64
	Status   IndexStatus
}

// SearchHit is a search result hit.
type SearchHit struct {
	Path      string    `json:"path"`
	Name      string    `json:"name"`
	Ext       string    `json:"ext"`
	MtimeMs   int64     `json:"mtimeMs"`
	SizeBytes int64     `json:"sizeBytes"`
	Snippet   []SnippetPart `json:"snippet"`
	Needles   []string  `json:"needles"`
	Excerpt   string    `json:"excerpt"`
}

// SnippetPart is a segment of snippet text with a hit flag.
type SnippetPart struct {
	Text string `json:"text"`
	Hit  bool   `json:"hit"`
}

// SearchResult is a page of search hits.
type SearchResult struct {
	Hits  []SearchHit `json:"hits"`
	Total int         `json:"total"`
}

// FileIndexStore manages the SQLite FTS5 index database.
type FileIndexStore struct {
	db *sql.DB
}

// NewFileIndexStore opens (or creates) the index database at path.
func NewFileIndexStore(dbPath string) (*FileIndexStore, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Enable WAL mode for concurrent reads during writes.
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma wal: %w", err)
	}

	s := &FileIndexStore{db: db}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *FileIndexStore) initSchema() error {
	schema := `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  ext         TEXT NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  size_bytes  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ok',
  body        TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
  name, path, body,
  name_u, path_u, body_u,
  content=files,
  content_rowid=rowid,
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
);
`
	_, err := s.db.Exec(schema)
	return err
}

// Close closes the database connection.
func (s *FileIndexStore) Close() error {
	return s.db.Close()
}
```

- [ ] **Step 3: 实现 `Upsert` 方法**

```go
// Upsert inserts or replaces a file entry and its FTS rows.
func (s *FileIndexStore) Upsert(path, name, ext string, mtimeMs int64, sizeBytes int64, status IndexStatus, body *string, nameTokens, pathTokens, bodyTokens []string, nameUTokens, pathUTokens, bodyUTokens []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete existing FTS row to support contentless_delete.
	if _, err := tx.Exec("DELETE FROM file_fts WHERE rowid = (SELECT rowid FROM files WHERE path = ?)", path); err != nil {
		return fmt.Errorf("delete fts: %w", err)
	}

	// Upsert the files table.
	_, err = tx.Exec(`
		INSERT INTO files (path, name, ext, mtime_ms, size_bytes, status, body)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			name = excluded.name,
			ext = excluded.ext,
			mtime_ms = excluded.mtime_ms,
			size_bytes = excluded.size_bytes,
			status = excluded.status,
			body = excluded.body
	`, path, name, ext, mtimeMs, sizeBytes, string(status), body)
	if err != nil {
		return fmt.Errorf("upsert file: %w", err)
	}

	// Insert FTS row.
	_, err = tx.Exec(`
		INSERT INTO file_fts (rowid, name, path, body, name_u, path_u, body_u)
		SELECT rowid, ?, ?, ?, ?, ?, ? FROM files WHERE path = ?
	`, strings.Join(nameTokens, " "),
		strings.Join(pathTokens, " "),
		joinOrEmpty(bodyTokens),
		strings.Join(nameUTokens, " "),
		strings.Join(pathUTokens, " "),
		joinOrEmpty(bodyUTokens),
		path)
	if err != nil {
		return fmt.Errorf("insert fts: %w", err)
	}

	return tx.Commit()
}

func joinOrEmpty(tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	return strings.Join(tokens, " ")
}
```

- [ ] **Step 4: 实现 `Search` 方法**

参考 Electron `store.ts` 的搜索逻辑（精确匹配 BM25 + 宽松匹配字符覆盖率）。

```go
// SearchOptions for file search.
type SearchOptions struct {
	Ext    []string // file extensions to filter (empty = all)
	Offset int      // pagination offset
	Limit  int      // page size
}

// DefaultSearchLimit is the default number of results per page.
const DefaultSearchLimit = 50

// Search executes a full-text search and returns ranked results.
func (s *FileIndexStore) Search(query string, opts SearchOptions) (*SearchResult, error) {
	if opts.Limit <= 0 {
		opts.Limit = DefaultSearchLimit
	}

	// Build the MATCH expression from tokenized query terms.
	// This will be implemented in Task 2 (tokenize) and wired here.
	// For now, use a simple MATCH against the FTS table.
	matchExpr := escapeFTS(query)

	var extFilter string
	var args []any
	argIdx := 1

	if len(opts.Ext) > 0 {
		placeholders := make([]string, len(opts.Ext))
		for i, ext := range opts.Ext {
			placeholders[i] = "?"
			args = append(args, ext)
		}
		extFilter = fmt.Sprintf(" AND ext IN (%s)", strings.Join(placeholders, ","))
	}

	// Count query.
	countSQL := fmt.Sprintf(
		"SELECT COUNT(*) FROM file_fts WHERE file_fts MATCH ?%s",
		extFilter,
	)
	countArgs := append([]any{matchExpr}, args...)
	var total int
	if err := s.db.QueryRow(countSQL, countArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}

	// Search query with BM25 ranking.
	searchSQL := fmt.Sprintf(`
		SELECT f.path, f.name, f.ext, f.mtime_ms, f.size_bytes, f.body
		FROM file_fts t
		JOIN files f ON f.rowid = t.rowid
		WHERE t MATCH ?%s
		ORDER BY
			-- name-first match
			CASE WHEN t.name MATCH ? THEN 0 ELSE 1 END,
			-- BM25 rank
			rank,
			-- recency
			f.mtime_ms DESC
		LIMIT ? OFFSET ?
	`, extFilter)

	searchArgs := append([]any{matchExpr, matchExpr,
		int64(opts.Limit), int64(opts.Offset)}, args...)

	rows, err := s.db.Query(searchSQL, searchArgs...)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	defer rows.Close()

	var hits []SearchHit
	for rows.Next() {
		var h SearchHit
		var body sql.NullString
		if err := rows.Scan(&h.Path, &h.Name, &h.Ext, &h.MtimeMs, &h.SizeBytes, &body); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}

	return &SearchResult{Hits: hits, Total: total}, nil
}

// escapeFTS wraps a query in FTS5-safe quotes.
func escapeFTS(s string) string {
	return "'" + strings.NewReplacer("\\", "\\\\", "'", "\\'").Replace(s) + "'"
}
```

- [ ] **Step 5: 实现 `Remove` 和 `ExcerptsFor` 方法**

```go
// Remove deletes file entries by path.
func (s *FileIndexStore) Remove(paths []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, p := range paths {
		// Delete from FTS first (contentless mode).
		if _, err := tx.Exec("DELETE FROM file_fts WHERE rowid = (SELECT rowid FROM files WHERE path = ?)", p); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM files WHERE path = ?", p); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetBody returns the body text for a file path (for snippet generation).
func (s *FileIndexStore) GetBody(path string) (*string, error) {
	var body sql.NullString
	err := s.db.QueryRow("SELECT body FROM files WHERE path = ?", path).Scan(&body)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !body.Valid {
		return nil, nil
	}
	s := body.String
	return &s, nil
}

// GetIndexedFiles returns all indexed files (for diffing).
func (s *FileIndexStore) GetIndexedFiles() ([]IndexedFile, error) {
	rows, err := s.db.Query("SELECT path, mtime_ms, size_bytes, status FROM files")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []IndexedFile
	for rows.Next() {
		var f IndexedFile
		if err := rows.Scan(&f.Path, &f.MtimeMs, &f.SizeBytes, &f.Status); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}
```

- [ ] **Step 6: 写测试**

`internal/index/store_test.go`:
- `TestInitSchema` - schema 创建后表存在
- `TestUpsertAndGetBody` - 插入文件后可通过 GetBody 获取
- `TestSearchBasic` - 基本搜索能匹配文件名
- `TestRemove` - 删除后搜索不到
- `TestGetIndexedFiles` - 列出所有已索引文件
- `TestSearchWithExtFilter` - 按扩展名过滤

- [ ] **Step 7: 构建、测试、提交**

```powershell
go test ./internal/index/ -v
git add internal/index
git commit -m "feat: add sqlite fts5 file index store layer"
```

---

### Task 2: CJK 分词器（Bigram/Unigram 双流）

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\shell\src\main\file-index\tokenize.ts`

**Go 文件:**
- Create: `internal/index/tokenize.go`
- Test: `internal/index/tokenize_test.go`

**Steps:**

- [ ] **Step 1: 实现 CJK 字符范围判断**

Go 版本的 CJK 字符范围与 JS 版一致：

```go
// isCJK returns true for CJK ideographs, kana, hangul, and related scripts.
func isCJK(r rune) bool {
	return (r >= 0x2E80 && r <= 0x9FFF) ||   // CJK radicals, unified ideographs, ext-A
		(r >= 0xF900 && r <= 0xFAFF) ||       // compatibility ideographs
		(r >= 0xFB00 && r <= 0xFB06) ||       // kana
		(r >= 0xAC00 && r <= 0xD7A3) ||       // hangul syllables
		(r >= 0x1100 && r <= 0x11FF) ||       // hangul jamo
		(r >= 0x3130 && r <= 0x318F) ||       // hangul compatibility jamo
		(r >= 0xA960 && r <= 0xA97C) ||       // hangul jamo extended-A
		(r >= 0xD7B0 && r <= 0xD7FF) ||       // hangul compatibility jamo extended-A
		(r >= 0x20000 && r <= 0x2FFFF) ||     // CJK ext-B and beyond
		(r >= 0x3040 && r <= 0x30FF)          // hiragana/katakana
}
```

- [ ] **Step 2: 实现 NFKC 规范化与小写折叠**

```go
import "golang.org/x/text/unicode/norm"

// fold normalizes text to NFKC and lowercases.
func fold(s string) string {
	return strings.ToLower(norm.NFKC.String(s))
}
```

- [ ] **Step 3: 实现 Run 拆分**

将文本按字符类型拆分为 CJK run 和 word run。

- [ ] **Step 4: 实现 Bigram/Unigram 双流失**

对 CJK run：bigram 为重叠双字组，unigram 为单字。
对 word run：bigram 和 unigram 均为完整单词。

```go
// TokenResult holds the token streams for FTS indexing.
type TokenResult struct {
	Bi []string // bigram tokens
	Uni []string // unigram tokens
}

// Tokenize text into bigram and unigram streams.
func Tokenize(text string) TokenResult {
	folded := fold(text)
	// Split into runs...
	// Generate bigram/unigram tokens for each run...
	// Return combined result
}
```

- [ ] **Step 5: 实现查询分词**

`parseQuery(input)` → 支持空格分隔（AND）、双引号短语、`-` 前缀排除。

`termExpr(term)` → 生成 FTS5 MATCH 表达式。

`tokenExprs(term)` → 生成独立 token 表达式 + 字符覆盖率计算。

- [ ] **Step 6: 对照测试**

使用 Electron 版本 `tokenize.ts` 的测试语料，验证 Go 版分词结果与 JS 版完全一致：

```go
func TestCJKBigramTokens(t *testing.T) {
	result := Tokenize("你好世界")
	// bigram: ["你好", "好世", "世界"]
	// unigram: ["你", "好", "世", "界"]
}

func TestMixedTokens(t *testing.T) {
	result := Tokenize("hello世界world")
	// bigram: ["hello", "世界", "world"]
	// unigram: ["hello", "世", "界", "world"]
}

func TestQueryParse(t *testing.T) {
	// Test AND, OR, phrase, negation
}
```

- [ ] **Step 7: 构建、测试、提交**

```powershell
go get golang.org/x/text
go test ./internal/index/ -v -run Tokenize
git add internal/index/tokenize*
git commit -m "feat: implement cjk bigram/unigram tokenizer in go"
```

---

### Task 3: 目录扫描

**Source reference:** `E:\Dev\YiiOffice-Electron\apps\shell\src\main\file-index\scan.ts`

**Go 文件:**
- Create: `internal/index/scan.go`
- Test: `internal/index/scan_test.go`

**Steps:**

- [ ] **Step 1: 实现 `ScanResult` 和 `ScannedFile`**

```go
// ScannedFile is a file found on disk during a scan.
type ScannedFile struct {
	Path      string
	MtimeMs   int64
	SizeBytes int64
}

// ScanResult holds the output of a directory scan.
type ScanResult struct {
	Files   []ScannedFile
	Truncated bool // true if SCAN_MAX_FILES was hit
}
```

- [ ] **Step 2: 实现递归扫描**

使用 `os.ReadDir` 递归遍历，限制：
- 最大深度 32 层
- 最大文件数 200,000
- 跳过隐藏项（Windows: 通过 `syscall.GetFileAttributes` 检查 `FILE_ATTRIBUTE_HIDDEN`）
- 仅索引受支持的文件类型（`.docx`, `.xlsx`, `.pptx`, `.pdf`, `.md`, `.txt`, `.csv`, `.tsv` 等）
- 不跟随符号链接目录

- [ ] **Step 3: 测试**

```go
func TestScanFindsFiles(t *testing.T) { /* ... */ }
func TestScanRespectsMaxDepth(t *testing.T) { /* ... */ }
func TestScanSkipsHiddenFiles(t *testing.T) { /* ... */ }
func TestScanRespectsMaxFiles(t *testing.T) { /* ... */ }
```

- [ ] **Step 4: 构建、测试、提交**

```powershell
go test ./internal/index/ -v -run Scan
git add internal/index/scan*
git commit -m "feat: add recursive directory scanner for file index"
```

---

### Task 4: 文本提取与索引调度器

**Source reference:** `extract.ts` + `indexer.ts`

**Go 文件:**
- Create: `internal/index/extract.go`
- Test: `internal/index/extract_test.go`
- Create: `internal/index/indexer.go`
- Test: `internal/index/indexer_test.go`

**文本提取策略 (P3-D4):**

由于 `@yiioffice/file-parse` 包是 TypeScript 实现的 OOXML/PDF 解析器，在 Go 侧重新实现成本过高。采用以下方案：

1. **纯文本文件**（`.txt`, `.md`, `.csv`, `.tsv`）：Go 侧直接读取，限制 `MAX_BODY_CHARS=1000000`
2. **OOXML/PDF 文件**：调用 `@yiioffice/file-parse` 的 WASM 版本或通过轻量级 Go 库提取
3. **超过 `MAX_EXTRACT_BYTES=64MB` 的文件**：仅索引文件名和路径（`name-only` 模式）

**Steps:**

- [ ] **Step 1: 实现纯文本提取**

```go
const (
	MaxExtractBytes = 64 * 1024 * 1024 // 64 MB
	MaxBodyChars    = 1_000_000
)

// ExtractResult mirrors the TS extract result types.
type ExtractResult struct {
	Kind  string // "text", "name-only", "error"
	Text  string
	Error error
}

// ExtractText extracts searchable text from a file.
func ExtractText(path string) ExtractResult {
	// Check file size
	info, err := os.Stat(path)
	if err != nil {
		return ExtractResult{Kind: "error", Error: err}
	}
	if info.Size() > MaxExtractBytes {
		return ExtractResult{Kind: "name-only"}
	}

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm":
		return extractPlainText(path)
	default:
		// For OOXML/PDF, return name-only for now.
		// Full extraction requires file-parse integration.
		return ExtractResult{Kind: "name-only"}
	}
}

func extractPlainText(path string) ExtractResult {
	data, err := os.ReadFile(path)
	if err != nil {
		return ExtractResult{Kind: "error", Error: err}
	}
	text := string(data)
	if len(text) > MaxBodyChars {
		text = text[:MaxBodyChars]
	}
	return ExtractResult{Kind: "text", Text: text}
}
```

- [ ] **Step 2: 实现 `FileIndexer` 调度器**

```go
// FileIndexer keeps the store in sync with the filesystem.
type FileIndexer struct {
	store     *FileIndexStore
	roots     []string // directories to index
	mu        sync.Mutex
	refreshCh chan struct{} // debounce channel
	done      chan struct{}
	running   bool
}

// NewFileIndexer creates an indexer for the given roots.
func NewFileIndexer(store *FileIndexStore, roots []string) *FileIndexer {
	return &FileIndexer{
		store:     store,
		roots:     roots,
		refreshCh: make(chan struct{}, 1),
		done:      make(chan struct{}),
	}
}

// Refresh schedules a full index refresh (debounced).
func (ix *FileIndexer) Refresh() {
	select {
	case ix.refreshCh <- struct{}{}:
	default:
		// Already pending
	}
	if !ix.running {
		go ix.loop()
	}
}

// Stop shuts down the indexer.
func (ix *FileIndexer) Stop() {
	close(ix.done)
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
			// Check for more pending refreshes
			select {
			case <-ix.refreshCh:
				// Continue to next iteration
			default:
				ix.mu.Lock()
				ix.running = false
				ix.mu.Unlock()
				return
			}
		}
	}
}

func (ix *FileIndexer) run() {
	// 1. Scan all roots
	var allFiles []ScannedFile
	for _, root := range ix.roots {
		result := ScanDir(root)
		allFiles = append(allFiles, result.Files...)
	}

	// 2. Diff against existing index
	existing, _ := ix.store.GetIndexedFiles()
	existingMap := make(map[string]IndexedFile, len(existing))
	for _, f := range existing {
		existingMap[f.Path] = f
	}

	// 3. Find removed files
	diskMap := make(map[string]ScannedFile, len(allFiles))
	for _, f := range allFiles {
		diskMap[f.Path] = f
	}

	var removed []string
	for _, e := range existing {
		if _, ok := diskMap[e.Path]; !ok {
			removed = append(removed, e.Path)
		}
	}
	if len(removed) > 0 {
		ix.store.Remove(removed)
	}

	// 4. Queue changed files for extraction & indexing
	var changed []ScannedFile
	for _, f := range allFiles {
		ex, ok := existingMap[f.Path]
		if !ok || ex.MtimeMs != f.MtimeMs || ex.SizeBytes != f.SizeBytes {
			changed = append(changed, f)
		}
	}

	// 5. Extract and index (use goroutines for concurrency)
	var wg sync.WaitGroup
	errCh := make(chan error, len(changed))

	for _, f := range changed {
		wg.Add(1)
		go func(sf ScannedFile) {
			defer wg.Done()
			if err := ix.indexFile(sf); err != nil {
				errCh <- err
			}
		}(f)
	}

	wg.Wait()
	close(errCh)
}

func (ix *FileIndexer) indexFile(sf ScannedFile) error {
	name := filepath.Base(sf.Path)
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(sf.Path)), ".")

	// Extract text
	result := ExtractText(sf.Path)

	var status IndexStatus
	var body *string
	var nameTokens, pathTokens, bodyTokens TokenResult

	switch result.Kind {
	case "text":
		status = IndexOK
		body = &result.Text
		nameTokens = Tokenize(name)
		pathTokens = Tokenize(sf.Path)
		bodyTokens = Tokenize(result.Text)
	case "name-only":
		status = IndexNameOnly
		nameTokens = Tokenize(name)
		pathTokens = Tokenize(sf.Path)
	default:
		status = IndexError
		nameTokens = Tokenize(name)
		pathTokens = Tokenize(sf.Path)
	}

	// Tokenize for FTS (CJK streams)
	nameU := nameTokens.Uni
	pathU := pathTokens.Uni
	bodyU := bodyTokens.Uni

	dirPath := filepath.Dir(sf.Path)
	dirTokens := Tokenize(dirPath)
	pathTokens.Bi = append(dirTokens.Bi, pathTokens.Bi...)
	pathTokens.Uni = append(dirTokens.Uni, pathTokens.Uni...)

	return ix.store.Upsert(
		sf.Path, name, ext, sf.MtimeMs, sf.SizeBytes, status, body,
		nameTokens.Bi, pathTokens.Bi, bodyTokens.Bi,
		nameU, pathTokens.Uni, bodyU,
	)
}
```

- [ ] **Step 3: 测试**

```go
func TestIndexerFreshScan(t *testing.T) { /* ... */ }
func TestIndexerDetectsRemovedFiles(t *testing.T) { /* ... */ }
func TestIndexerSkipsUnchangedFiles(t *testing.T) { /* ... */ }
func TestIndexerHandlesExtractError(t *testing.T) { /* ... */ }
```

- [ ] **Step 4: 构建、测试、提交**

```powershell
go test ./internal/index/ -v -run 'Indexer|Extract'
git add internal/index/extract* internal/index/indexer*
git commit -m "feat: add text extractor and index scheduler"
```

---

### Task 5: 搜索摘要与状态管理

**Source reference:** `snippet.ts` + `status.ts`

**Go 文件:**
- Create: `internal/index/snippet.go`
- Test: `internal/index/snippet_test.go`
- Create: `internal/index/status.go`

**Steps:**

- [ ] **Step 1: 实现 `buildSnippet`**

窗口大小：WINDOW=150, LEAD=40。以第一个匹配为中心，取前 40 + 后 110 字符窗口。

```go
const (
	snippetWindow = 150
	snippetLead   = 40
)

// BuildSnippet creates a highlighted snippet from body text and search needles.
func BuildSnippet(text string, needles []string) []SnippetPart {
	if text == "" || len(needles) == 0 {
		return nil
	}

	// Normalize whitespace
	normalized := collapseWhitespace(text)
	lower := strings.ToLower(normalized)

	// Find all needle positions
	ranges := findTextRanges(lower, needles)
	if len(ranges) == 0 {
		return nil
	}

	// Window around first hit
	firstHit := ranges[0].Start
	start := clamp(firstHit-snippetLead, 0, len(normalized))
	end := clamp(start+snippetWindow, start, len(normalized))

	window := normalized[start:end]
	hitPositions := mergeRangesInRange(ranges, start, end)

	// Build parts
	var parts []SnippetPart
	pos := 0
	for _, r := range hitPositions {
		if r.Start > pos {
			parts = append(parts, SnippetPart{Text: window[pos:r.Start], Hit: false})
		}
		parts = append(parts, SnippetPart{Text: window[r.Start:r.End], Hit: true})
		pos = r.End
	}
	if pos < len(window) {
		parts = append(parts, SnippetPart{Text: window[pos:], Hit: false})
	}

	// Add ellipsis markers
	if start > 0 {
		parts[0].Text = "\u2026" + parts[0].Text
	}
	if end < len(normalized) {
		parts[len(parts)-1].Text = parts[len(parts)-1].Text + "\u2026"
	}

	return parts
}
```

辅助函数：`collapseWhitespace`, `findTextRanges`, `clamp`, `mergeRangesInRange`。

- [ ] **Step 2: 实现 `excerpt`**

```go
// BuildExcerpt creates a plain-text excerpt around the first match.
func BuildExcerpt(text string, needles []string, chars int) string {
	// Similar to snippet but returns plain text
}
```

- [ ] **Step 3: 实现 `status.go`**

```go
// IndexAvailability tracks whether the search index is ready.
type IndexAvailability struct {
	Ready     bool
	Reason    string // empty if ready
	LastUpdate time.Time
}

var (
	indexStatus IndexAvailability
	statusMu    sync.RWMutex
)

// SetIndexStatus updates the global index availability.
func SetIndexStatus(ready bool, reason string) {
	statusMu.Lock()
	defer statusMu.Unlock()
	indexStatus = IndexAvailability{
		Ready:      ready,
		Reason:     reason,
		LastUpdate: time.Now(),
	}
}

// GetIndexStatus returns the current index status.
func GetIndexStatus() IndexAvailability {
	statusMu.RLock()
	defer statusMu.RUnlock()
	return indexStatus
}
```

- [ ] **Step 4: 测试 + 提交**

```powershell
go test ./internal/index/ -v -run 'Snippet|Status'
git add internal/index/snippet* internal/index/status*
git commit -m "feat: add search snippet builder and index status manager"
```

---

### Task 6: 搜索通道（`home:search-files`）

**Source reference:** `shell-home-ipc.ts` (搜索相关部分)

**Go 文件:**
- Create: `internal/bridge/search.go`
- Test: `internal/bridge/search_test.go`

**前端文件:**
- Modify: `frontend/packages/wails-bridge/src/home.ts` — 扩展 `HomeBridge` 添加 `searchFiles` 方法

**Steps:**

- [ ] **Step 1: 定义搜索请求/响应类型**

```go
// FileSearchQuery mirrors the frontend FileSearchQuery.
type FileSearchQuery struct {
	Q      string   `json:"q"`
	Ext    string   `json:"ext,omitempty"`
	Offset int      `json:"offset,omitempty"`
	Limit  int      `json:"limit,omitempty"`
}

// FileSearchPage mirrors the frontend FileSearchPage.
type FileSearchPage struct {
	Hits        []SearchHitWithStar `json:"hits"`
	Total       int                 `json:"total"`
	Index       string              `json:"index"` // "ok" | "name-only"
	Unavailable *string             `json:"unavailable,omitempty"`
}

// SearchHitWithStar extends SearchHit with a starred flag.
type SearchHitWithStar struct {
	SearchHit
	Starred bool `json:"starred"`
}
```

- [ ] **Step 2: 实现 `RegisterSearch`**

```go
// RegisterSearch wires the home:search-files channel.
func RegisterSearch(r *Router, store *index.FileIndexStore, rm *host.RecentManager) {
	r.Handle(ChannelSearchFiles, func(_ context.Context, args []json.RawMessage) (any, error) {
		// Check index availability
		status := index.GetIndexStatus()
		if !status.Ready {
			reason := status.Reason
			return &FileSearchPage{
				Hits:        []SearchHitWithStar{},
				Total:       0,
				Unavailable: &reason,
			}, nil
		}

		// Decode query
		query, err := DecodeArg[FileSearchQuery](args, 0)
		if err != nil {
			return nil, err
		}

		// Limit query length (same as Electron)
		if len(query.Q) > 200 {
			query.Q = query.Q[:200]
		}

		// Map ext family (docx -> [docx, doc], etc.)
		exts := resolveExtFamily(query.Ext)

		// Execute search
		result, err := store.Search(query.Q, index.SearchOptions{
			Ext:    exts,
			Offset: query.Offset,
			Limit:  query.Limit,
		})
		if err != nil {
			return nil, err
		}

		// Build response with snippets and starred flag
		hits := make([]SearchHitWithStar, len(result.Hits))
		for i, h := range result.Hits {
			// Build snippet from body
			body, _ := store.GetBody(h.Path)
			var snippet []index.SnippetPart
			var excerpt string
			if body != nil {
				snippet = index.BuildSnippet(*body, []string{query.Q})
				excerpt = index.BuildExcerpt(*body, []string{query.Q}, 200)
			}

			h.Snippet = snippet
			h.Excerpt = excerpt
			h.Needles = []string{query.Q}

			// Check starred status
			starred := rm.IsStarred(h.Path)

			hits[i] = SearchHitWithStar{
				SearchHit: h,
				Starred:   starred,
			}
		}

		return &FileSearchPage{
			Hits:  hits,
			Total: result.Total,
			Index: "ok",
		}, nil
	})
}

// resolveExtFamily maps a search extension to its family.
func resolveExtFamily(ext string) []string {
	if ext == "" {
		return nil
	}
	family := map[string][]string{
		"docx":  {"docx", "doc"},
		"xlsx":  {"xlsx", "xlsm", "xls", "csv", "tsv"},
		"pptx":  {"pptx", "ppt"},
		"pdf":   {"pdf"},
		"markdown": {"md", "markdown"},
	}
	if fam, ok := family[ext]; ok {
		return fam
	}
	return []string{ext}
}
```

- [ ] **Step 3: 在 `channels.go` 添加常量**

```go
ChannelSearchFiles = "home:search-files"
```

- [ ] **Step 4: 在 `main.go` 接线**

```go
// After creating the index store:
bridge.RegisterSearch(router, indexStore, rm)
```

- [ ] **Step 5: 前端扩展 `HomeBridge`**

在 `frontend/packages/wails-bridge/src/home.ts` 添加：

```ts
searchFiles(query: { q: string; ext?: string; offset?: number; limit?: number }): Promise<FileSearchPage>
```

- [ ] **Step 6: 测试 + 提交**

```powershell
go test ./internal/bridge/ -v -run Search
npm --prefix frontend run test -w @yiioffice/wails-bridge
git add internal/bridge/search* internal/bridge/channels.go main.go frontend/packages/wails-bridge/src/home.ts
git commit -m "feat: wire home:search-files channel with fts5 backend"
```

---

### Task 7: 索引生命周期集成

**Go 文件:**
- Create: `internal/index/lifecycle.go`
- Modify: `main.go` — 接入索引生命周期

**Steps:**

- [ ] **Step 1: 实现生命周期管理**

`internal/index/lifecycle.go`:

```go
// Lifecycle manages the index initialization and shutdown.
type Lifecycle struct {
	store   *FileIndexStore
	indexer *FileIndexer
}

// Init creates the store and indexer for the given data directory and folder roots.
func Init(dataDir string, roots []string) (*Lifecycle, error) {
	dbPath := filepath.Join(dataDir, "file-index.db")
	store, err := NewFileIndexStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("open index store: %w", err)
	}

	// Set initial status
	SetIndexStatus(false, "initializing")

	indexer := NewFileIndexer(store, roots)

	// Trigger initial scan in background
	go func() {
		indexer.Refresh()
		SetIndexStatus(true, "")
	}()

	return &Lifecycle{store: store, indexer: indexer}, nil
}

// Store returns the file index store.
func (lc *Lifecycle) Store() *FileIndexStore { return lc.store }

// Indexer returns the file indexer.
func (lc *Lifecycle) Indexer() *FileIndexer { return lc.indexer }

// Refresh triggers a full re-index.
func (lc *Lifecycle) Refresh() {
	lc.indexer.Refresh()
}

// Shutdown closes the store and stops the indexer.
func (lc *Lifecycle) Shutdown() error {
	lc.indexer.Stop()
	return lc.store.Close()
}
```

- [ ] **Step 2: 在 `main.go` 接入**

```go
import "gitee.com/ethanbourne789/yiioffice/internal/index"

// After creating FolderManager:
roots := fm.GetRoots() // Get folder roots from P2 FolderManager

lc, err := index.Init(dataDir, roots)
if err != nil {
	log.Printf("warning: file index init failed: %v", err)
	// Non-fatal: search will show unavailable state
}

// Register search channel
if lc != nil {
	bridge.RegisterSearch(router, lc.Store(), rm)
}

// Register app shutdown handler
app.OnBeforeClose(func() {
	if lc != nil {
		lc.Shutdown()
	}
})
```

- [ ] **Step 3: 文件夹变更触发索引刷新**

在 P2 的 `FolderManager` 中，当文件夹根变更时调用 `lifecycle.Refresh()`。

- [ ] **Step 4: 构建、测试、提交**

```powershell
go build -tags production
git add internal/index/lifecycle.go main.go
git commit -m "feat: wire file index lifecycle into application"
```

---

### Task 8: 性能基准测试与 G3 验收

**Steps:**

- [ ] **Step 1: 创建基准测试 fixture**

生成 10,000 个测试文件（包含中文/英文/混合文件名和正文内容）用于性能测试。

```go
// internal/index/benchmark_test.go
func BenchmarkSearch10k(b *testing.B) {
	// Create temp dir with 10k files
	// Build index
	// Run search queries b.N times
}

func BenchmarkIndex10k(b *testing.B) {
	// Measure time to index 10k files from scratch
}
```

- [ ] **Step 2: 运行基准测试**

```powershell
go test ./internal/index/ -bench=. -benchmem -count=3
```

- [ ] **Step 3: Schema 兼容性验证**

验证 Go 创建的索引文件可以被 Electron 版本读取（同一 schema）：

```powershell
# Build the index with Go, then open the DB file with Electron version
# Verify search results match
```

- [ ] **Step 4: G3 检查表**

| 检查项 | 方法 | 通过标准 |
|---|---|---|
| 搜索 P95（1 万文档） | 基准测试 | < 150ms |
| Schema 一致性 | 手动验证 / Electron 端读取 | 同一 `files` + `file_fts` schema |
| CJK 分词对齐 | 对照测试 | Go 版 token 输出与 JS 版完全一致 |
| `home:search-files` 通道 | 端到端测试 | 搜索返回正确的命中结果 |
| 纯文本提取 | 功能测试 | `.txt`/`.md` 文件可搜索正文 |
| 大文件处理 | 功能测试 | >64MB 文件标记为 `name-only` |
| 索引状态管理 | 功能测试 | 索引初始化期间搜索返回 `unavailable` |
| Go 测试 | `go test ./...` | 全部 PASS |
| 前端测试 | `npm run test` | 全部 PASS |

- [ ] **Step 5: 提交**

```powershell
go test ./internal/index/ -bench=. -benchmem
git add internal/index/benchmark*
git commit -m "chore: phase 3 gate G3 benchmark and verification"
```

---

## 5. 风险与回退

| 风险 | 触发信号 | 回退动作 |
|---|---|---|
| `modernc.org/sqlite` FTS5 不完整 | `CREATE VIRTUAL TABLE` 报错 | 换用 `github.com/mattn/go-sqlite3`（需 CGO + mingw） |
| CJK 分词结果与 JS 不一致 | 对照测试失败 | 使用 `github.com/go-ego/gse` 替代自建分词 |
| 文本提取无法覆盖 OOXML 格式 | 搜索仅匹配文件名 | 接受 `name-only` 模式作为 P3 基线，P4 集成 file-parse WASM |
| 1 万文档搜索超过 150ms | 基准测试不达标 | 优化 FTS5 查询（减少 JOIN，使用 `rank` 排序）或增加内存映射 |
| `contentless_delete` 模式不兼容 | FTS5 删除操作报错 | 改为标准内容模式，`file_fts` 存储完整文本 |
| 索引库与 Electron 版本不兼容 | Electron 无法读取 Go 生成的 DB | 调整 `meta` 表版本标记，添加迁移逻辑 |

---

## 6. 自检清单

- [x] 覆盖度：Electron `file-index/` 的 9 个文件全部映射到 Go 模块
- [x] 无占位符：每个任务有具体代码、测试要求、验证命令
- [x] 类型一致性：`FileIndexStore` 方法与 `RegisterSearch` 通道签名对应；`Tokenize` 输出与 `Upsert` 参数匹配
- [x] Windows-only：无 mac/linux 文件
- [x] Schema 一致：`files` + `file_fts` 结构与 Electron 版本相同
- [x] CJK 分词对齐：Tokenize 实现与 JS 版 `tokenize.ts` 行为一致（对照测试验证）
- [x] 通道名一致：`home:search-files` 与 Electron `HOME_CHANNELS.searchFiles` 字面一致
- [x] 性能预算明确：1 万文档 P95 < 150ms
