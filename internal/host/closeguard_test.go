package host

import (
	"fmt"
	"testing"
)

func TestCloseGuardNoDirtyTabs(t *testing.T) {
	th := NewTabHost()
	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab { return nil },
	})

	if !g.ShouldAllowClose() {
		t.Error("should allow close when no dirty tabs")
	}
}

func TestCloseGuardCancelPreventsClose(t *testing.T) {
	th := NewTabHost()
	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Title: "Untitled", Kind: TabKindDocs}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice { return Cancel },
	})

	if g.ShouldAllowClose() {
		t.Error("should not allow close when user cancels")
	}
}

func TestCloseGuardDontSaveAllowsClose(t *testing.T) {
	th := NewTabHost()
	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Title: "Untitled", Kind: TabKindDocs}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice { return DontSave },
	})

	if !g.ShouldAllowClose() {
		t.Error("should allow close when user chooses Don't Save")
	}
}

func TestCloseGuardSaveThenClose(t *testing.T) {
	th := NewTabHost()
	saved := false

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Title: "test.docx", Kind: TabKindDocs}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice { return Save },
		SaveTab: func(tab DirtyTab) error {
			saved = true
			return nil
		},
	})

	if !g.ShouldAllowClose() {
		t.Error("should allow close after saving")
	}
	if !saved {
		t.Error("saveTab should have been called")
	}
}

func TestCloseGuardSaveErrorPreventsClose(t *testing.T) {
	th := NewTabHost()

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Title: "test.docx", Kind: TabKindDocs}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice { return Save },
		SaveTab: func(tab DirtyTab) error {
			return fmt.Errorf("disk full")
		},
	})

	if g.ShouldAllowClose() {
		t.Error("should prevent close when save fails to avoid data loss")
	}
}

func TestCloseGuardMultipleTabsMixedChoices(t *testing.T) {
	th := NewTabHost()
	callCount := 0

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{
				{ID: "tab-1", Title: "doc1.docx", Kind: TabKindDocs},
				{ID: "tab-2", Title: "sheet1.xlsx", Kind: TabKindSheets},
				{ID: "tab-3", Title: "slide1.pptx", Kind: TabKindSlides},
			}
		},
		PromptSave: func(tab DirtyTab) SaveChoice {
			callCount++
			switch tab.ID {
			case "tab-1":
				return Save
			case "tab-2":
				return DontSave
			case "tab-3":
				return Cancel
			}
			return DontSave
		},
		SaveTab: func(tab DirtyTab) error { return nil },
	})

	if g.ShouldAllowClose() {
		t.Error("should not allow close when third tab cancels")
	}
	if callCount != 3 {
		t.Errorf("expected 3 prompts, got %d", callCount)
	}
}

func TestCloseGuardReEntryPrevention(t *testing.T) {
	th := NewTabHost()
	var cg *CloseGuard
	prompted := false

	cg = NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Title: "test.docx", Kind: TabKindDocs}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice {
			prompted = true
			return DontSave
		},
	})

	// Two sequential calls should both succeed
	result1 := cg.ShouldAllowClose()
	result2 := cg.ShouldAllowClose()

	if !result1 || !result2 {
		t.Error("both calls should allow close")
	}
	if !prompted {
		t.Error("prompt should have been called")
	}
}

func TestCloseGuardMultipleTabsAllSave(t *testing.T) {
	th := NewTabHost()
	savedTabs := []string{}

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{
				{ID: "tab-1", Title: "doc1.docx", Kind: TabKindDocs},
				{ID: "tab-2", Title: "sheet1.xlsx", Kind: TabKindSheets},
			}
		},
		PromptSave: func(tab DirtyTab) SaveChoice { return Save },
		SaveTab: func(tab DirtyTab) error {
			savedTabs = append(savedTabs, tab.ID)
			return nil
		},
	})

	if !g.ShouldAllowClose() {
		t.Error("should allow close after saving all tabs")
	}
	if len(savedTabs) != 2 {
		t.Errorf("expected 2 saves, got %d", len(savedTabs))
	}
}

func TestCloseGuardDefaults(t *testing.T) {
	th := NewTabHost()
	g := NewCloseGuard(th, nil)

	// Default config should allow close (no dirty tabs)
	if !g.ShouldAllowClose() {
		t.Error("default config should allow close")
	}
}
