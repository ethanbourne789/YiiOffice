package servmode

import (
	"net"
	"strings"
)

// IsLoopbackHost reports whether a server-mode bind address only accepts
// connections from the local machine. An empty host means the compiled-in
// default (loopback) and counts as loopback. "localhost" and any IP the
// stack classifies as loopback (127.0.0.0/8, ::1) are accepted; everything
// else — notably 0.0.0.0 and :: — is not.
func IsLoopbackHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" || h == "localhost" {
		return true
	}
	// "[::1]" bracket form used in URLs; the listener also accepts it.
	h = strings.TrimSuffix(strings.TrimPrefix(h, "["), "]")
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}
