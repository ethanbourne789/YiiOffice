package host

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
	if recents[0]["path"] != "c:\\file1.docx" {
		t.Fatalf("expected path c:\\file1.docx, got %v", recents[0]["path"])
	}

	// Add a second file
	rm.AddRecent("c:\\file2.docx")
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents, got %d", len(recents))
	}
	// file2 should be first (most recent)
	if recents[0]["path"] != "c:\\file2.docx" {
		t.Fatalf("expected file2 first, got %v", recents[0]["path"])
	}

	// Re-add file1 — should move to front
	time.Sleep(10 * time.Millisecond)
	rm.AddRecent("c:\\file1.docx")
	recents = rm.GetRecents(0, 10)
	if len(recents) != 2 {
		t.Fatalf("expected 2 recents after re-add, got %d", len(recents))
	}
	if recents[0]["path"] != "c:\\file1.docx" {
		t.Fatalf("expected file1 first after re-add, got %v", recents[0]["path"])
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
	if page != nil {
		t.Fatalf("expected nil for out-of-range offset, got %v", page)
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

// TestMaxRecents tests the 200 entry cap.
func TestMaxRecents(t *testing.T) {
	dir := testRecentDir(t)
	rm := NewRecentManager(dir)

	for i := 0; i < 210; i++ {
		rm.AddRecent("c:\\file" + string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".docx")
	}

	recents := rm.GetRecents(0, 300)
	if len(recents) > maxRecents {
		t.Fatalf("expected at most %d recents, got %d", maxRecents, len(recents))
	}
}
