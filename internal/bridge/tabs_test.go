package bridge

import (
	"context"
	"encoding/json"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func TestTabsListReturnsHomeTab(t *testing.T) {
	r := NewRouter()
	th := host.NewTabHost()
	RegisterTabs(r, th)
	got, err := r.Invoke(context.Background(), ChannelTabsList, nil)
	if err != nil {
		t.Fatal(err)
	}
	tabs, ok := got.([]host.TabSummary)
	if !ok || len(tabs) != 1 {
		t.Fatalf("expected 1 home tab, got %#v", got)
	}
	if tabs[0].ID != "home" {
		t.Fatalf("expected home tab, got %s", tabs[0].ID)
	}
}

func TestTabsActivateRequiresId(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r, host.NewTabHost())
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, nil); err == nil {
		t.Fatal("expected error")
	}
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, []json.RawMessage{json.RawMessage(`"t1"`)}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTabsActivateSetsActive(t *testing.T) {
	th := host.NewTabHost()
	th.AddTab(host.TabKindDocs, "Doc1", "")
	r := NewRouter()
	RegisterTabs(r, th)

	// Activate tab-1
	_, err := r.Invoke(context.Background(), ChannelTabsActivate, []json.RawMessage{json.RawMessage(`"tab-1"`)})
	if err != nil {
		t.Fatal(err)
	}
	summaries := th.List()
	if summaries[0].Active {
		t.Error("home should not be active")
	}
	if !summaries[1].Active {
		t.Error("tab-1 should be active")
	}
}

func TestTabsClose(t *testing.T) {
	th := host.NewTabHost()
	th.AddTab(host.TabKindDocs, "Doc1", "")
	r := NewRouter()
	RegisterTabs(r, th)

	// Close tab-1
	_, err := r.Invoke(context.Background(), ChannelTabsClose, []json.RawMessage{json.RawMessage(`"tab-1"`)})
	if err != nil {
		t.Fatal(err)
	}
	if len(th.List()) != 1 {
		t.Fatalf("expected 1 tab after close, got %d", len(th.List()))
	}

	// Try to close home - should succeed (no error) but not actually close
	_, err = r.Invoke(context.Background(), ChannelTabsClose, []json.RawMessage{json.RawMessage(`"home"`)})
	if err != nil {
		t.Fatal(err)
	}
	if len(th.List()) != 1 {
		t.Fatal("home should not be closable")
	}
}

func TestTabsCloseRequiresId(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r, host.NewTabHost())
	if _, err := r.Invoke(context.Background(), ChannelTabsClose, nil); err == nil {
		t.Fatal("expected error for missing id")
	}
}

func TestTabsReorder(t *testing.T) {
	th := host.NewTabHost()
	th.AddTab(host.TabKindDocs, "Doc1", "")
	th.AddTab(host.TabKindSheets, "Sheet1", "")
	// [home, tab-1, tab-2]
	r := NewRouter()
	RegisterTabs(r, th)

	// Move tab-2 (index 2) to index 1
	_, err := r.Invoke(context.Background(), ChannelTabsReorder, []json.RawMessage{
		json.RawMessage(`2`), json.RawMessage(`1`),
	})
	if err != nil {
		t.Fatal(err)
	}
	summaries := th.List()
	if summaries[1].ID != "tab-2" {
		t.Fatalf("expected tab-2 at index 1, got %s", summaries[1].ID)
	}
}

func TestTabsReorderRequiresArgs(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r, host.NewTabHost())
	if _, err := r.Invoke(context.Background(), ChannelTabsReorder, nil); err == nil {
		t.Fatal("expected error for missing from")
	}
	if _, err := r.Invoke(context.Background(), ChannelTabsReorder, []json.RawMessage{json.RawMessage(`0`)}); err == nil {
		t.Fatal("expected error for missing to")
	}
}
