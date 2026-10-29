package host

import "testing"

func TestDetachedDetachReturnsUniqueName(t *testing.T) {
	dh := NewDetachedHost()
	name1 := dh.Detach("tab-1", TabKindDocs, "Doc1")
	name2 := dh.Detach("tab-2", TabKindSheets, "Sheet1")
	if name1 == name2 {
		t.Fatalf("expected unique names, got %s both times", name1)
	}
	if len(dh.List()) != 2 {
		t.Fatalf("expected 2 detached windows, got %d", len(dh.List()))
	}
}

func TestDetachedDockReturnsTabID(t *testing.T) {
	dh := NewDetachedHost()
	name := dh.Detach("tab-1", TabKindDocs, "Doc1")
	tabID, ok := dh.Dock(name)
	if !ok {
		t.Fatal("dock should succeed")
	}
	if tabID != "tab-1" {
		t.Fatalf("expected tab-1, got %s", tabID)
	}
	if len(dh.List()) != 0 {
		t.Fatalf("expected 0 detached windows after dock, got %d", len(dh.List()))
	}
}

func TestDetachedDockUnknownReturnsFalse(t *testing.T) {
	dh := NewDetachedHost()
	_, ok := dh.Dock("nonexistent")
	if ok {
		t.Fatal("dock unknown window should return false")
	}
}

func TestDetachedListReturnsAll(t *testing.T) {
	dh := NewDetachedHost()
	dh.Detach("tab-1", TabKindDocs, "Doc1")
	dh.Detach("tab-2", TabKindSheets, "Sheet1")
	dh.Detach("tab-3", TabKindSlides, "Slide1")

	list := dh.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 detached windows, got %d", len(list))
	}

	// Dock one and verify list shrinks
	dh.Detach("tab-4", TabKindPDF, "PDF1")
	if len(dh.List()) != 4 {
		t.Fatalf("expected 4 detached windows, got %d", len(dh.List()))
	}
}
