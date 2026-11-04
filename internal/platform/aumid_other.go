//go:build !windows

package platform

// ApplyAppUserModelID is a no-op off Windows; the desktop app targets Windows
// and this build exists so the services and their tests compile elsewhere.
func ApplyAppUserModelID() {}
