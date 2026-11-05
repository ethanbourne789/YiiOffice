package host

import (
	"testing"
)

// TestTabHostReadersReturnSnapshots guards V-M2: ActiveTab/GetByID used to
// hand out the internal *Tab, so callers read Kind/Title/Dirty outside the
// RLock while SetDirty/Activate wrote them.
func TestTabHostReadersReturnSnapshots(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc", "")

	first := h.GetByID(id)
	if first == nil {
		t.Fatal("GetByID returned nil")
	}
	first.Title = "mutated"
	first.Dirty = true
	if got := h.GetByID(id); got == nil || got.Title != "Doc" || got.Dirty {
		t.Fatalf("GetByID leaked internal tab state: %+v", got)
	}

	active := h.ActiveTab()
	if active == nil {
		t.Fatal("ActiveTab returned nil")
	}
	active.Dirty = true
	if got := h.GetByID(id); got == nil || got.Dirty {
		t.Fatalf("ActiveTab leaked internal tab state: %+v", got)
	}

	if !h.SetDirty(id, true) {
		t.Fatal("SetDirty returned false")
	}
	if got := h.GetByID(id); got == nil || !got.Dirty {
		t.Fatalf("snapshot did not reflect a real dirty change: %+v", got)
	}
}

func TestTabHostStartsWithHome(t *testing.T) {
	h := NewTabHost()
	summaries := h.List()
	if len(summaries) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(summaries))
	}
	if summaries[0].ID != "home" || summaries[0].Kind != TabKindHome || !summaries[0].Active {
		t.Fatalf("home tab incorrect: %#v", summaries[0])
	}
	if summaries[0].Closable {
		t.Error("home must not be closable: the strip hides its close button on this flag")
	}
}

func TestTabHostReportsClosable(t *testing.T) {
	h := NewTabHost()
	h.AddTab(TabKindDocs, "Doc1", "")
	for _, s := range h.List() {
		want := s.ID != "home"
		if s.Closable != want {
			t.Fatalf("tab %s closable = %v, want %v", s.ID, s.Closable, want)
		}
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

func TestTabHostDirtyTracking(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc1", "")

	if dirty := h.DirtyTabs(); len(dirty) != 0 {
		t.Fatalf("expected no dirty tabs, got %d", len(dirty))
	}
	if !h.SetDirty(id, true) {
		t.Fatal("SetDirty should report success for a known tab")
	}
	dirty := h.DirtyTabs()
	if len(dirty) != 1 || dirty[0].ID != id || !dirty[0].Dirty {
		t.Fatalf("expected tab %s in dirty list, got %+v", id, dirty)
	}
	if list := h.List(); !list[1].Dirty {
		t.Fatal("List should expose the dirty flag")
	}

	h.SetDirty(id, false)
	if dirty := h.DirtyTabs(); len(dirty) != 0 {
		t.Fatalf("expected dirty list to clear, got %d", len(dirty))
	}
	if h.SetDirty("missing", true) {
		t.Fatal("SetDirty should fail for an unknown id")
	}
}

func TestTabHostRestoreTab(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc1", "")
	h.CloseTab(id)
	if !h.RestoreTab(id, TabKindDocs, "Doc1", "") {
		t.Fatal("restore should succeed for a removed tab")
	}
	if tab := h.GetByID(id); tab == nil || tab.Kind != TabKindDocs || !tab.Active {
		t.Fatalf("restored tab should be active docs tab, got %+v", tab)
	}
	if h.RestoreTab(id, TabKindDocs, "Doc1", "") {
		t.Fatal("restore should refuse a duplicate id")
	}
}

func TestCloseGuardReadsTabHostDirtyState(t *testing.T) {
	h := NewTabHost()
	id := h.AddTab(TabKindDocs, "Doc1", "")
	h.SetDirty(id, true)

	blocked := false
	g := NewCloseGuard(h, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			var out []DirtyTab
			for _, ts := range h.DirtyTabs() {
				out = append(out, DirtyTab{ID: ts.ID, Title: ts.Title, Kind: ts.Kind})
			}
			return out
		},
		PromptSave: func(tab DirtyTab) SaveChoice {
			blocked = true
			return Cancel
		},
	})
	if g.ShouldAllowClose() {
		t.Fatal("close should be blocked while a tab is dirty")
	}
	if !blocked {
		t.Fatal("the guard should prompt for the dirty tab")
	}

	h.SetDirty(id, false)
	if !g.ShouldAllowClose() {
		t.Fatal("close should be allowed once the tab is clean")
	}
}
