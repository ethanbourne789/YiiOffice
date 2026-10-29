package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterHome wires the Phase 1 subset of home:* channels.
func RegisterHome(r *Router, store *host.SettingsStore, version string) {
	r.Handle(ChannelGetAppVersion, func(context.Context, []json.RawMessage) (any, error) {
		return version, nil
	})

	r.Handle(ChannelGetTheme, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().Theme, nil
	})

	r.Handle(ChannelSetTheme, func(_ context.Context, args []json.RawMessage) (any, error) {
		theme, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetTheme(theme); err != nil {
			return nil, err
		}
		platform.Emit(EventThemeChanged, theme)
		return nil, nil
	})

	r.Handle(ChannelGetLanguage, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().Language, nil
	})

	r.Handle(ChannelSetLanguage, func(_ context.Context, args []json.RawMessage) (any, error) {
		lang, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetLanguage(lang); err != nil {
			return nil, err
		}
		platform.Emit(EventLanguageChanged, lang)
		return nil, nil
	})
}
