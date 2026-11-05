package host

import (
	"testing"
)

// The guard must hand "Save" to the renderer when an async saver is wired:
// the documents live in an iframe, so returning true would close the window
// before anything was written.
func TestCloseGuardDefersSaveToRenderer(t *testing.T) {
	th := NewTabHost()
	var requested []DirtyTab
	syncSaved := false

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{
				{ID: "tab-1", Title: "a.docx", Kind: TabKindDocs},
				{ID: "tab-2", Title: "b.xlsx", Kind: TabKindSheets},
			}
		},
		PromptSave:      func(tab DirtyTab) SaveChoice { return Save },
		SaveTab:         func(tab DirtyTab) error { syncSaved = true; return nil },
		OnSaveRequested: func(tabs []DirtyTab) { requested = append(requested, tabs...) },
	})

	if g.ShouldAllowClose() {
		t.Fatal("close must be refused: the save is asynchronous")
	}
	if syncSaved {
		t.Error("SaveTab must not run when the renderer owns the save")
	}
	if len(requested) != 2 {
		t.Fatalf("expected both dirty tabs to be requested, got %+v", requested)
	}
	if requested[0].ID != "tab-1" || requested[1].ID != "tab-2" {
		t.Errorf("unexpected order: %+v", requested)
	}
}

// Cancel must win even when other tabs were already queued for saving.
func TestCloseGuardCancelSkipsSaveRequest(t *testing.T) {
	th := NewTabHost()
	requested := false
	calls := 0

	g := NewCloseGuard(th, &CloseGuardConfig{
		GetDirty: func() []DirtyTab {
			return []DirtyTab{{ID: "tab-1", Kind: TabKindDocs}, {ID: "tab-2", Kind: TabKindSheets}}
		},
		PromptSave: func(tab DirtyTab) SaveChoice {
			calls++
			if calls == 1 {
				return Save
			}
			return Cancel
		},
		OnSaveRequested: func(tabs []DirtyTab) { requested = true },
	})

	if g.ShouldAllowClose() {
		t.Fatal("cancel must prevent the close")
	}
	if requested {
		t.Error("a cancelled prompt must not start a save")
	}
}

func TestCloseFlowQuitsAfterSuccessfulSave(t *testing.T) {
	var got CloseSaveRequest
	quit := 0
	flow := NewCloseFlow(func(req CloseSaveRequest) { got = req }, func() { quit++ })

	tabs := []DirtyTab{{ID: "tab-1", Title: "a.docx", Kind: TabKindDocs}}
	flow.RequestSave(tabs)
	if got.RequestID != 1 || len(got.Tabs) != 1 {
		t.Fatalf("unexpected request: %+v", got)
	}
	if !flow.Pending() {
		t.Error("request should be pending until the renderer answers")
	}

	if !flow.Complete(map[string]any{"requestId": float64(1), "ok": true}) {
		t.Fatal("a successful answer must retry the quit")
	}
	if quit != 1 {
		t.Errorf("expected one quit retry, got %d", quit)
	}
	if flow.Pending() {
		t.Error("a completed request must not stay pending")
	}
}

func TestCloseFlowKeepsWindowOpenOnFailedSave(t *testing.T) {
	quit := 0
	flow := NewCloseFlow(func(CloseSaveRequest) {}, func() { quit++ })
	flow.RequestSave([]DirtyTab{{ID: "tab-1", Kind: TabKindDocs}})

	if flow.Complete(map[string]any{"requestId": float64(1), "ok": false}) {
		t.Fatal("a failed save must not retry the quit")
	}
	if quit != 0 {
		t.Errorf("quit must not run after a failed save, ran %d times", quit)
	}
}

// A late answer to a superseded request must not close the window: the user
// retried and the newer save set is still running.
func TestCloseFlowIgnoresStaleAnswer(t *testing.T) {
	quit := 0
	flow := NewCloseFlow(func(CloseSaveRequest) {}, func() { quit++ })
	flow.RequestSave([]DirtyTab{{ID: "tab-1", Kind: TabKindDocs}})
	flow.RequestSave([]DirtyTab{{ID: "tab-1", Kind: TabKindDocs}})

	if flow.Complete(map[string]any{"requestId": float64(1), "ok": true}) {
		t.Fatal("answer to a superseded request must be ignored")
	}
	if quit != 0 {
		t.Errorf("quit must not run, ran %d times", quit)
	}
	if !flow.Pending() {
		t.Error("the newer request must still be pending")
	}
}

func TestCloseFlowIgnoresMalformedPayload(t *testing.T) {
	flow := NewCloseFlow(func(CloseSaveRequest) {}, func() { panic("quit must not run") })
	flow.RequestSave([]DirtyTab{{ID: "tab-1", Kind: TabKindDocs}})

	for _, payload := range []any{nil, "nope", map[string]any{"ok": true}} {
		if flow.Complete(payload) {
			t.Errorf("payload %v must be rejected", payload)
		}
	}
	if !flow.Pending() {
		t.Error("a malformed answer must leave the request pending")
	}
}

func TestCloseFlowEmptyRequestIsNoop(t *testing.T) {
	called := false
	flow := NewCloseFlow(func(CloseSaveRequest) { called = true }, func() {})
	flow.RequestSave(nil)
	if called {
		t.Error("no dirty tabs must not publish a request")
	}
	if flow.Pending() {
		t.Error("nothing should be pending")
	}
}
