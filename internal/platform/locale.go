package platform

import (
	"os"
	"strings"
)

// normalizeLocale maps a locale tag ("zh-CN", "en_US.UTF-8", "zh-Hans") to one
// of the two languages the editors' own UI localisation ships. Anything that is
// not Chinese is treated as English.
func normalizeLocale(tag string) string {
	tag = strings.TrimSpace(tag)
	// Drop the charset/modifier suffix: "en_US.UTF-8" -> "en_US".
	if i := strings.IndexAny(tag, ".@"); i >= 0 {
		tag = tag[:i]
	}
	// POSIX uses "zh_CN", BCP 47 uses "zh-CN"; only the primary subtag matters.
	if i := strings.IndexAny(tag, "_-"); i >= 0 {
		tag = tag[:i]
	}
	if strings.EqualFold(tag, "zh") {
		return "zh"
	}
	return "en"
}

// localeFromEnv reads a POSIX locale, defaulting to the product's first
// language when the environment says nothing.
func localeFromEnv() string {
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(key); v != "" {
			return normalizeLocale(v)
		}
	}
	return "zh"
}
