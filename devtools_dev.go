//go:build windows && !production

package main

// devToolsEnabled mirrors Wails' own DevTools switch: the same `production`
// build tag that `task build` passes also compiles WebView2's
// `PutAreDevToolsEnabled(true)` variant. Non-production builds are the ones
// developers drive, so DevTools stay available there.
const devToolsEnabled = true
