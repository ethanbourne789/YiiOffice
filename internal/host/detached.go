// Package host implements desktop services independent of any UI framework.

package host

import (
	"fmt"
	"sync"
)

// DetachedWindow tracks a tab torn off into its own window.
type DetachedWindow struct {
	WindowName string
	TabID      string
	TabKind    TabKind
	TabTitle   string
}

// DetachedHost manages torn-off windows.
type DetachedHost struct {
	mu         sync.Mutex
	detachNext int
	windows    map[string]*DetachedWindow
}

// NewDetachedHost creates an empty detached host.
func NewDetachedHost() *DetachedHost {
	return &DetachedHost{windows: make(map[string]*DetachedWindow)}
}

// Detach creates a detached window entry. Returns the Wails window name.
func (d *DetachedHost) Detach(tabID string, kind TabKind, title string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.detachNext++
	name := fmt.Sprintf("detached-%d", d.detachNext)
	d.windows[name] = &DetachedWindow{WindowName: name, TabID: tabID, TabKind: kind, TabTitle: title}
	return name
}

// Dock removes a detached window and returns the original tab ID.
func (d *DetachedHost) Dock(windowName string) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	w, ok := d.windows[windowName]
	if !ok {
		return "", false
	}
	delete(d.windows, windowName)
	return w.TabID, true
}

// Get returns a detached window by its Wails name, or nil.
func (d *DetachedHost) Get(windowName string) (*DetachedWindow, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	w, ok := d.windows[windowName]
	return w, ok
}

// List returns all detached windows.
func (d *DetachedHost) List() []*DetachedWindow {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]*DetachedWindow, 0, len(d.windows))
	for _, w := range d.windows {
		out = append(out, w)
	}
	return out
}
