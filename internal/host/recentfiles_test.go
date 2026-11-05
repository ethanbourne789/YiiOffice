package host

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

// TestGetStarredGroupsReturnsCopy guards V-M3: callers used to receive the
// internal slice and could mutate host state without holding rm.mu.
func TestGetStarredGroupsReturnsCopy(t *testing.T) {
	rm := NewRecentManager(t.TempDir())
	groups := rm.GetStarredGroups()
	if len(groups) == 0 {
		t.Fatal("expected default groups")
	}
	want := groups[0]
	groups[0] = "Mutated"
	if got := rm.GetStarredGroups(); got[0] != want {
		t.Fatalf("caller mutation leaked into the store: %q", got[0])
	}
}

// TestAddRecentKeepsOrderAfterInPlaceShift guards the V-M3 optimisation:
// prepending without allocating a new slice must keep newest-first and dedupe.
func TestAddRecentKeepsOrderAfterInPlaceShift(t *testing.T) {
	rm := NewRecentManager(t.TempDir())
	rm.AddRecent("a.docx")
	rm.AddRecent("b.docx")
	rm.AddRecent("a.docx")
	snap := rm.RecentsSnapshot()
	if len(snap) != 2 {
		t.Fatalf("expected 2 recents after dedupe, got %d: %+v", len(snap), snap)
	}
	if snap[0].Path != "a.docx" || snap[1].Path != "b.docx" {
		t.Fatalf("unexpected order: %+v", snap)
	}
}

func testRecentDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return dir
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	for i := 0; i < 50; i++ {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("file not created: %s", path)
}

// TestAddRecent tests adding entries and deduplication.
func TestAddRecent(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	rm.AddRecent("c:\\file1.docx")
	waitForFile(t, rm.recentFile())

	recents := rm.GetRecents(0, 10)
	if len(recents) != 1 {
		t.Fatalf("expected 1 recent, got %d", len(recents))
	}
	if recents[0].Path != "c:\\file1.docx" {
		t.Fatalf("expected path c:\\file1.docx, got %v", recents[0].Path)
	}

	// Add a second file
	rm.AddRecent("c:\\file2.docx")
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents, got %d", len(recents))
	}
	// file2 should be first (most recent)
	if recents[0].Path != "c:\\file2.docx" {
		t.Fatalf("expected file2 first, got %v", recents[0].Path)
	}

	// Re-add file1 — should move to front
	time.Sleep(10 * time.Millisecond)
	rm.AddRecent("c:\\file1.docx")
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents after re-add, got %d", len(recents))
	}
	if recents[0].Path != "c:\\file1.docx" {
		t.Fatalf("expected file1 first after re-add, got %v", recents[0].Path)
	}
}

// TestAddRecentRejectsBlankPaths locks the guard that keeps an unresolved
// path from adding an empty row or displacing a real one.
func TestAddRecentRejectsBlankPaths(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	rm.AddRecent(`c:\real.docx`)
	for _, blank := range []string{"", "   ", "\t\n", ".", " . ", "./"} {
		rm.AddRecent(blank)
	}

	recents := rm.GetRecents(0, 10)
	if len(recents) != 1 {
		t.Fatalf("expected blank paths to be rejected, got %d recents", len(recents))
	}
	if recents[0].Path != `c:\real.docx` {
		t.Fatalf("expected the real path to survive, got %q", recents[0].Path)
	}

	// A legal path still lands in front of the existing record.
	rm.AddRecent(`  c:\another.docx  `)
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents, got %d", len(recents))
	}
	if recents[0].Path != `c:\another.docx` {
		t.Fatalf("expected the trimmed path first, got %q", recents[0].Path)
	}

	// The persisted file must not contain a blank row either.
	raw, err := os.ReadFile(rm.recentFile())
	if err != nil {
		t.Fatalf("read recent.json: %v", err)
	}
	var stored []RecentEntry
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("recent.json is not valid JSON: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("expected 2 stored recents, got %d", len(stored))
	}
	for _, r := range stored {
		if strings.TrimSpace(r.Path) == "" || filepath.Clean(r.Path) == "." {
			t.Fatalf("stored a blank recent path: %q", r.Path)
		}
	}
}

// TestGetRecentsPagination tests offset/limit pagination.
func TestGetRecentsPagination(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	// Add files in reverse order so oldest is first
	for i := 10; i >= 1; i-- {
		rm.AddRecent(filepath.Clean("c:\\file" + string(rune('0'+i)) + ".docx"))
		time.Sleep(10 * time.Millisecond)
	}

	// Page 0, limit 3
	page := rm.GetRecents(0, 3)
	if len(page) != 3 {
		t.Fatalf("page 0: expected 3, got %d", len(page))
	}

	// Page 3, limit 3
	page = rm.GetRecents(3, 3)
	if len(page) != 3 {
		t.Fatalf("page 3: expected 3, got %d", len(page))
	}

	// Page beyond end
	page = rm.GetRecents(100, 10)
	if len(page) != 0 {
		t.Fatalf("expected no rows for out-of-range offset, got %v", page)
	}

	// Partial page at end
	page = rm.GetRecents(8, 10)
	if len(page) != 2 {
		t.Fatalf("partial page: expected 2, got %d", len(page))
	}
}

// TestRemoveRecent tests removing a recent file entry.
func TestRemoveRecent(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	rm.AddRecent("c:\\keep.docx")
	rm.AddRecent("c:\\remove.docx")
	rm.AddRecent("c:\\keep2.docx")

	rm.RemoveRecent("c:\\remove.docx")

	recents := rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents after remove, got %d", len(recents))
	}

	// Case-insensitive remove
	rm.AddRecent("C:\\UPPER.DOCX")
	rm.RemoveRecent("c:\\upper.docx")
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents after case-insensitive remove, got %d", len(recents))
	}
}

// TestToggleStar tests starring and unstarri ng.
func TestToggleStar(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	// Star a file
	starred := rm.ToggleStar("c:\\important.docx")
	if !starred {
		t.Fatal("expected true (starred)")
	}

	files := rm.GetStarred()
	if len(files) != 1 {
		t.Fatalf("expected 1 starred, got %d", len(files))
	}

	// Unstar
	starred = rm.ToggleStar("c:\\important.docx")
	if starred {
		t.Fatal("expected false (unstarred)")
	}

	files = rm.GetStarred()
	if len(files) != 0 {
		t.Fatalf("expected 0 starred after unstar, got %d", len(files))
	}

	// Case-insensitive toggle
	rm.ToggleStar("C:\\CASE.DOCX")
	starred = rm.ToggleStar("c:\\case.docx")
	if starred {
		t.Fatal("expected false for case-insensitive unstar")
	}
}

// TestGetStarredGroups tests default groups and persistence.
func TestGetStarredGroups(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	groups := rm.GetStarredGroups()
	if len(groups) != 2 {
		t.Fatalf("expected 2 default groups, got %d", len(groups))
	}
	if groups[0] != "Important" || groups[1] != "Work" {
		t.Fatalf("unexpected default groups: %v", groups)
	}
}

// TestUnstarPaths tests bulk unstar.
func TestUnstarPaths(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	rm.ToggleStar("c:\\a.docx")
	rm.ToggleStar("c:\\b.docx")
	rm.ToggleStar("c:\\c.docx")

	rm.UnstarPaths([]string{"c:\\a.docx", "c:\\c.docx"})

	files := rm.GetStarred()
	if len(files) != 1 {
		t.Fatalf("expected 1 starred after unstar, got %d", len(files))
	}
	if files[0].Path != "c:\\b.docx" {
		t.Fatalf("expected b.docx, got %s", files[0].Path)
	}
}

// TestStatPaths tests file stat.
func TestStatPaths(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	// Create a real temp file
	tmpf := filepath.Join(dir, "statme.txt")
	os.WriteFile(tmpf, []byte("hello"), 0o644)

	results := rm.StatPaths([]string{tmpf, "c:\\nonexistent\\file.docx"})
	if len(results) != 2 {
		t.Fatalf("expected 2 stat results, got %d", len(results))
	}

	// First should be available
	if !results[0].Available {
		t.Fatal("expected first file available")
	}
	if results[0].Size != 5 {
		t.Fatalf("expected size 5, got %d", results[0].Size)
	}

	// Second should not be available
	if results[1].Available {
		t.Fatal("expected second file unavailable")
	}
}

// TestSetStarredGroup tests setting group on a starred file.
func TestSetStarredGroup(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	rm.ToggleStar("c:\\doc.docx")
	rm.SetStarredGroup("c:\\doc.docx", "Work")

	files := rm.GetStarred()
	if len(files) != 1 {
		t.Fatalf("expected 1 starred, got %d", len(files))
	}
	if files[0].Group != "Work" {
		t.Fatalf("expected group 'Work', got %q", files[0].Group)
	}
}

// TestSortByTime tests the SortByTime utility.
func TestSortByTime(t *testing.T) {
	entries := []RecentEntry{
		{Path: "a", Ts: 100},
		{Path: "b", Ts: 300},
		{Path: "c", Ts: 200},
	}
	SortByTime(entries)

	if entries[0].Path != "b" || entries[1].Path != "c" || entries[2].Path != "a" {
		t.Fatalf("sort failed: %v", entries)
	}
}

// TestPersistence tests that data survives reload.
func TestPersistence(t *testing.T) {
	dir := testRecentDir(t)

	rm := NewRecentManager(dir)
	rm.AddRecent("c:\\persist.docx")
	rm.ToggleStar("c:\\star.persist")

	// Create a new manager from the same dir — simulates reload
	rm2 := NewRecentManager(dir)

	recents := rm2.GetRecents(0, 10)
	if len(recents) != 1 {
		t.Fatalf("expected 1 recent after reload, got %d", len(recents))
	}

	starred := rm2.GetStarred()
	if len(starred) != 1 {
		t.Fatalf("expected 1 starred after reload, got %d", len(starred))
	}
	if starred[0].Path != "c:\\star.persist" {
		t.Fatalf("expected starred path c:\\star.persist, got %s", starred[0].Path)
	}
}

// TestRecentsUnbounded locks the removal of the old 200-entry write cap: the
// history used to be truncated on every add, so older rows could never be
// paged back in later.
func TestRecentsUnbounded(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	for i := 0; i < 500; i++ {
		rm.AddRecent("c:\\file" + string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".docx")
	}

	if got := len(rm.RecentsSnapshot()); got != 500 {
		t.Fatalf("expected 500 recents to be kept, got %d", got)
	}
	recents := rm.GetRecents(0, 1000)
	if len(recents) != 500 {
		t.Fatalf("expected GetRecents to page all 500, got %d", len(recents))
	}
}

// seedRecents writes a pre-existing recent.json directly (newest first), so a
// single AddRecent exercises the trim instead of thousands of atomic writes.
func seedRecents(t *testing.T, dir string, n int) {
	t.Helper()
	entries := make([]RecentEntry, 0, n)
	base := time.Now().Add(-time.Duration(n) * time.Minute).UnixMilli()
	for i := 0; i < n; i++ {
		entries = append(entries, RecentEntry{
			Path: fmt.Sprintf(`c:\old-%04d.docx`, i),
			Ts:   base - int64(i),
		})
	}
	if err := fsutil.WriteJSONAtomic(filepath.Join(dir, "recent.json"), entries, 0o644); err != nil {
		t.Fatalf("seed recent.json: %v", err)
	}
}

// seedStarred writes starred.json directly for cases where starring thousands
// of files through ToggleStar would dominate the test runtime.
func seedStarred(t *testing.T, dir string, files []StarredFile) {
	t.Helper()
	data := struct {
		Groups []string      `json:"groups"`
		Files  []StarredFile `json:"files"`
	}{Groups: []string{"Important", "Work"}, Files: files}
	if err := fsutil.WriteJSONAtomic(filepath.Join(dir, "starred.json"), data, 0o644); err != nil {
		t.Fatalf("seed starred.json: %v", err)
	}
}

func recentPaths(entries []RecentEntry) []string {
	paths := make([]string, len(entries))
	for i, r := range entries {
		paths[i] = r.Path
	}
	return paths
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestRecentSoftCapTrimsToNewest locks the cap: a single add after 5000 stored
// records keeps exactly the newest 2000, in the same newest-first order, and
// the result is identical for the same input (eviction is deterministic).
func TestRecentSoftCapTrimsToNewest(t *testing.T) {
	dir := testRecentDir(t)
	seedRecents(t, dir, 5000)
	rm := NewRecentManager(dir)

	rm.AddRecent(`c:\brand-new.docx`)

	got := rm.RecentsSnapshot()
	if len(got) != recentSoftCap {
		t.Fatalf("expected %d recents after trim, got %d", recentSoftCap, len(got))
	}
	if got[0].Path != `c:\brand-new.docx` {
		t.Fatalf("expected the new record first, got %q", got[0].Path)
	}
	// The seeded tail is already newest-first, so position i must be old-(i-1).
	for i := 1; i < len(got); i++ {
		want := fmt.Sprintf(`c:\old-%04d.docx`, i-1)
		if got[i].Path != want {
			t.Fatalf("position %d: expected %q, got %q", i, want, got[i].Path)
		}
	}
	if last := got[len(got)-1].Path; last != `c:\old-1998.docx` {
		t.Fatalf("expected the oldest kept record to be old-1998, got %q", last)
	}
	if pages := rm.GetRecents(0, 5000); len(pages) != recentSoftCap {
		t.Fatalf("expected paging to see only %d rows, got %d", recentSoftCap, len(pages))
	}

	// Same input in a fresh directory must produce the same path sequence.
	dir2 := testRecentDir(t)
	seedRecents(t, dir2, 5000)
	rm2 := NewRecentManager(dir2)
	rm2.AddRecent(`c:\brand-new.docx`)
	if !sameStrings(recentPaths(got), recentPaths(rm2.RecentsSnapshot())) {
		t.Fatal("trim is not deterministic: identical input produced different lists")
	}
}

// TestRecentSoftCapPersistedFormat keeps recent.json readable and unchanged in
// shape: 2-space indented array via WriteJSONAtomic, newline-terminated.
func TestRecentSoftCapPersistedFormat(t *testing.T) {
	dir := testRecentDir(t)
	seedRecents(t, dir, 5000)
	rm := NewRecentManager(dir)

	rm.AddRecent(`c:\brand-new.docx`)

	raw, err := os.ReadFile(rm.recentFile())
	if err != nil {
		t.Fatalf("read recent.json: %v", err)
	}
	text := string(raw)
	if !strings.HasPrefix(text, "[\n  {\n    \"path\": ") {
		t.Fatalf("expected 2-space indented JSON array, got prefix %q", text[:min(len(text), 40)])
	}
	if !strings.HasSuffix(text, "\n") {
		t.Fatal("expected recent.json to end with a newline")
	}
	var stored []RecentEntry
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("recent.json is not valid JSON: %v", err)
	}
	if len(stored) != recentSoftCap {
		t.Fatalf("expected %d stored recents, got %d", recentSoftCap, len(stored))
	}
}

// TestRecentSoftCapKeepsStarredOldEntries locks the protection rule: a record
// past the cap survives when its path is starred, matched case-insensitively,
// and is appended after the capped head without disturbing the order.
func TestRecentSoftCapKeepsStarredOldEntries(t *testing.T) {
	dir := testRecentDir(t)
	seedRecents(t, dir, 4000)
	// Different casing than the stored path exercises the EqualFold matching
	// that every other starred lookup uses.
	seedStarred(t, dir, []StarredFile{{Path: `C:\OLD-3000.DOCX`, Group: "Work"}})
	rm := NewRecentManager(dir)

	rm.AddRecent(`c:\brand-new.docx`)

	got := rm.RecentsSnapshot()
	if len(got) != recentSoftCap+1 {
		t.Fatalf("expected cap + 1 pinned star, got %d", len(got))
	}
	if got[0].Path != `c:\brand-new.docx` {
		t.Fatalf("expected the new record first, got %q", got[0].Path)
	}
	if last := got[len(got)-1].Path; last != `c:\old-3000.docx` {
		t.Fatalf("expected the starred old record last, got %q", last)
	}
	for i, r := range got[:recentSoftCap] {
		if want := fmt.Sprintf(`c:\old-%04d.docx`, i-1); i > 0 && r.Path != want {
			t.Fatalf("capped head position %d: expected %q, got %q", i, want, r.Path)
		}
	}
	// The oldest overflow row that is not starred is gone; the next one too.
	for _, r := range got {
		if strings.EqualFold(r.Path, `c:\old-1999.docx`) || strings.EqualFold(r.Path, `c:\old-3001.docx`) {
			t.Fatalf("expected non-starred overflow row %q to be evicted", r.Path)
		}
	}
	if !rm.IsStarred(`c:\old-3000.docx`) {
		t.Fatal("evicting recents must not unstar the file")
	}
}

// TestRecentSoftCapAllStarredOverflow pins the chosen boundary: when more than
// recentSoftCap recents are starred the list exceeds the cap instead of
// dropping starred rows. The cap stays bounded at 2000 + starred-in-recents.
func TestRecentSoftCapAllStarredOverflow(t *testing.T) {
	dir := testRecentDir(t)
	const n = 2500
	seedRecents(t, dir, n)
	files := make([]StarredFile, 0, n)
	for i := 0; i < n; i++ {
		files = append(files, StarredFile{Path: fmt.Sprintf(`c:\old-%04d.docx`, i)})
	}
	seedStarred(t, dir, files)
	rm := NewRecentManager(dir)

	rm.AddRecent(`c:\brand-new.docx`)

	got := rm.RecentsSnapshot()
	if len(got) != n+1 {
		t.Fatalf("expected all %d starred recents to survive, got %d", n+1, len(got))
	}
	// Nothing was dropped: every seeded path is still present.
	seen := make(map[string]bool, len(got))
	for _, r := range got {
		seen[strings.ToLower(r.Path)] = true
	}
	for i := 0; i < n; i++ {
		if !seen[fmt.Sprintf(`c:\old-%04d.docx`, i)] {
			t.Fatalf("starred record old-%04d was evicted", i)
		}
	}
}

// TestRecentSoftCapIncrementalAdds drives the cap through real AddRecent calls
// (the only trim trigger) and checks the list stays at the cap and newest-first.
func TestRecentSoftCapIncrementalAdds(t *testing.T) {
	dir := testRecentDir(t)
	seedRecents(t, dir, recentSoftCap-1)
	rm := NewRecentManager(dir)

	for i := 0; i < 101; i++ {
		rm.AddRecent(fmt.Sprintf(`c:\live-%03d.docx`, i))
	}

	got := rm.RecentsSnapshot()
	if len(got) != recentSoftCap {
		t.Fatalf("expected %d recents after incremental adds, got %d", recentSoftCap, len(got))
	}
	if got[0].Path != `c:\live-100.docx` {
		t.Fatalf("expected the latest add first, got %q", got[0].Path)
	}
	if got[1].Path != `c:\live-099.docx` {
		t.Fatalf("expected newest-first order, got %q at position 1", got[1].Path)
	}
}
