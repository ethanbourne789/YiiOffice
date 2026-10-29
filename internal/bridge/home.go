package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterHome wires the home:* channels for app settings management.
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

	r.Handle(ChannelGetDocumentTheme, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().DocumentTheme, nil
	})

	r.Handle(ChannelSetDocumentTheme, func(_ context.Context, args []json.RawMessage) (any, error) {
		theme, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetDocumentTheme(theme); err != nil {
			return nil, err
		}
		platform.Emit(EventDocumentThemeChanged, theme)
		return nil, nil
	})

	r.Handle(ChannelGetAutoSaveDefault, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().AutoSaveDefault, nil
	})

	r.Handle(ChannelSetAutoSaveDefault, func(_ context.Context, args []json.RawMessage) (any, error) {
		val, err := DecodeArg[bool](args, 0)
		if err != nil {
			return nil, err
		}
		if err := store.SetAutoSaveDefault(val); err != nil {
			return nil, err
		}
		platform.Emit(EventAutoSaveDefaultChanged, val)
		return nil, nil
	})

	r.Handle(ChannelGetDefaultSaveDir, func(context.Context, []json.RawMessage) (any, error) {
		return store.Snapshot().DefaultSaveDir, nil
	})

	r.Handle(ChannelOpenSettings, func(context.Context, []json.RawMessage) (any, error) {
		platform.Emit("app:open-settings")
		return nil, nil
	})
}
