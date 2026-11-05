package workbook

import "log/slog"

// logger is the sink for engine-level diagnostics. It defaults to the standard
// logger and is swapped by the caller at startup via SetLoggerProvider.
//
// The indirection is a build constraint, not a design preference: importing
// internal/platform would drag wails' GUI layer into this package, and with it
// cgo dependencies on gtk4/webkitgtk. `go test -race ./internal/workbook/`
// runs on the Linux CI runner, where those libraries are not installed, so
// this package has to stay pure Go. Keep it that way — if you need a helper
// from internal/platform here, take a function value instead of an import.
var logger = func() *slog.Logger { return slog.Default() }

// SetLoggerProvider installs the logger the engine reports through. Passing
// nil restores the default.
func SetLoggerProvider(fn func() *slog.Logger) {
	if fn == nil {
		logger = func() *slog.Logger { return slog.Default() }
		return
	}
	logger = fn
}
