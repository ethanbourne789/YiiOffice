// Package buildinfo exposes compile-time identity for the desktop binary.
package buildinfo

import "strconv"

// Version is overridden at link time: -X .../internal/buildinfo.Version=0.13.0.
var Version = "0.0.0-dev"

// isDevStr is overridden at link time for production builds:
//   -X .../internal/buildinfo.isDevStr=0
var isDevStr = "1"

// IsDev reports whether the binary is a development (non-production) build.
// Production builds pass -ldflags "-X .../internal/buildinfo.isDevStr=0".
func IsDev() bool {
	b, _ := strconv.ParseBool(isDevStr)
	return b
}
