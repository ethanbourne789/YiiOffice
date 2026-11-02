//go:build !server

// Package servmode reports whether the binary was built in Wails server mode
// (`-tags server`). See servmode_server.go for the server build.
package servmode

// Enabled is false in desktop builds.
const Enabled = false
