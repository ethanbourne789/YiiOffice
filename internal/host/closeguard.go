// Package host implements the window close guard for unsaved documents.
package host

import (
	"log"
	"sync"
)

// SaveChoice represents the user's response to the save dialog.
type SaveChoice int

const (
	Save     SaveChoice = 0
	DontSave SaveChoice = 1
	Cancel   SaveChoice = 2
)

// DirtyTab represents a tab with unsaved changes.
type DirtyTab struct {
	ID    string  `json:"id"`
	Title string  `json:"title"`
	Kind  TabKind `json:"kind"`
}

// CloseGuard prevents closing windows with unsaved documents.
type CloseGuard struct {
	tabHost    *TabHost
	getDirty   func() []DirtyTab
	promptSave func(tab DirtyTab) SaveChoice
	saveTab    func(tab DirtyTab) error

	mu       sync.Mutex
	inFlight bool
}

// CloseGuardConfig configures the close guard.
type CloseGuardConfig struct {
	// GetDirty returns the list of tabs with unsaved changes.
	GetDirty func() []DirtyTab
	// PromptSave shows a save dialog and returns the user's choice.
	PromptSave func(tab DirtyTab) SaveChoice
	// SaveTab saves the given tab. Returns an error if the save fails.
	SaveTab func(tab DirtyTab) error
}

// NewCloseGuard creates a close guard for the given tab host.
func NewCloseGuard(th *TabHost, cfg *CloseGuardConfig) *CloseGuard {
	g := &CloseGuard{
		tabHost: th,
	}

	if cfg != nil {
		g.getDirty = cfg.GetDirty
		g.promptSave = cfg.PromptSave
		g.saveTab = cfg.SaveTab
	}

	// Default: no dirty tabs, always allow close
	if g.getDirty == nil {
		g.getDirty = func() []DirtyTab { return nil }
	}
	if g.promptSave == nil {
		g.promptSave = func(tab DirtyTab) SaveChoice { return DontSave }
	}
	if g.saveTab == nil {
		g.saveTab = func(tab DirtyTab) error { return nil }
	}

	return g
}

// ShouldAllowClose checks all dirty tabs and prompts the user.
// Returns true if the window should be closed, false if the close should be prevented.
func (g *CloseGuard) ShouldAllowClose() bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.inFlight {
		return false // prevent re-entry
	}
	g.inFlight = true
	defer func() { g.inFlight = false }()

	// 1. Query for dirty tabs
	dirtyTabs := g.getDirty()
	if len(dirtyTabs) == 0 {
		return true // clean path - allow close immediately
	}

	// 2. For each dirty tab, ask user to save/don't save/cancel
	for _, tab := range dirtyTabs {
		choice := g.promptSave(tab)
		switch choice {
		case Save:
			if err := g.saveTab(tab); err != nil {
				log.Printf("CloseGuard: save failed for tab %q: %v", tab.Title, err)
				return false // prevent close on save failure — data would be lost
			}
		case Cancel:
			return false // prevent close
		case DontSave:
			// continue to next tab
		}
	}

	return true
}
