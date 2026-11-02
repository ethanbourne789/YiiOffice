package platform

import "testing"

func TestNormalizeLocale(t *testing.T) {
	cases := map[string]string{
		"zh":          "zh",
		"zh-CN":       "zh",
		"zh_CN":       "zh",
		"zh-Hans":     "zh",
		"zh-TW.UTF-8": "zh",
		"en":          "en",
		"en_US.UTF-8": "en",
		"de-DE":       "en",
		"":            "en",
	}
	for tag, want := range cases {
		if got := normalizeLocale(tag); got != want {
			t.Errorf("normalizeLocale(%q) = %q, want %q", tag, got, want)
		}
	}
}

func TestSystemLocaleIsOneOfTheSupportedLanguages(t *testing.T) {
	if got := SystemLocale(); got != "zh" && got != "en" {
		t.Fatalf("SystemLocale() = %q, want zh or en", got)
	}
}
