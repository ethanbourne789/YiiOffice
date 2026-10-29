// Package buildinfo exposes compile-time identity for the desktop binary.
package buildinfo

// Version is overridden at link time: -X .../internal/buildinfo.Version=0.13.0.
var Version = "0.0.0-dev"
