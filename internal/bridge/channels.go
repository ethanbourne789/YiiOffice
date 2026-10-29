package bridge

// Channel names must stay byte-identical to the Electron preload shared constants
// (HOME_CHANNELS / TABS_CHANNELS) so renderer code keeps working without edits.

const (
	ChannelGetAppVersion = "home:get-app-version"
	ChannelGetLanguage   = "home:get-language"
	ChannelSetLanguage   = "home:set-language"
	ChannelGetTheme      = "home:get-theme"
	ChannelSetTheme      = "home:set-theme"

	ChannelTabsList     = "tabs:list"
	ChannelTabsActivate = "tabs:activate"

	ChannelOpenExternal = "shell:open-external"

	EventThemeChanged    = "app:theme-changed"
	EventLanguageChanged = "app:language-changed"
)
