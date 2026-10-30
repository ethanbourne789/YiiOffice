//go:build windows

package platform

import (
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

// ConfirmDiscardChanges asks the user whether the app may quit while
// documents still have unsaved changes. It uses a plain Win32 message box
// because the close guard runs on the UI thread, where Wails dialogs would
// have to re-enter the message loop.
func ConfirmDiscardChanges(titles []string) bool {
	if len(titles) == 0 {
		return true
	}
	var message string
	if len(titles) == 1 {
		message = fmt.Sprintf("%q has unsaved changes.\n\nClose YiiOffice and discard them?", titles[0])
	} else {
		message = fmt.Sprintf("%d documents have unsaved changes:\n\n%s\n\nClose YiiOffice and discard them?",
			len(titles), "- "+strings.Join(titles, "\n- "))
	}
	result := w32.MessageBox(0, "Unsaved changes", message,
		w32.MB_YESNO|w32.MB_ICONWARNING|w32.MB_DEFBUTTON2)
	return result == w32.IDYES
}
