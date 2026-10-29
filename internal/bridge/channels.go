package bridge

// Channel names must stay byte-identical to the Electron preload shared constants
// (HOME_CHANNELS / TABS_CHANNELS) so renderer code keeps working without edits.

const (
	ChannelGetAppVersion      = "home:get-app-version"
	ChannelGetLanguage        = "home:get-language"
	ChannelSetLanguage        = "home:set-language"
	ChannelGetTheme           = "home:get-theme"
	ChannelSetTheme           = "home:set-theme"
	ChannelGetDocumentTheme   = "home:get-document-theme"
	ChannelSetDocumentTheme   = "home:set-document-theme"
	ChannelGetAutoSaveDefault = "home:get-auto-save-default"
	ChannelSetAutoSaveDefault = "home:set-auto-save-default"
	ChannelGetDefaultSaveDir  = "home:get-default-save-dir"
	ChannelPickDefaultSaveDir = "home:pick-default-save-dir"
	ChannelOpenSettings       = "home:open-settings"

	ChannelTabsList              = "tabs:list"
	ChannelTabsActivate          = "tabs:activate"
	ChannelTabsClose             = "tabs:close"
	ChannelTabsReorder           = "tabs:reorder"
	ChannelTabsChromePressed     = "tabs:chrome-pressed"
	ChannelTabsDetach            = "tabs:detach"
	ChannelTabsTearOff           = "tabs:tear-off"
	ChannelTabsDragTornWindow    = "tabs:drag-torn-window"
	ChannelTabsDockTornWindow    = "tabs:dock-torn-window"
	ChannelTabsEndTornDrag       = "tabs:end-torn-drag"
	ChannelTabsDockPreview       = "tabs:dock-preview"
	ChannelTabsDockIndex         = "tabs:dock-index"

	ChannelOpenExternal = "shell:open-external"

	EventThemeChanged           = "app:theme-changed"
	EventLanguageChanged        = "app:language-changed"
	EventDocumentThemeChanged   = "app:document-theme-changed"
	EventAutoSaveDefaultChanged = "app:auto-save-default-changed"
	EventTabsChanged            = "tabs:changed"
)
