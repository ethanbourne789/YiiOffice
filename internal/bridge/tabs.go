package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterTabs wires the tabs:* channels with a real tab host and detached host.
func RegisterTabs(r *Router, th *host.TabHost, dh *host.DetachedHost) {
	r.Handle(ChannelTabsList, func(context.Context, []json.RawMessage) (any, error) {
		return th.List(), nil
	})
	r.Handle(ChannelTabsActivate, func(_ context.Context, args []json.RawMessage) (any, error) {
		id, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		th.Activate(id)
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})
	r.Handle(ChannelTabsClose, func(_ context.Context, args []json.RawMessage) (any, error) {
		id, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		th.CloseTab(id)
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})
	r.Handle(ChannelTabsReorder, func(_ context.Context, args []json.RawMessage) (any, error) {
		from, err := DecodeArg[int](args, 0)
		if err != nil {
			return nil, err
		}
		to, err := DecodeArg[int](args, 1)
		if err != nil {
			return nil, err
		}
		th.Reorder(from, to)
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})
	r.Handle(ChannelTabsChromePressed, func(context.Context, []json.RawMessage) (any, error) {
		platform.Emit("app:chrome-pressed")
		return nil, nil
	})

	// --- Detached window channels ---

	r.Handle(ChannelTabsDetach, func(_ context.Context, args []json.RawMessage) (any, error) {
		id, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		tab := th.GetByID(id)
		if tab != nil {
			dh.Detach(id, tab.Kind, tab.Title)
		}
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})

	r.Handle(ChannelTabsTearOff, func(_ context.Context, args []json.RawMessage) (any, error) {
		id, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		tab := th.GetByID(id)
		if tab != nil {
			dh.Detach(id, tab.Kind, tab.Title)
		}
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})

	r.Handle(ChannelTabsDragTornWindow, func(context.Context, []json.RawMessage) (any, error) {
		// No-op stub: the frontend handles drag visuals.
		return nil, nil
	})

	r.Handle(ChannelTabsDockTornWindow, func(_ context.Context, args []json.RawMessage) (any, error) {
		windowName, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		if tabID, ok := dh.Dock(windowName); ok {
			_ = tabID // Re-add to tab host in a future phase.
		}
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})

	r.Handle(ChannelTabsEndTornDrag, func(context.Context, []json.RawMessage) (any, error) {
		// No-op stub: the frontend handles drag state cleanup.
		return nil, nil
	})

	r.Handle(ChannelTabsDockPreview, func(_ context.Context, args []json.RawMessage) (any, error) {
		index, err := DecodeArg[int](args, 0)
		if err != nil {
			return nil, err
		}
		// Return the index so the frontend can render the drop indicator.
		return map[string]any{"index": index}, nil
	})

	r.Handle(ChannelTabsDockIndex, func(_ context.Context, args []json.RawMessage) (any, error) {
		index, err := DecodeArg[int](args, 0)
		if err != nil {
			return nil, err
		}
		return map[string]any{"index": index}, nil
	})
}
