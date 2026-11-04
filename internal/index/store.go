// Package index implements the full-text file index engine.
package index

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
	_ "modernc.org/sqlite/lib"
)

// IndexStatus mirrors the TS enum.
type IndexStatus string

const (
	IndexOK       IndexStatus = "ok"
	IndexNameOnly IndexStatus = "name-only"
	IndexError    IndexStatus = "error"
)

// IndexedFile is a file entry in the index.
type IndexedFile struct {
	Path      string
	MtimeMs   int64
	SizeBytes int64
	Status    IndexStatus
}

// SearchHit is a search result hit.
type SearchHit struct {
	Path      string        `json:"path"`
	Name      string        `json:"name"`
	Ext       string        `json:"ext"`
	MtimeMs   int64         `json:"mtimeMs"`
	SizeBytes int64         `json:"sizeBytes"`
	Snippet   []SnippetPart `json:"snippet"`
	Needles   []string      `json:"needles"`
	Excerpt   string        `json:"excerpt"`
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

// SearchOptions for file search.
type SearchOptions struct {
	Ext    []string
	Offset int
	Limit  int
}

const DefaultSearchLimit = 50

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

	// Serialize all database access through a single connection. The index
	// workload is short write transactions (Upsert/Remove) interleaved with
	// scans from the indexer loop, the watcher flush loop, and search
	// bindings; multiple pooled connections would let those collide and fail
	// with SQLITE_BUSY. No code path holds one connection while requesting
	// another, so a limit of 1 cannot deadlock. busy_timeout additionally
	// covers a second process (e.g. a stray CLI) touching the same file.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma wal: %w", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		db.Close()
		return nil, fmt.Errorf("pragma busy_timeout: %w", err)
	}

	s := &FileIndexStore{db: db}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

const filesDDL = `
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
`

const ftsDDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
  name, path, body, file_path,
  tokenize='unicode61 remove_diacritics 2'
);
`

func (s *FileIndexStore) initSchema() error {
	if _, err := s.db.Exec(filesDDL); err != nil {
		return err
	}
	if _, err := s.db.Exec(ftsDDL); err != nil {
		return err
	}
	return s.rebuildFTSIfStale()
}

// rebuildFTSIfStale recreates the full-text table when an existing database
// carries an older column set. CREATE ... IF NOT EXISTS leaves such tables
// untouched, which would later fail every DELETE/INSERT that names file_path.
func (s *FileIndexStore) rebuildFTSIfStale() error {
	rows, err := s.db.Query("PRAGMA table_info(file_fts)")
	if err != nil {
		return fmt.Errorf("pragma file_fts: %w", err)
	}
	hasPath := false
	for rows.Next() {
		var (
			cid, notNull, pk int
			name, typ        string
			dflt             any
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scan file_fts columns: %w", err)
		}
		if name == "file_path" {
			hasPath = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read file_fts columns: %w", err)
	}
	if hasPath {
		return nil
	}

	if _, err := s.db.Exec("DROP TABLE file_fts"); err != nil {
		return fmt.Errorf("drop stale file_fts: %w", err)
	}
	if _, err := s.db.Exec(ftsDDL); err != nil {
		return fmt.Errorf("recreate file_fts: %w", err)
	}
	if _, err := s.db.Exec(`
		INSERT INTO file_fts (name, path, body, file_path)
		SELECT name, path, COALESCE(body, ''), path FROM files
	`); err != nil {
		return fmt.Errorf("rebuild file_fts: %w", err)
	}
	return nil
}

// Close closes the database connection.
func (s *FileIndexStore) Close() error {
	return s.db.Close()
}

// Upsert inserts or replaces a file entry and its FTS rows.
func (s *FileIndexStore) Upsert(path, name, ext string, mtimeMs int64, sizeBytes int64, status IndexStatus, body *string, nameTokens, pathTokens, bodyTokens []string, nameUTokens, pathUTokens, bodyUTokens []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Upsert the metadata row.
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

	// Delete any existing FTS row for this path, then insert fresh.
	if _, err := tx.Exec("DELETE FROM file_fts WHERE file_path = ?", path); err != nil {
		return fmt.Errorf("delete fts: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO file_fts (name, path, body, file_path)
		VALUES (?, ?, ?, ?)
	`, strings.Join(nameTokens, " "),
		strings.Join(pathTokens, " "),
		joinOrEmpty(bodyTokens),
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

// Search executes a full-text search and returns ranked results.
func (s *FileIndexStore) Search(query string, opts SearchOptions) (*SearchResult, error) {
	if opts.Limit <= 0 {
		opts.Limit = DefaultSearchLimit
	}

	// Empty query returns no results.
	if strings.TrimSpace(query) == "" {
		return &SearchResult{}, nil
	}

	matchExpr := escapeFTS(query)

	var extFilter string
	var extArgs []any
	if len(opts.Ext) > 0 {
		placeholders := make([]string, len(opts.Ext))
		for i, ext := range opts.Ext {
			placeholders[i] = "?"
			extArgs = append(extArgs, ext)
		}
		extFilter = fmt.Sprintf(" AND f.ext IN (%s)", strings.Join(placeholders, ","))
	}

	// Count query.
	countSQL := fmt.Sprintf(
		"SELECT COUNT(*) FROM file_fts t JOIN files f ON f.path = t.file_path WHERE file_fts MATCH %s%s",
		matchExpr, extFilter,
	)
	var total int
	if err := s.db.QueryRow(countSQL, extArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}

	// Search query with BM25 ranking.
	searchSQL := fmt.Sprintf(`
		SELECT f.path, f.name, f.ext, f.mtime_ms, f.size_bytes, f.body
		FROM file_fts t
		JOIN files f ON f.path = t.file_path
		WHERE file_fts MATCH %s%s
		ORDER BY rank, f.mtime_ms DESC
		LIMIT ? OFFSET ?
	`, matchExpr, extFilter)

	searchArgs := append(append(extArgs, int64(opts.Limit)), int64(opts.Offset))

	rows, err := s.db.Query(searchSQL, searchArgs...)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	defer rows.Close()

	var hits []SearchHit
	for rows.Next() {
		var h SearchHit
		var body sql.NullString
		// mtime/size may be stored as REAL by older index versions, so scan
		// them as float64 and truncate to int64 here.
		var mtime, size float64
		if err := rows.Scan(&h.Path, &h.Name, &h.Ext, &mtime, &size, &body); err != nil {
			return nil, err
		}
		h.MtimeMs = int64(mtime)
		h.SizeBytes = int64(size)
		hits = append(hits, h)
	}

	return &SearchResult{Hits: hits, Total: total}, nil
}

// escapeFTS wraps a query in FTS5-safe quotes.
func escapeFTS(s string) string {
	return "'" + strings.NewReplacer("\\", "\\\\", "'", "\\'").Replace(s) + "'"
}

// Remove deletes file entries by path.
func (s *FileIndexStore) Remove(paths []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, p := range paths {
		if _, err := tx.Exec("DELETE FROM file_fts WHERE file_path = ?", p); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM files WHERE path = ?", p); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetBody returns the body text for a file path.
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
	v := body.String
	return &v, nil
}

// CountFiles returns how many files the index currently holds.
func (s *FileIndexStore) CountFiles() (int, error) {
	var n int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM files").Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
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
		var mtime, size float64
		if err := rows.Scan(&f.Path, &mtime, &size, &f.Status); err != nil {
			return nil, err
		}
		f.MtimeMs = int64(mtime)
		f.SizeBytes = int64(size)
		files = append(files, f)
	}
	return files, nil
}
