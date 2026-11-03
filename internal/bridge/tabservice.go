package bridge

import (
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// TabService exposes tab-management operations to the shell as an official
// Wails V3 named binding service. It is the sole owner of the former Electron
// tabs:* channel surface: list/activate/close/detach/tear-off/reorder, the
// native menu handlers and the dirty-tab bridge all live here, consumed
// through the generated bindings and packages/wails-bridge/tabs-bridge.ts.
// Keyboard/view-only stubs the frontend never invokes are intentionally
// omitted — no legacy Router remains to serve them.
type TabService struct {
	th *host.TabHost
	dh *host.DetachedHost
	mb *host.MenuBuilder
}

// NewTabService returns a TabService bound to the given tab and detached hosts.
func NewTabService(th *host.TabHost, dh *host.DetachedHost) *TabService {
	return &TabService{th: th, dh: dh, mb: host.NewMenuBuilder(th)}
}

// List returns summaries of all open tabs.
func (s *TabService) List() []host.TabSummary {
	return s.th.List()
}

// Activate makes the tab with the given id active and broadcasts the new list.
func (s *TabService) Activate(id string) {
	s.th.Activate(id)
	platform.Emit(EventTabsChanged, s.th.List())
}

// Close removes the tab with the given id (Home cannot be closed) and broadcasts.
func (s *TabService) Close(id string) {
	s.th.CloseTab(id)
	platform.Emit(EventTabsChanged, s.th.List())
}

// Reorder moves a tab from `from` to `to` and broadcasts the new list.
func (s *TabService) Reorder(from int, to int) {
	s.th.Reorder(from, to)
	platform.Emit(EventTabsChanged, s.th.List())
}

// SetDirty records the unsaved-changes state of a tab. The close guard reads
// this list before letting the window go.
func (s *TabService) SetDirty(id string, dirty bool) {
	if !s.th.SetDirty(id, dirty) {
		return
	}
	platform.Emit(EventTabsChanged, s.th.List())
}

// GetDirtyTabs returns the tabs with unsaved changes.
func (s *TabService) GetDirtyTabs() []host.TabSummary {
	return s.th.DirtyTabs()
}

// Detach tears a tab out into its own window: the tab leaves the strip, a real
// window opens on the tab's document, and the shell receives the new list.
func (s *TabService) Detach(id string) {
	tab := s.th.GetByID(id)
	if tab == nil || tab.Kind == host.TabKindHome {
		return
	}
	name := s.dh.Detach(id, tab.Kind, tab.Title)
	url := "/" + string(tab.Kind) + "/index.html?detached=" + id
	platform.NewDetachedWindow(name, tab.Title, url, 1000, 700)
	s.th.CloseTab(id)
	platform.Emit(EventTabsChanged, s.th.List())
}

// Dock brings a detached window back: its tab returns to the strip and the
// window closes.
func (s *TabService) Dock(windowName string) {
	entry, ok := s.dh.Get(windowName)
	if !ok {
		return
	}
	s.dh.Dock(windowName)
	platform.CloseWindow(windowName)
	if s.th.GetByID(entry.TabID) == nil {
		s.th.RestoreTab(entry.TabID, entry.TabKind, entry.TabTitle, "")
	} else {
		s.th.Activate(entry.TabID)
	}
	platform.Emit(EventTabsChanged, s.th.List())
}

// TearOff detaches a tab similarly (legacy alias of Detach for the frontend).
func (s *TabService) TearOff(id string) {
	s.Detach(id)
}

// ShowTabStripMenu returns the tab strip context menu items.
func (s *TabService) ShowTabStripMenu() []host.MenuItem {
	return s.mb.BuildTabStripMenu()
}

// ShowNewMenu returns the "New" submenu items.
func (s *TabService) ShowNewMenu() []host.MenuItem {
	return s.mb.BuildNewMenu()
}

// ShowTabMenu returns the context menu for a given tab.
func (s *TabService) ShowTabMenu(id string) []host.MenuItem {
	return s.mb.BuildTabMenu(id)
}

// ShowAppMenu returns the application menu items.
func (s *TabService) ShowAppMenu() []host.MenuItem {
	return s.mb.BuildAppMenu()
}