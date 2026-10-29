package host

import "testing"

func TestBuildNewMenu(t *testing.T) {
	mb := NewMenuBuilder(NewTabHost())
	items := mb.BuildNewMenu()

	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}

	expected := []string{"new-doc", "new-sheet", "new-slide", "new-markdown", "new-pdf"}
	for i, id := range expected {
		if items[i].ID != id {
			t.Errorf("items[%d].ID = %q, want %q", i, items[i].ID, id)
		}
	}
}

func TestBuildAppMenu(t *testing.T) {
	mb := NewMenuBuilder(NewTabHost())
	menus := mb.BuildAppMenu()

	if len(menus) != 4 {
		t.Fatalf("expected 4 top-level menus, got %d", len(menus))
	}

	expected := []string{"file", "edit", "view", "help"}
	for i, id := range expected {
		if menus[i].ID != id {
			t.Errorf("menus[%d].ID = %q, want %q", i, menus[i].ID, id)
		}
	}

	// File menu should have New submenu
	fileMenu := menus[0]
	if len(fileMenu.Items) == 0 {
		t.Fatal("file menu has no items")
	}
	newItem := fileMenu.Items[0]
	if newItem.ID != "file-new" || newItem.Type != "submenu" {
		t.Errorf("expected file-new submenu, got ID=%q Type=%q", newItem.ID, newItem.Type)
	}
	if len(newItem.Items) != 5 {
		t.Errorf("New submenu has %d items, want 5", len(newItem.Items))
	}
}

func TestBuildTabMenu(t *testing.T) {
	mb := NewMenuBuilder(NewTabHost())
	items := mb.BuildTabMenu("tab-1")

	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}

	// Check separator
	if items[3].Type != "separator" {
		t.Errorf("expected separator at index 3, got Type=%q", items[3].Type)
	}

	expected := []string{"tab-close", "tab-close-others", "tab-close-all", "", "tab-detach"}
	for i, id := range expected {
		if id != "" && items[i].ID != id {
			t.Errorf("items[%d].ID = %q, want %q", i, items[i].ID, id)
		}
	}
}

func TestBuildTabStripMenu(t *testing.T) {
	mb := NewMenuBuilder(NewTabHost())
	items := mb.BuildTabStripMenu()

	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}

	expected := []string{"tabs-close-all", "tabs-close-other"}
	for i, id := range expected {
		if items[i].ID != id {
			t.Errorf("items[%d].ID = %q, want %q", i, items[i].ID, id)
		}
	}
}

func TestValidateMenuID(t *testing.T) {
	valid := []string{
		"tab-close", "tab-close-others", "tab-close-all", "tab-detach",
		"new-doc", "new-sheet", "new-slide", "new-markdown", "new-pdf",
		"file-new", "file-open", "file-close", "file-exit",
		"edit-undo", "edit-redo", "edit-cut", "edit-copy", "edit-paste",
		"view-zoom-in", "view-zoom-out", "view-fullscreen", "view-devtools",
		"help-about", "help-docs",
		"tabs-close-all", "tabs-close-other",
	}

	for _, id := range valid {
		if err := ValidateMenuID(id); err != nil {
			t.Errorf("ValidateMenuID(%q) unexpectedly failed: %v", id, err)
		}
	}

	if err := ValidateMenuID("unknown-id"); err == nil {
		t.Error("ValidateMenuID(\"unknown-id\") should have returned an error")
	}
}
