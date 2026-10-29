//go:build windows

package platform

import (
	"testing"
)

func TestWebView2InstallURL(t *testing.T) {
	url := WebView2InstallURL()
	if url == "" {
		t.Error("expected non-empty WebView2 install URL")
	}
}
