// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import "github.com/wailsapp/wails/v3/pkg/application"

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
