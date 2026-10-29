package bridge

import (
	"context"
	"encoding/json"
)

// RegisterDialogs wires the dialog-related home channels.
func RegisterDialogs(r *Router, openFileFunc func() ([]string, error), revealPathFunc func(string) error) {
	r.Handle(ChannelBrowse, func(_ context.Context, _ []json.RawMessage) (any, error) {
		results, err := openFileFunc()
		if err != nil {
			return nil, err
		}
		return results, nil
	})

	r.Handle(ChannelRevealPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, revealPathFunc(path)
	})

	r.Handle(ChannelPickDefaultSaveDir, func(context.Context, []json.RawMessage) (any, error) {
		// Stub: folder picker dialog not yet implemented.
		return nil, nil
	})
}
