package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

const (
	ChannelAppGetLanguage        = "app:get-language"
	ChannelAppGetTheme           = "app:get-theme"
	ChannelAppGetDocumentTheme   = "app:get-document-theme"
	ChannelAppGetAutoSaveDefault = "app:get-auto-save-default"
	ChannelAppChromePressed      = "app:chrome-pressed"
)

// RegisterEditorCommon wires the common app:* channels shared by all editors.
func RegisterEditorCommon(r *Router, ss *host.SettingsStore) {
	r.Handle(ChannelAppGetLanguage, func(_ context.Context, _ []json.RawMessage) (any, error) {
		snap := ss.Snapshot()
		lang := snap.Language
		if lang == "" {
			lang = "zh"
		}
		return lang, nil
	})

	r.Handle(ChannelAppGetTheme, func(_ context.Context, _ []json.RawMessage) (any, error) {
		snap := ss.Snapshot()
		theme := snap.Theme
		if theme == "" {
			theme = "system"
		}
		return theme, nil
	})

	r.Handle(ChannelAppGetDocumentTheme, func(_ context.Context, _ []json.RawMessage) (any, error) {
		snap := ss.Snapshot()
		docTheme := snap.DocumentTheme
		if docTheme == "" {
			docTheme = "white"
		}
		return docTheme, nil
	})

	r.Handle(ChannelAppGetAutoSaveDefault, func(_ context.Context, _ []json.RawMessage) (any, error) {
		snap := ss.Snapshot()
		return snap.AutoSaveDefault, nil
	})

	r.Handle(ChannelAppChromePressed, func(_ context.Context, _ []json.RawMessage) (any, error) {
		platform.Emit(ChannelTabsChromePressed, nil)
		return nil, nil
	})
}
