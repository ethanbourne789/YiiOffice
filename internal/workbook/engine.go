package workbook

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xuri/excelize/v2"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// Open failures carry stable codes in the message so the renderer can tell an
// encrypted workbook from a damaged one. ErrPasswordRequired appends the path
// after a '|' so the retry can reopen the same file without a second picker.
var (
	ErrPasswordRequired      = errors.New("workbook_password_required")
	ErrPasswordIncorrect     = errors.New("workbook_password_incorrect")
	ErrEncryptionUnsupported = errors.New("workbook_encryption_unsupported")
	ErrWorkbookCorrupt       = errors.New("workbook_corrupt")
	// ErrOpenTimeout is reported when the caller's deadline passed before the
	// open finished. Callers get a stable code instead of a spinner that never
	// resolves; the underlying parse may still be running to completion.
	ErrOpenTimeout = errors.New("workbook_open_timeout")
)

// oleIdentifier is the CFB/OLE signature every encrypted OOXML package starts
// with (EncryptionInfo + EncryptedPackage streams).
var oleIdentifier = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// defaultMaxSessions bounds how many workbooks stay open at once.
//
// There is no wall-clock TTL on purpose: a tab can legitimately sit untouched
// for hours, and evicting its session would turn the next edit into a failed
// save. Instead the oldest-idle session is dropped only when a new open would
// exceed the cap, which bounds memory without ever racing an active document
// out from under the user in the common case.
const defaultMaxSessions = 32

// Engine owns open workbook sessions. It is safe for concurrent use.
type Engine struct {
	mu          sync.Mutex
	sessions    map[string]*session
	maxSessions int
}

type session struct {
	// mu serialises every access to file and info. excelize.File is not
	// safe for concurrent use even for reads: GetCellValue and friends
	// lazily parse sheets into shared caches, so an RWMutex would still
	// race inside excelize itself. A plain Mutex keeps the writers (Save,
	// reload, Close) and every reader mutually exclusive.
	//
	// Engine.mu is never held while a session lock is taken, and no
	// session method calls another, so the two locks cannot deadlock.
	mu   sync.Mutex
	info FileInfo
	file *excelize.File
	// encrypted marks a session whose file is an OOXML encrypted container.
	encrypted bool
	// password holds the plaintext key supplied at open as bytes so it can be
	// wiped on close (a string cannot be zeroed once created). excelize keeps
	// the key in f.options and re-encrypts every write (file.go:151-158), so a
	// save of this session stays password-protected instead of silently
	// writing a decrypted workbook.
	password []byte
	// lastUsed is a unix-nano stamp updated on every acquire, used to pick the
	// eviction victim when the session cap is reached.
	lastUsed atomic.Int64
	// closed marks a session whose file has been (or is being) released.
	// It is only ever set with mu held, so acquire can reject a session
	// that was closed between the map lookup and the lock acquisition.
	closed bool
}

// NewEngine returns an empty engine.
func NewEngine() *Engine {
	return &Engine{sessions: map[string]*session{}, maxSessions: defaultMaxSessions}
}

// SessionCount reports how many sessions are open (used by tests and diagnostics).
func (e *Engine) SessionCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.sessions)
}

// CloseAll drops every open session and releases its workbook.
func (e *Engine) CloseAll() {
	e.mu.Lock()
	sessions := e.sessions
	e.sessions = map[string]*session{}
	e.mu.Unlock()
	for _, s := range sessions {
		if err := s.release(); err != nil {
			platform.Logger().Warn("workbook: close session failed", "error", err)
		}
	}
}

// newUUID mints a random v4 UUID. It returns an error rather than a fixed
// placeholder: a constant id would make two sessions overwrite each other in
// the engine map, which surfaces as one workbook silently reading another
// workbook's data.
func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate session id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]), hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]), hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16])), nil
}

// Open loads the workbook at path and registers a session.
//
// Memory note: the SHA-256 is computed by streaming the file, so peak
// residency is excelize's single in-memory copy. The previous os.ReadFile
// of the whole workbook added a second full copy on top. excelize.OpenFile
// is used instead of OpenReader(bytes) because OpenReader io.ReadAll-copies
// its input, reintroducing the extra buffer; countZipEntries only reads the
// zip central directory.
func (e *Engine) Open(path string) (*FileInfo, error) {
	return e.OpenWithPassword(path, "")
}

// OpenWithPassword opens path, decrypting an OOXML encrypted container when
// password is non-empty. Failure classification leans on excelize's own
// signals: a password-supplied decrypt that still fails to parse is reported
// as ErrWorkbookPassword (excelize.go:217), while a CFB it cannot decrypt at
// all collapses to ErrWorkbookFileFormat (excelize.go:212).
func (e *Engine) OpenWithPassword(path, password string) (*FileInfo, error) {
	return e.OpenContext(context.Background(), path, password)
}

// openAborted turns a spent deadline into the stable timeout code. It is
// checked between stages, and right after a stage that cannot be interrupted:
// excelize parses the package in one call with no cancellation hook, so the
// honest contract is "you stop waiting at the deadline", not "the parse stops".
func openAborted(ctx context.Context) error {
	if ctx.Err() == nil {
		return nil
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return ErrOpenTimeout
	}
	return fmt.Errorf("%w: %w", ErrOpenTimeout, ctx.Err())
}

// OpenContext is OpenWithPassword with a deadline. The hashing stage reads the
// file in bounded chunks and honours cancellation; every other stage is
// checked on the boundary.
func (e *Engine) OpenContext(ctx context.Context, path, password string) (*FileInfo, error) {
	encrypted, err := isEncryptedWorkbook(path)
	if err != nil {
		return nil, fmt.Errorf("open workbook: %w", err)
	}
	// Without a password there is nothing to try: report the requirement
	// instead of the generic zip error excelize would raise.
	if encrypted && password == "" {
		return nil, fmt.Errorf("%w|%s", ErrPasswordRequired, path)
	}
	sum, size, entryCount, err := hashAndCount(ctx, path)
	if err != nil {
		return nil, err
	}
	if err := openAborted(ctx); err != nil {
		return nil, err
	}
	var f *excelize.File
	if encrypted {
		f, err = excelize.OpenFile(path, excelize.Options{Password: password})
		if err != nil {
			switch {
			case errors.Is(err, excelize.ErrWorkbookPassword):
				return nil, ErrPasswordIncorrect
			case errors.Is(err, excelize.ErrUnknownEncryptMechanism),
				errors.Is(err, excelize.ErrUnsupportedEncryptMechanism),
				errors.Is(err, excelize.ErrWorkbookFileFormat):
				return nil, fmt.Errorf("%w: %v", ErrEncryptionUnsupported, err)
			default:
				return nil, fmt.Errorf("%w: %v", ErrWorkbookCorrupt, err)
			}
		}
	} else {
		f, err = excelize.OpenFile(path)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrWorkbookCorrupt, err)
		}
	}
	// The parse above cannot be cancelled; check here so a workbook that
	// finished parsing after the deadline does not also pay the metadata pass.
	if err := openAborted(ctx); err != nil {
		f.Close() //nolint:errcheck // discarding the handle we are abandoning
		return nil, err
	}
	sessionID, err := newUUID()
	if err != nil {
		f.Close()
		return nil, err
	}
	info := FileInfo{
		SessionID:    sessionID,
		Name:         filepath.Base(path),
		Path:         path,
		SHA256:       hex.EncodeToString(sum[:]),
		FileBytes:    size,
		EntryCount:   entryCount,
		ReadOnly:     isReadOnly(path),
		Sheets:       sheetMetadata(f, path),
		ActiveTab:    clampActiveTab(f.GetActiveSheetIndex(), len(f.GetSheetList())),
		Styles:       styleTable(f),
		DxfStyles:    []CellStyle{},
		Visuals:      []any{},
		DefinedNames: definedNames(f),
	}
	sess := &session{info: info, file: f, encrypted: encrypted, password: []byte(password)}
	sess.lastUsed.Store(time.Now().UnixNano())
	e.mu.Lock()
	// Collect the eviction set under e.mu, then release every victim outside it:
	// the lock order is Engine.mu -> session.mu, never the reverse.
	var evicted []*session
	if e.maxSessions > 0 {
		for len(e.sessions) >= e.maxSessions {
			victimID, victim := "", (*session)(nil)
			oldest := int64(^uint64(0) >> 1)
			for id, s := range e.sessions {
				if used := s.lastUsed.Load(); used < oldest {
					oldest, victimID, victim = used, id, s
				}
			}
			if victim == nil {
				break
			}
			delete(e.sessions, victimID)
			evicted = append(evicted, victim)
			platform.Logger().Warn("workbook: session cap reached, evicted least-recently-used session",
				"cap", e.maxSessions, "evicted", victimID)
		}
	}
	e.sessions[info.SessionID] = sess
	e.mu.Unlock()
	for _, s := range evicted {
		if err := s.release(); err != nil {
			platform.Logger().Warn("workbook: evicted session close failed", "error", err)
		}
	}
	return &info, nil
}

// release closes the underlying workbook exactly once and wipes the stored
// password. Safe to call on an already-closed session.
func (s *session) release() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	clear(s.password)
	return s.file.Close()
}

// isEncryptedWorkbook sniffs the CFB signature. A password-protected OOXML
// workbook is a compound file, so a plain .xlsx never matches. A legacy .xls
// would, but the picker only offers OOXML formats, so that ambiguity cannot
// reach this path from the UI.
func isEncryptedWorkbook(path string) (bool, error) {
	fh, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer fh.Close()
	var head [8]byte
	n, err := fh.Read(head[:])
	if err != nil && !errors.Is(err, io.EOF) {
		return false, err
	}
	return n == len(oleIdentifier) && bytes.Equal(head[:], oleIdentifier), nil
}

// Close drops the session and releases the underlying workbook.
func (e *Engine) Close(sessionID string) error {
	e.mu.Lock()
	s, ok := e.sessions[sessionID]
	delete(e.sessions, sessionID)
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("unknown session %q", sessionID)
	}
	// Wait out any in-flight read/write before releasing the file. The
	// closed flag is set under s.mu, so an operation that already holds
	// the lock finishes against a live file, and any later acquire sees
	// closed and reports the session as unknown.
	return s.release()
}

// acquire returns a session with s.mu held, or an error. The caller must
// unlock s.mu when done. Re-checking closed under s.mu closes the TOCTOU
// window where Close deletes the session between a map lookup and the
// caller taking the lock, which would otherwise use a closed excelize
// file. Engine.mu is released before s.mu is taken, preserving the rule
// that Engine.mu is never held while a session lock is acquired.
func (e *Engine) acquire(sessionID string) (*session, error) {
	e.mu.Lock()
	s, ok := e.sessions[sessionID]
	e.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	// Recency is recorded only for sessions that are actually used, so the
	// eviction picker never drops a document the user is looking at while an
	// untouched one sits idle.
	s.lastUsed.Store(time.Now().UnixNano())
	return s, nil
}

// SheetName resolves a renderer sheet id (which equals the sheet name) to a
// worksheet the excelize file accepts.
func (e *Engine) SheetName(sessionID, sheetID string) (string, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return "", err
	}
	defer s.mu.Unlock()
	if _, err := s.file.GetSheetIndex(sheetID); err != nil {
		return "", fmt.Errorf("unknown sheet %q", sheetID)
	}
	return sheetID, nil
}

// Info returns the metadata snapshot of an open session.
func (e *Engine) Info(sessionID string) (*FileInfo, error) {
	s, err := e.acquire(sessionID)
	if err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	info := s.info
	return &info, nil
}

// ── metadata helpers ──

// hashAndCount hashes path and counts its zip entries from a single open
// handle. The digest needs a full sequential read while the zip directory
// needs random access to the tail, and *os.File serves both (io.ReaderAt), so
// one open replaces the previous two. That matters on Windows in particular,
// where every open is a chance for a filter driver to scan the file first.
//
// A package that is not a zip (CSV, legacy .xls, an OLE container) still gets
// its digest: entry counting degrades to 0, which is what countZipEntries
// returned for the same input.
// ctxReader aborts a copy once ctx is done. Wrapping the file rather than
// hand-rolling the read loop keeps io.Copy's tuned buffer and avoids the 1 MiB
// allocation a manual buffer costs on every open.
type ctxReader struct {
	ctx context.Context
	r   io.Reader
	err error
}

func (c *ctxReader) Read(p []byte) (int, error) {
	if c.err != nil {
		return 0, c.err
	}
	if err := c.ctx.Err(); err != nil {
		c.err = err
		return 0, err
	}
	return c.r.Read(p)
}

func hashAndCount(ctx context.Context, path string) (sum [sha256.Size]byte, size int64, entries int, err error) {
	fh, err := os.Open(path)
	if err != nil {
		return sum, 0, 0, fmt.Errorf("read workbook: %w", err)
	}
	defer fh.Close()

	h := sha256.New()
	size, err = io.Copy(h, &ctxReader{ctx: ctx, r: fh})
	if err != nil {
		if ctx.Err() != nil {
			return sum, size, 0, openAborted(ctx)
		}
		return sum, size, 0, fmt.Errorf("hash workbook: %w", err)
	}
	copy(sum[:], h.Sum(nil))

	zr, err := zip.NewReader(fh, size)
	if err != nil {
		return sum, size, 0, nil
	}
	return sum, size, len(zr.File), nil
}

func isReadOnly(path string) bool {
	fh, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return true
	}
	fh.Close()
	return false
}

func clampActiveTab(index, total int) int {
	if total == 0 || index < 0 || index >= total {
		return 0
	}
	return index
}

// sheetMetadata builds the per-sheet metadata snapshot. Geometry (row and
// column extent plus the <col> definitions) comes from one streaming pass over
// the OOXML parts: the excelize getters it replaces parsed every worksheet
// twice, once for Rows() and again for the first GetCol* call, which was the
// dominant cost of both open and the post-save reload. Anything the scan cannot
// handle (encrypted OLE container, CSV, legacy .xls, unexpected package layout)
// falls back to the library path unchanged.
func sheetMetadata(f *excelize.File, path string) []SheetMeta {
	names := f.GetSheetList()
	geometry, scanned := readSheetGeometry(path)
	out := make([]SheetMeta, 0, len(names))
	for _, name := range names {
		meta := SheetMeta{
			ID:            name,
			Name:          name,
			ShowGridLines: true,
			Comments:      []Comment{},
			PivotRanges:   []CellArea{},
			PivotTables:   []any{},
			Sparklines:    []any{},
			CellImages:    []any{},
		}
		if g, ok := geometry[name]; scanned && ok && applyScannedMeta(g, &meta) {
			// handled by the streaming scan
		} else {
			applyWorksheetMetaFromExcelize(f, name, &meta)
		}
		out = append(out, meta)
	}
	return out
}

// applyScannedMeta applies a streamed sheet and reports whether it did so
// cleanly. The scan is a hand-written parser over files this project does not
// control, so a bug in it must never be able to stop a document from opening:
// a panic leaves meta untouched and sends that sheet down the library path.
// Writing to a scratch copy is what makes "untouched" true — a half-filled meta
// must not survive a recovery.
func applyScannedMeta(g *sheetGeometry, meta *SheetMeta) (ok bool) {
	scratch := *meta
	defer func() {
		if r := recover(); r != nil {
			ok = false
		}
	}()
	g.applyWorksheetMeta(&scratch)
	*meta = scratch
	return true
}

// applyWorksheetMetaFromExcelize is the pre-streaming path. It costs a full
// worksheet decode per sheet but keeps encrypted workbooks, CSVs, legacy .xls
// and any package the streaming scan declines working exactly as before.
func applyWorksheetMetaFromExcelize(f *excelize.File, name string, meta *SheetMeta) {
	rows, cols := sheetDimensions(f, name)
	meta.RowCount = rows
	meta.ColumnCount = cols
	meta.ColumnWidths = columnWidths(f, name, cols)
	meta.Tables = sheetTables(f, name)
	if visible, err := f.GetSheetVisible(name); err == nil && !visible {
		meta.Hidden = true
	}
	if props, err := f.GetSheetProps(name); err == nil {
		if props.TabColorRGB != nil && *props.TabColorRGB != "" {
			color := normalizeColor(*props.TabColorRGB)
			meta.TabColor = &color
		}
		// The renderer schema wants null rather than 0 for "default".
		if props.DefaultRowHeight != nil && *props.DefaultRowHeight > 0 {
			meta.DefaultRowHeight = props.DefaultRowHeight
		}
		if props.DefaultColWidth != nil && *props.DefaultColWidth > 0 {
			meta.DefaultColumnWidth = props.DefaultColWidth
		}
	}
	if view, err := f.GetSheetView(name, 0); err == nil {
		if view.ShowGridLines != nil {
			meta.ShowGridLines = *view.ShowGridLines
		}
		if view.ShowFormulas != nil && *view.ShowFormulas {
			show := true
			meta.ShowFormulas = &show
		}
		if view.ShowRowColHeaders != nil && !*view.ShowRowColHeaders {
			show := false
			meta.ShowRowColHeaders = &show
		}
		if view.RightToLeft != nil {
			meta.RightToLeft = *view.RightToLeft
		}
		if view.ZoomScale != nil {
			zoom := int(*view.ZoomScale)
			if zoom >= 10 && zoom <= 400 && zoom != 100 {
				meta.ZoomScale = zoom
			}
		}
	}
	if panes, err := f.GetPanes(name); err == nil && panes.Freeze {
		meta.Freeze = &Freeze{FrozenColumns: panes.XSplit, FrozenRows: panes.YSplit}
	}
}

// sheetDimensions derives the used range from the stored rows because the
// sheet-level <dimension> element is frequently stale in real workbooks.
func sheetDimensions(f *excelize.File, sheet string) (rows, cols int) {
	iter, err := f.Rows(sheet)
	if err != nil {
		return 1, 1
	}
	defer iter.Close()
	for iter.Next() {
		rows++
		cells, cerr := iter.Columns()
		if cerr == nil && len(cells) > cols {
			cols = len(cells)
		}
	}
	return maxInt(rows, 1), maxInt(cols, 1)
}

func columnWidths(f *excelize.File, sheet string, cols int) []ColumnWidth {
	out := make([]ColumnWidth, 0, cols)
	for col := 1; col <= cols; col++ {
		styleID, _ := f.GetColStyle(sheet, columnName(col))
		width, _ := f.GetColWidth(sheet, columnName(col))
		visible, _ := f.GetColVisible(sheet, columnName(col))
		level, _ := f.GetColOutlineLevel(sheet, columnName(col))
		cw := ColumnWidth{StartColumn: col - 1, EndColumn: col - 1, Hidden: !visible}
		if width > 0 {
			w := width
			cw.Width = &w
		}
		if level > 0 {
			cw.OutlineLevel = int(level)
		}
		if styleID > 0 {
			id := styleID
			cw.StyleIndex = &id
		}
		out = append(out, cw)
	}
	return out
}

func sheetTables(f *excelize.File, sheet string) []SheetTable {
	tables, err := f.GetTables(sheet)
	if err != nil {
		return []SheetTable{}
	}
	out := make([]SheetTable, 0, len(tables))
	for _, t := range tables {
		area, err := parseArea(t.Range)
		if err != nil {
			continue
		}
		st := SheetTable{
			Range:             area,
			HeaderRowCount:    1,
			ShowRowStripes:    t.ShowRowStripes != nil && *t.ShowRowStripes,
			ShowColumnStripes: t.ShowColumnStripes,
			Name:              t.Name,
			StyleName:         t.StyleName,
		}
		out = append(out, st)
	}
	return out
}

func styleTable(f *excelize.File) []CellStyle {
	out := make([]CellStyle, 0, 64)
	for i := 0; i < 4096; i++ {
		st, err := f.GetStyle(i)
		if err != nil || st == nil {
			break
		}
		out = append(out, convertStyle(st))
	}
	if len(out) == 0 {
		out = append(out, CellStyle{})
	}
	return out
}

func convertStyle(st *excelize.Style) CellStyle {
	cs := CellStyle{}
	if st.Font != nil {
		cs.FontFamily = st.Font.Family
		if st.Font.Size > 0 {
			size := st.Font.Size
			cs.FontSize = &size
		}
		cs.Bold = st.Font.Bold
		cs.Italic = st.Font.Italic
		cs.Underline = st.Font.Underline != ""
		cs.Strikethrough = st.Font.Strike
		cs.FontColor = normalizeColor(st.Font.Color)
	}
	if fill := firstFillColor(st.Fill); fill != "" {
		cs.FillColor = fill
	}
	if st.Alignment != nil {
		cs.HorizontalAlignment = st.Alignment.Horizontal
		cs.VerticalAlignment = st.Alignment.Vertical
		cs.WrapText = st.Alignment.WrapText
		cs.ShrinkToFit = st.Alignment.ShrinkToFit
		cs.Indent = st.Alignment.Indent
		cs.TextRotation = st.Alignment.TextRotation
	}
	if st.CustomNumFmt != nil && *st.CustomNumFmt != "" {
		cs.NumberFormat = *st.CustomNumFmt
	} else if code := builtinNumFmt(st.NumFmt); code != "" && code != "General" {
		cs.NumberFormat = code
	}
	for _, b := range st.Border {
		edge := &BorderEdge{Style: borderStyleName(b.Style), Color: normalizeColor(b.Color)}
		switch b.Type {
		case "left":
			cs.BorderLeft = edge
		case "right":
			cs.BorderRight = edge
		case "top":
			cs.BorderTop = edge
		case "bottom":
			cs.BorderBottom = edge
		}
	}
	return cs
}

func firstFillColor(fill excelize.Fill) string {
	for _, c := range fill.Color {
		if c != "" {
			return normalizeColor(c)
		}
	}
	return ""
}

func normalizeColor(c string) string {
	c = strings.TrimSpace(c)
	if c == "" {
		return ""
	}
	if strings.HasPrefix(c, "#") {
		return strings.ToUpper(c)
	}
	return "#" + strings.ToUpper(c)
}

func borderStyleName(style int) string {
	names := []string{"none", "thin", "medium", "dashed", "dotted", "thick", "double",
		"hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"}
	if style >= 0 && style < len(names) {
		return names[style]
	}
	return "thin"
}

func builtinNumFmt(id int) string {
	codes := map[int]string{
		0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
		9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
		14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
		18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
		22: "m/d/yy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)",
		39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
		45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
	}
	return codes[id]
}

func definedNames(f *excelize.File) []DefinedName {
	defs := f.GetDefinedName()
	out := make([]DefinedName, 0, len(defs))
	for _, d := range defs {
		dn := DefinedName{Name: d.Name, Formula: d.RefersTo}
		if strings.HasPrefix(d.RefersTo, "=") {
			dn.Formula = d.RefersTo
		}
		out = append(out, dn)
	}
	return out
}

func columnName(col int) string {
	name, _ := excelize.ColumnNumberToName(col)
	return name
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// parseArea converts "A1:B2" (or a single cell) into a 0-based area.
func parseArea(ref string) (CellArea, error) {
	ref = strings.TrimSpace(strings.ReplaceAll(ref, "$", ""))
	if ref == "" {
		return CellArea{}, fmt.Errorf("empty range")
	}
	parts := strings.Split(ref, ":")
	// excelize returns (column, row) from CellNameToCoordinates.
	startCol, startRow, err := excelize.CellNameToCoordinates(parts[0])
	if err != nil {
		return CellArea{}, fmt.Errorf("parse range %q: %w", ref, err)
	}
	endCol, endRow := startCol, startRow
	if len(parts) == 2 {
		c, r, cerr := excelize.CellNameToCoordinates(parts[1])
		if cerr != nil {
			return CellArea{}, fmt.Errorf("parse range %q: %w", ref, cerr)
		}
		endCol, endRow = c, r
	}
	if endRow < startRow || endCol < startCol {
		startRow, endRow = endRow, startRow
		startCol, endCol = endCol, startCol
	}
	return CellArea{
		StartRow:    startRow - 1,
		EndRow:      endRow - 1,
		StartColumn: startCol - 1,
		EndColumn:   endCol - 1,
	}, nil
}

func containsArea(outer, inner CellArea) bool {
	return inner.StartRow >= outer.StartRow && inner.EndRow <= outer.EndRow &&
		inner.StartColumn >= outer.StartColumn && inner.EndColumn <= outer.EndColumn
}

func cellRef(row, col int) string {
	ref, _ := excelize.CoordinatesToCellName(col+1, row+1)
	return ref
}

// cellValue converts a raw stored cell into a renderer scalar.
func cellValue(f *excelize.File, sheet, ref string) any {
	raw, err := f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
	if err != nil || raw == "" {
		return nil
	}
	cellType, err := f.GetCellType(sheet, ref)
	if err == nil {
		switch cellType {
		// A stored number has no explicit type attribute, so Unset is numeric.
		case excelize.CellTypeUnset, excelize.CellTypeNumber, excelize.CellTypeDate:
			if num, perr := strconv.ParseFloat(raw, 64); perr == nil {
				return num
			}
		case excelize.CellTypeBool:
			return raw == "1" || strings.EqualFold(raw, "true")
		}
	}
	return raw
}

func cellFormula(f *excelize.File, sheet, ref string) string {
	formula, err := f.GetCellFormula(sheet, ref)
	if err != nil || formula == "" {
		return ""
	}
	if strings.HasPrefix(formula, "=") {
		return formula
	}
	return "=" + formula
}
