//go:build windows

package platform

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// SetCurrentProcessExplicitAppUserModelID is exported by shell32.dll and not
// wrapped by x/sys/windows, so it is called through the lazy procedure.
var procSetCurrentProcessExplicitAppUserModelID = windows.NewLazySystemDLL("shell32.dll").NewProc("SetCurrentProcessExplicitAppUserModelID")

// ApplyAppUserModelID pins the process to AppUserModelID before the first
// window appears. Without it the taskbar derives the identity from the exe
// path, so an app launched from a different location (D:\YiiOffice vs a local
// build) splits into separate taskbar groups.
//
// The HRESULT is advisory: on failure Windows falls back to the previous
// path-derived grouping, so startup is never blocked.
func ApplyAppUserModelID() {
	id, err := windows.UTF16PtrFromString(AppUserModelID)
	if err != nil {
		return
	}
	_, _, _ = procSetCurrentProcessExplicitAppUserModelID.Call(uintptr(unsafe.Pointer(id)))
}
