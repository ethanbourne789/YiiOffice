//go:build !windows

package platform

// SystemLocale returns the language the editors should start in ("zh" or "en").
// The desktop app targets Windows; this build exists so the services and their
// tests compile elsewhere (and so `go test ./...` works on a non-Windows host).
func SystemLocale() string { return localeFromEnv() }
