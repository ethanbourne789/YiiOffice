//go:build server

// Package servmode reports whether the binary was built in Wails server mode
// (`-tags server`). Server mode runs the same services over HTTP with no native
// window, so desktop-only startup steps (WebView2 probe, tray icon, dialogs)
// must be skipped: Wails stubs those APIs to no-ops there, and the WebView2
// preflight would otherwise abort a headless test host on a machine without it.
package servmode

// Enabled is true in server builds.
const Enabled = true
