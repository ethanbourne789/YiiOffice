//go:build windows

package platform

import (
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

// CloseDecision is the user's answer to the "unsaved changes" prompt.
type CloseDecision int

const (
	// CloseSave persists the dirty documents first, then retries the close.
	CloseSave CloseDecision = iota
	// CloseDiscard drops the edits and closes immediately.
	CloseDiscard
	// CloseCancel leaves the window open.
	CloseCancel
)

// ConfirmCloseWithSave asks what to do about documents with unsaved changes.
//
// It uses a plain Win32 message box because the close guard runs on the UI
// thread, where a Wails dialog would have to re-enter the message loop. Three
// buttons (Yes / No / Cancel) are required: the older two-button box could only
// offer discard-or-cancel, which made host.CloseGuard's Save branch unreachable
// and silently took "save everything before quitting" off the table.
//
// Yes is the default button — No is the destructive choice, so it must not be
// what a stray Enter picks.
func ConfirmCloseWithSave(titles []string) CloseDecision {
	if len(titles) == 0 {
		return CloseDiscard
	}
	var message string
	if len(titles) == 1 {
		message = fmt.Sprintf("%q has unsaved changes.\n\nSave it before closing YiiOffice?", titles[0])
	} else {
		message = fmt.Sprintf("%d documents have unsaved changes:\n\n%s\n\nSave them before closing YiiOffice?",
			len(titles), "- "+strings.Join(titles, "\n- "))
	}
	result := w32.MessageBox(0, "Unsaved changes", message,
		w32.MB_YESNOCANCEL|w32.MB_ICONWARNING|w32.MB_DEFBUTTON1)
	switch result {
	case w32.IDYES:
		return CloseSave
	case w32.IDNO:
		return CloseDiscard
	default:
		return CloseCancel
	}
}
