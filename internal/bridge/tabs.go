package bridge

import (
	"context"
	"encoding/json"
)

// RegisterTabs wires the Phase 1 subset of tabs:* channels.
func RegisterTabs(r *Router) {
	r.Handle(ChannelTabsList, func(context.Context, []json.RawMessage) (any, error) {
		return []any{}, nil
	})
	r.Handle(ChannelTabsActivate, func(_ context.Context, args []json.RawMessage) (any, error) {
		if _, err := DecodeArg[string](args, 0); err != nil {
			return nil, err
		}
		return nil, nil
	})
}
