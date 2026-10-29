package host

import "fmt"

// MenuItem represents a single menu entry.
type MenuItem struct {
	ID       string     `json:"id"`
	Label    string     `json:"label"`
	Disabled bool       `json:"disabled,omitempty"`
	Checked  bool       `json:"checked,omitempty"`
	Type     string     `json:"type,omitempty"` // "separator", "submenu"
	Items    []MenuItem `json:"items,omitempty"`
}

// MenuBuilder helps construct menus for different contexts.
type MenuBuilder struct {
	tabHost *TabHost
}

// NewMenuBuilder creates a menu builder with access to the tab host.
func NewMenuBuilder(th *TabHost) *MenuBuilder {
	return &MenuBuilder{tabHost: th}
}

// BuildTabMenu builds a context menu for a specific tab.
func (mb *MenuBuilder) BuildTabMenu(tabID string) []MenuItem {
	return []MenuItem{
		{ID: "tab-close", Label: "Close"},
		{ID: "tab-close-others", Label: "Close Others"},
		{ID: "tab-close-all", Label: "Close All"},
		{Type: "separator"},
		{ID: "tab-detach", Label: "Detach"},
	}
}

// BuildNewMenu builds the "New" submenu.
func (mb *MenuBuilder) BuildNewMenu() []MenuItem {
	return []MenuItem{
		{ID: "new-doc", Label: "New Document"},
		{ID: "new-sheet", Label: "New Spreadsheet"},
		{ID: "new-slide", Label: "New Presentation"},
		{ID: "new-markdown", Label: "New Markdown"},
		{ID: "new-pdf", Label: "New PDF"},
	}
}

// BuildAppMenu builds the application menu.
func (mb *MenuBuilder) BuildAppMenu() []MenuItem {
	menus := []MenuItem{
		{
			ID:    "file",
			Label: "File",
			Items: []MenuItem{
				{ID: "file-new", Label: "New", Type: "submenu",
					Items: mb.BuildNewMenu()},
				{Type: "separator"},
				{ID: "file-open", Label: "Open"},
				{ID: "file-close", Label: "Close"},
				{Type: "separator"},
				{ID: "file-exit", Label: "Exit"},
			},
		},
		{
			ID:    "edit",
			Label: "Edit",
			Items: []MenuItem{
				{ID: "edit-undo", Label: "Undo"},
				{ID: "edit-redo", Label: "Redo"},
				{Type: "separator"},
				{ID: "edit-cut", Label: "Cut"},
				{ID: "edit-copy", Label: "Copy"},
				{ID: "edit-paste", Label: "Paste"},
			},
		},
		{
			ID:    "view",
			Label: "View",
			Items: []MenuItem{
				{ID: "view-zoom-in", Label: "Zoom In"},
				{ID: "view-zoom-out", Label: "Zoom Out"},
				{Type: "separator"},
				{ID: "view-fullscreen", Label: "Full Screen"},
				{ID: "view-devtools", Label: "Toggle DevTools", Disabled: true},
			},
		},
		{
			ID:    "help",
			Label: "Help",
			Items: []MenuItem{
				{ID: "help-about", Label: "About YiiOffice"},
				{Type: "separator"},
				{ID: "help-docs", Label: "Documentation"},
			},
		},
	}
	return menus
}

// BuildTabStripMenu builds the tab strip context menu.
func (mb *MenuBuilder) BuildTabStripMenu() []MenuItem {
	return []MenuItem{
		{ID: "tabs-close-all", Label: "Close All Tabs"},
		{ID: "tabs-close-other", Label: "Close Other Tabs"},
	}
}

// ValidateMenuID validates that a menu ID is known.
func ValidateMenuID(id string) error {
	validIDs := map[string]bool{
		// Tab menu
		"tab-close": true, "tab-close-others": true, "tab-close-all": true, "tab-detach": true,
		// New menu
		"new-doc": true, "new-sheet": true, "new-slide": true, "new-markdown": true, "new-pdf": true,
		// File menu
		"file-new": true, "file-open": true, "file-close": true, "file-exit": true,
		// Edit menu
		"edit-undo": true, "edit-redo": true, "edit-cut": true, "edit-copy": true, "edit-paste": true,
		// View menu
		"view-zoom-in": true, "view-zoom-out": true, "view-fullscreen": true, "view-devtools": true,
		// Help menu
		"help-about": true, "help-docs": true,
		// Tab strip
		"tabs-close-all": true, "tabs-close-other": true,
	}
	if !validIDs[id] {
		return fmt.Errorf("unknown menu id: %s", id)
	}
	return nil
}
