// Package host implements desktop services independent of any UI framework.
package host

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// TabKind identifies the editor type for a tab.
type TabKind string

const (
	TabKindDocs     TabKind = "docs"
	TabKindSheets   TabKind = "sheets"
	TabKindSlides   TabKind = "slides"
	TabKindPDF      TabKind = "pdf"
	TabKindMarkdown TabKind = "markdown"
	TabKindHome     TabKind = "home"
)

// Tab represents an open document tab.
type Tab struct {
	ID     string  `json:"id"`
	Kind   TabKind `json:"kind"`
	Title  string  `json:"title"`
	Path   string  `json:"path,omitempty"`
	Active bool    `json:"active"`
	Dirty  bool    `json:"dirty"`
}

// TabSummary is the serializable view sent to the frontend. Path is included
// so a renderer can resolve the file it was opened with (tabId -> path).
// Closable is explicit because the shell hides the tab's close button on it
// (Home is pinned and has none) — it must not be inferred from the id there.
type TabSummary struct {
	ID       string  `json:"id"`
	Kind     TabKind `json:"kind"`
	Title    string  `json:"title"`
	Path     string  `json:"path,omitempty"`
	Active   bool    `json:"active"`
	Dirty    bool    `json:"dirty"`
	Closable bool    `json:"closable"`
}

// summary renders a tab for the frontend.
func summary(t *Tab) TabSummary {
	return TabSummary{
		ID:       t.ID,
		Kind:     t.Kind,
		Title:    t.Title,
		Path:     t.Path,
		Active:   t.Active,
		Dirty:    t.Dirty,
		Closable: t.ID != "home",
	}
}

// TabHost manages the ordered list of open tabs.
type TabHost struct {
	mu     sync.RWMutex
	tabs   []*Tab
	nextID atomic.Int64
}

// NewTabHost creates an empty tab host with a Home tab.
func NewTabHost() *TabHost {
	return &TabHost{tabs: []*Tab{
		{ID: "home", Kind: TabKindHome, Title: "Home", Active: true},
	}}
}

// List returns serializable summaries of all tabs.
func (h *TabHost) List() []TabSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]TabSummary, len(h.tabs))
	for i, t := range h.tabs {
		out[i] = summary(t)
	}
	return out
}

// SetDirty marks a tab as having unsaved changes. Returns false for unknown IDs.
func (h *TabHost) SetDirty(id string, dirty bool) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range h.tabs {
		if t.ID == id {
			t.Dirty = dirty
			return true
		}
	}
	return false
}

// DirtyTabs returns summaries of every tab with unsaved changes.
func (h *TabHost) DirtyTabs() []TabSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var out []TabSummary
	for _, t := range h.tabs {
		if t.Dirty {
			s := summary(t)
			s.Dirty = true
			out = append(out, s)
		}
	}
	return out
}

// RestoreTab re-adds a previously detached tab, keeping its original ID so
// renderers can keep their per-tab state. Existing IDs are left untouched.
func (h *TabHost) RestoreTab(id string, kind TabKind, title string, path string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range h.tabs {
		if t.ID == id {
			return false
		}
	}
	for _, t := range h.tabs {
		t.Active = false
	}
	h.tabs = append(h.tabs, &Tab{ID: id, Kind: kind, Title: title, Path: path, Active: true})
	return true
}

// Activate sets the active tab by ID. Returns true if found.
func (h *TabHost) Activate(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	found := false
	for _, t := range h.tabs {
		t.Active = t.ID == id
		if t.ID == id {
			found = true
		}
	}
	return found
}

// AddTab creates a new tab and returns its ID.
func (h *TabHost) AddTab(kind TabKind, title string, path string) string {
	id := fmt.Sprintf("tab-%d", h.nextID.Add(1))
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range h.tabs {
		t.Active = false
	}
	h.tabs = append(h.tabs, &Tab{ID: id, Kind: kind, Title: title, Path: path, Active: true})
	return id
}

// CloseTab removes a tab by ID. Home tab cannot be closed.
func (h *TabHost) CloseTab(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if id == "home" {
		return false
	}
	for i, t := range h.tabs {
		if t.ID == id {
			h.tabs = append(h.tabs[:i], h.tabs[i+1:]...)
			if t.Active && len(h.tabs) > 0 {
				h.tabs[len(h.tabs)-1].Active = true
			}
			return true
		}
	}
	return false
}

// Reorder moves a tab from oldIndex to newIndex.
func (h *TabHost) Reorder(from, to int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if from < 0 || from >= len(h.tabs) || to < 0 || to >= len(h.tabs) {
		return false
	}
	tab := h.tabs[from]
	if from < to {
		copy(h.tabs[from:], h.tabs[from+1:to+1])
	} else {
		copy(h.tabs[to+1:], h.tabs[to:from])
	}
	h.tabs[to] = tab
	return true
}

// ActiveTab returns the currently active tab, or nil.
func (h *TabHost) ActiveTab() *Tab {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, t := range h.tabs {
		if t.Active {
			return t
		}
	}
	return nil
}

// GetByID returns a tab by ID, or nil if not found.
func (h *TabHost) GetByID(id string) *Tab {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, t := range h.tabs {
		if t.ID == id {
			return t
		}
	}
	return nil
}
