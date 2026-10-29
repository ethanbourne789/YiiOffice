//go:build windows

// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

// CheckWebView2 verifies that the WebView2 runtime is installed.
// Returns nil if WebView2 is present, or an error describing the issue.
func CheckWebView2() error {
	// Check User-level install (HKCU)
	key, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
		registry.QUERY_VALUE)
	if err == nil {
		key.Close()
		return nil
	}

	// Check Machine-level install (HKLM, 32-bit view on 64-bit system)
	key, err = registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
		registry.QUERY_VALUE)
	if err == nil {
		pv, _, readErr := key.GetStringValue("pv")
		key.Close()
		if readErr == nil && pv != "" {
			return nil
		}
	}

	// Check Machine-level (64-bit view)
	key, err = registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
		registry.QUERY_VALUE)
	if err == nil {
		pv, _, readErr := key.GetStringValue("pv")
		key.Close()
		if readErr == nil && pv != "" {
			return nil
		}
	}

	return errors.New("WebView2 runtime is not installed")
}

// WebView2InstallURL returns the Microsoft Evergreen Bootstrapper download URL.
func WebView2InstallURL() string {
	return "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
}
