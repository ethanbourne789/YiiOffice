package bridge

import (
	"errors"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// WindowService exposes the caption controls of the shell window.
//
// The main window is created frameless so the tab strip can double as the
// title bar (Chrome's layout), which means Windows never paints its own
// minimise / maximise / close buttons. The shell renders them itself and calls
// these bindings; keeping the operations in Go means the same code also works
// for the detached document windows.
type WindowService struct {
	// confirmClose is the unsaved-document guard (host.CloseGuard). Nil means
	// "always allow", which is what the detached windows want.
	confirmClose func() bool
}

// NewWindowService returns a WindowService that runs confirmClose before
// closing a window. Pass nil to close without prompting.
func NewWindowService(confirmClose func() bool) *WindowService {
	return &WindowService{confirmClose: confirmClose}
}

var errNoWindow = errors.New("no window is available")

// Minimise sends the window to the taskbar.
func (s *WindowService) Minimise() error {
	w := platform.CurrentWindow()
	if w == nil {
		return errNoWindow
	}
	w.Minimise()
	return nil
}

// ToggleMaximise flips the window between maximised and restored and reports
// the state it ended up in, so the shell can swap the restore/maximise glyph
// without a second round trip. On Windows a maximised frameless window is
// still resizable; Wails drops the size constraints for us.
func (s *WindowService) ToggleMaximise() (bool, error) {
	w := platform.CurrentWindow()
	if w == nil {
		return false, errNoWindow
	}
	w.ToggleMaximise()
	return w.IsMaximised(), nil
}

// IsMaximised reports whether the window is currently maximised. The shell
// asks once at startup (the main window opens maximised) and then follows the
// common:WindowMaximise / common:WindowUnMaximise events.
func (s *WindowService) IsMaximised() bool {
	w := platform.CurrentWindow()
	return w != nil && w.IsMaximised()
}

// Close closes the window after the unsaved-document guard agrees. Returning
// nil without closing means the user cancelled at the save prompt.
func (s *WindowService) Close() error {
	w := platform.CurrentWindow()
	if w == nil {
		return errNoWindow
	}
	if s.confirmClose != nil && !s.confirmClose() {
		return nil
	}
	w.Close()
	return nil
}
