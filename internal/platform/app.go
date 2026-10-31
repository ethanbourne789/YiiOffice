// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import (
	"log/slog"
	"os"
	"os/exec"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var current *application.App

// defaultLogger is used before the application exists (during startup, in unit
// tests) and whenever the Wails logger is unavailable. It mirrors the Wails
// text handler so logs look consistent across the whole lifecycle.
var defaultLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
	Level: slog.LevelInfo,
}))

// Set stores the application handle. Called once from main.
func Set(app *application.App) { current = app }

// App returns the live application handle, or nil before Set.
func App() *application.App { return current }

// Logger returns the application's structured logger, falling back to a
// stderr text logger when the application has not been created yet (startup
// path and unit tests). Callers should treat the result as a *slog.Logger
// everywhere; this keeps logging structured regardless of lifecycle stage.
func Logger() *slog.Logger {
	if current != nil && current.Logger != nil {
		return current.Logger
	}
	return defaultLogger
}

// RunOnMain dispatches fn on the UI thread. Falls back to direct call in tests.
func RunOnMain(fn func()) {
	if current == nil {
		fn()
		return
	}
	application.InvokeAsync(fn)
}

// Emit sends a named event to all frontends. No-op in unit tests.
func Emit(name string, data ...any) {
	if current == nil {
		return
	}
	current.Event.Emit(name, data...)
}

// OpenExternal opens a URL in the user's default browser.
func OpenExternal(rawURL string) error {
	if current == nil {
		return nil
	}
	return current.Browser.OpenURL(rawURL)
}

// NewWindow creates a new webview window.
func NewWindow(opts application.WebviewWindowOptions) {
	if current == nil {
		return
	}
	current.Window.NewWithOptions(opts)
}

// NewDetachedWindow opens the window that hosts a torn-off tab.
func NewDetachedWindow(name, title, url string, width, height int) {
	if current == nil {
		return
	}
	current.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   name,
		Title:  title,
		URL:    url,
		Width:  width,
		Height: height,
	})
}

// ClipboardText returns the current clipboard text, or ("", false) when
// unavailable.
func ClipboardText() (string, bool) {
	if current != nil {
		return current.Clipboard.Text()
	}
	return "", false
}

// ClipboardSetText writes text to the system clipboard.
func ClipboardSetText(text string) bool {
	if current != nil {
		return current.Clipboard.SetText(text)
	}
	return false
}

// CurrentWindow returns the window that issued the current frontend call.
// When the platform cannot report the focused window it falls back to the
// oldest window — the shell, which is always created first — so the caption
// controls never turn into silent no-ops.
func CurrentWindow() application.Window {
	if current == nil {
		return nil
	}
	if w := current.Window.Current(); w != nil {
		return w
	}
	var oldest application.Window
	for _, w := range current.Window.GetAll() {
		if oldest == nil || w.ID() < oldest.ID() {
			oldest = w
		}
	}
	return oldest
}

// CloseWindow closes the window by name.
func CloseWindow(name string) {
	if current == nil {
		return
	}
	if w, ok := current.Window.GetByName(name); ok {
		w.Close()
	}
}

// RevealPath opens the file explorer at the given path (Windows).
func RevealPath(path string) error {
	if path == "" {
		return nil
	}
	return exec.Command("explorer", "/select,"+path).Start()
}

// OnEvent registers a listener for a custom event on the Go side.
// Returns an unsubscribe function. No-op in unit tests.
func OnEvent(name string, handler func(event *application.CustomEvent)) (unsubscribe func()) {
	if current == nil {
		return func() {}
	}
	return current.Event.On(name, handler)
}

// EnvInfo returns the runtime environment information (OS, arch, debug mode,
// display scale, dark mode, etc.), or (zero-value, false) before the application
// exists.
func EnvInfo() (application.EnvironmentInfo, bool) {
	if current == nil {
		return application.EnvironmentInfo{}, false
	}
	return current.Env.Info(), true
}
