// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import (
	"os/exec"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var current *application.App

// Set stores the application handle. Called once from main.
func Set(app *application.App) { current = app }

// App returns the live application handle, or nil before Set.
func App() *application.App { return current }

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
