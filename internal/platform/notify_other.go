//go:build !windows

package platform

// ShowNotification is a no-op off Windows; the desktop app targets Windows and
// this build exists so the services and their tests compile elsewhere.
func ShowNotification(_, _ string) error { return nil }
