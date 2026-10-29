package host

import (
	"testing"
)

func TestTabHostStartsWithHome(t *testing.T) {
	h := NewTabHost()
	summaries := h.List()
	if len(summaries) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(summaries))
	}
	if summaries[0].ID != "home" || summaries[0].Kind != TabKindHome || !summaries[0].Active {
		t.Fatalf("home tab incorrect: %#v", summaries[0])
	}
}

func TestTabHostAddAndActivate(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc1", "/path/to/doc1")
	if id != "tab-1" {
		t.Fatalf("expected tab-1, got %s", id)
	}

	summaries := h.List()
	if len(summaries) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(summaries))
	}
	if summaries[0].Active {
		t.Error("home should not be active after adding tab")
	}
	if !summaries[1].Active {
		t.Error("new tab should be active")
	}

	// Activate home
	if !h.Activate("home") {
		t.Fatal("activate home should succeed")
	}
	summaries = h.List()
	if !summaries[0].Active || summaries[1].Active {
		t.Fatal("activate home failed")
	}

	// Activate non-existent tab
	if h.Activate("nonexistent") {
		t.Fatal("activate nonexistent should return false")
	}
}

func TestTabHostCloseNonHome(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc1", "")

	if !h.CloseTab(id) {
		t.Fatal("close should succeed")
	}
	if len(h.List()) != 1 {
		t.Fatalf("expected 1 tab after close, got %d", len(h.List()))
	}
	if !h.List()[0].Active {
		t.Error("home should be active after closing the only other tab")
	}
}

func TestTabHostCannotCloseHome(t *testing.T) {
	h := NewTabHost()
	if h.CloseTab("home") {
		t.Fatal("closing home should return false")
	}
	if len(h.List()) != 1 {
		t.Fatal("home should still exist")
	}
}

func TestTabHostReorder(t *testing.T) {
	h := NewTabHost()
	h.AddTab(TabKindDocs, "Doc1", "")
	h.AddTab(TabKindSheets, "Sheet1", "")
	// tabs: [home, tab-1, tab-2]

	// Move tab-2 to position 1
	if !h.Reorder(2, 1) {
		t.Fatal("reorder should succeed")
	}
	summaries := h.List()
	if summaries[1].ID != "tab-2" {
		t.Fatalf("expected tab-2 at index 1, got %s", summaries[1].ID)
	}
	if summaries[2].ID != "tab-1" {
		t.Fatalf("expected tab-1 at index 2, got %s", summaries[2].ID)
	}
}

func TestTabHostReorderOutOfBounds(t *testing.T) {
	h := NewTabHost()
	if h.Reorder(-1, 0) {
		t.Fatal("negative from should fail")
	}
	if h.Reorder(0, -1) {
		t.Fatal("negative to should fail")
	}
	if h.Reorder(0, 100) {
		t.Fatal("to out of bounds should fail")
	}
	if h.Reorder(100, 0) {
		t.Fatal("from out of bounds should fail")
	}
}
