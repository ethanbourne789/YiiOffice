//go:build windows && production

package main

// devToolsEnabled mirrors Wails' own DevTools switch: with the `production`
// tag Wails compiles `PutAreDevToolsEnabled(false)`, which strips the inspector
// and its F12 / Ctrl+Shift+I shortcuts. Shipping builds must not expose
// WebView internals, so the option stays false here as well.
const devToolsEnabled = false
