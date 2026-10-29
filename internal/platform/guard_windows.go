//go:build windows

package platform

import (
	"fmt"
	"runtime"
)

// RequireWindows aborts startup on unsupported platforms. Windows is the only supported target.
func RequireWindows() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("YiiOffice supports Windows only; got %s", runtime.GOOS)
	}
	return nil
}
