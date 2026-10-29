package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

// RegisterRecent wires the recent/starred file channels.
func RegisterRecent(r *Router, rm *host.RecentManager) {
	r.Handle(ChannelRecents, func(_ context.Context, args []json.RawMessage) (any, error) {
		offset, _ := DecodeArg[int](args, 0)
		limit, _ := DecodeArg[int](args, 1)
		if limit == 0 {
			limit = 50
		}
		return rm.GetRecents(offset, limit), nil
	})

	r.Handle(ChannelStarred, func(context.Context, []json.RawMessage) (any, error) {
		return rm.GetStarred(), nil
	})

	r.Handle(ChannelStarredGroups, func(context.Context, []json.RawMessage) (any, error) {
		return rm.GetStarredGroups(), nil
	})

	r.Handle(ChannelSetStarredGroup, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		group, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		rm.SetStarredGroup(path, group)
		return nil, nil
	})

	r.Handle(ChannelToggleStar, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		starred := rm.ToggleStar(path)
		return starred, nil
	})

	r.Handle(ChannelUnstarPaths, func(_ context.Context, args []json.RawMessage) (any, error) {
		paths, err := DecodeArg[[]string](args, 0)
		if err != nil {
			return nil, err
		}
		rm.UnstarPaths(paths)
		return nil, nil
	})

	r.Handle(ChannelStatPaths, func(_ context.Context, args []json.RawMessage) (any, error) {
		paths, err := DecodeArg[[]string](args, 0)
		if err != nil {
			return nil, err
		}
		return rm.StatPaths(paths), nil
	})

	r.Handle(ChannelRemoveRecent, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		rm.RemoveRecent(path)
		return nil, nil
	})
}
