package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterTabs wires the tabs:* channels with a real tab host.
func RegisterTabs(r *Router, th *host.TabHost) {
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
}
