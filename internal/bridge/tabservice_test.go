package bridge

import (
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestTabService(t *testing.T) *TabService {
	t.Helper()
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	return NewTabService(th, dh)
}

func TestTabServiceListReturnsInitialHome(t *testing.T) {
	svc := newTestTabService(t)
	list := svc.List()

	if len(list) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(list))
	}
	if list[0].ID != "home" {
		t.Fatalf("expected home tab, got %s", list[0].ID)
	}
	if list[0].Kind != host.TabKindHome {
		t.Fatalf("expected home kind, got %s", list[0].Kind)
	}
	if !list[0].Active {
		t.Fatal("expected home tab to be active")
	}
}

func TestTabServiceActivate(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")

	svc.Activate("home")
	list := svc.List()
	if !list[0].Active {
		t.Fatal("home should be active")
	}
	if list[1].Active {
		t.Fatal("Doc1 should not be active")
	}

	svc.Activate("tab-1")
	list = svc.List()
	if list[0].Active {
		t.Fatal("home should not be active")
	}
	if !list[1].Active {
		t.Fatal("Doc1 should be active")
	}
}

func TestTabServiceCloseNonHomeTab(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")
	if len(th.List()) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(th.List()))
	}

	svc.Close("tab-1")
	list := th.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 tab after close, got %d", len(list))
	}
	if list[0].ID != "home" {
		t.Fatalf("expected only home tab, got %s", list[0].ID)
	}
}

func TestTabServiceCloseHomeDoesNothing(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	svc.Close("home")
	list := th.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 tab, home cannot be closed, got %d", len(list))
	}
}

func TestTabServiceReorder(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")
	th.AddTab(host.TabKindSheets, "Sheet1", "")
	// tabs: [home, tab-1, tab-2]

	svc.Reorder(2, 1)
	list := th.List()
	if list[1].ID != "tab-2" {
		t.Fatalf("expected tab-2 at index 1, got %s", list[1].ID)
	}
	if list[2].ID != "tab-1" {
		t.Fatalf("expected tab-1 at index 2, got %s", list[2].ID)
	}
}

func TestTabServiceDetach(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")

	svc.Detach("tab-1")

	// The tab should have been removed from the host
	list := th.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 tab after detach, got %d", len(list))
	}
	if list[0].ID != "home" {
		t.Fatalf("expected only home tab, got %s", list[0].ID)
	}

	// Detached host should have a new entry
	detached := dh.List()
	if len(detached) != 1 {
		t.Fatalf("expected 1 detached window, got %d", len(detached))
	}
	if detached[0].TabID != "tab-1" {
		t.Fatalf("expected detached tab ID tab-1, got %s", detached[0].TabID)
	}
}

func TestTabServiceTearOff(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")

	svc.TearOff("tab-1")

	// TearOff is an alias for Detach, so same verification
	list := th.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 tab after tear off, got %d", len(list))
	}
}

func TestTabServiceSetDirty(t *testing.T) {
	svc := newTestTabService(t)
	th := svc.th

	id := th.AddTab(host.TabKindDocs, "Doc1", "")
	svc.SetDirty(id, true)

	dirty := svc.GetDirtyTabs()
	if len(dirty) != 1 || dirty[0].ID != id {
		t.Fatalf("expected only %s dirty, got %+v", id, dirty)
	}
	if list := svc.List(); !list[1].Dirty {
		t.Fatal("tab list should carry the dirty flag")
	}

	svc.SetDirty(id, false)
	if dirty := svc.GetDirtyTabs(); len(dirty) != 0 {
		t.Fatalf("expected an empty dirty list, got %+v", dirty)
	}
}

func TestTabServiceDockRestoresDetachedTab(t *testing.T) {
	th := host.NewTabHost()
	dh := host.NewDetachedHost()
	svc := NewTabService(th, dh)

	th.AddTab(host.TabKindDocs, "Doc1", "")
	svc.Detach("tab-1")

	name := dh.List()[0].WindowName
	svc.Dock(name)

	list := th.List()
	if len(list) != 2 {
		t.Fatalf("expected the detached tab back in the strip, got %d tabs", len(list))
	}
	if list[1].ID != "tab-1" || !list[1].Active {
		t.Fatalf("expected restored tab-1 to be active, got %+v", list[1])
	}
	if len(dh.List()) != 0 {
		t.Fatalf("expected no detached windows after dock, got %d", len(dh.List()))
	}
}

func TestTabServiceShowTabStripMenu(t *testing.T) {
	svc := newTestTabService(t)
	items := svc.ShowTabStripMenu()

	if len(items) == 0 {
		t.Fatal("expected menu items")
	}
	found := false
	for _, item := range items {
		if item.ID == "tabs-close-all" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected tabs-close-all menu item")
	}
}

func TestTabServiceShowNewMenu(t *testing.T) {
	svc := newTestTabService(t)
	items := svc.ShowNewMenu()

	if len(items) == 0 {
		t.Fatal("expected menu items")
	}
	found := false
	for _, item := range items {
		if item.ID == "new-doc" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected new-doc menu item")
	}
}

func TestTabServiceShowTabMenu(t *testing.T) {
	svc := newTestTabService(t)
	items := svc.ShowTabMenu("home")

	if len(items) == 0 {
		t.Fatal("expected menu items")
	}
	found := false
	for _, item := range items {
		if item.ID == "tab-close" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected tab-close menu item")
	}
}

func TestTabServiceShowAppMenu(t *testing.T) {
	svc := newTestTabService(t)
	items := svc.ShowAppMenu()

	if len(items) == 0 {
		t.Fatal("expected menu items")
	}
	// App menu should have File, Edit, View, Help
	if items[0].ID != "file" {
		t.Fatalf("expected first menu item to be 'file', got %s", items[0].ID)
	}
	if items[0].Label != "File" {
		t.Fatalf("expected File label, got %s", items[0].Label)
	}
}
