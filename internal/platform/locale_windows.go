//go:build windows

package platform

import "golang.org/x/sys/windows"

// GetUserDefaultUILanguage is not wrapped by x/sys/windows; calling it through
// kernel32 keeps the dependency set unchanged.
var procGetUserDefaultUILanguage = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage")

// SystemLocale returns the language the editors should start in ("zh" or "en"),
// derived from the user's Windows UI language.
//
// Reading LANG/LC_ALL — what a recent refactor reduced this to — is a Unix
// habit: Windows does not set them, so every Chinese Windows install came up in
// English. The environment is now only a fallback for when the API is
// unavailable.
func SystemLocale() string {
	if id, _, _ := procGetUserDefaultUILanguage.Call(); id != 0 {
		// A LANGID's primary language is its low byte; 0x04 is Chinese
		// (Simplified and Traditional share it).
		if uint16(id)&0xFF == 0x04 {
			return "zh"
		}
		return "en"
	}
	return localeFromEnv()
}
