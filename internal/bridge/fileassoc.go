package bridge

import (
	"context"
	"encoding/json"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterFileAssoc wires file association channels.
func RegisterFileAssoc(r *Router, dam *host.DefaultAppManager) {
	r.Handle(ChannelGetDefaultAppStatus, func(context.Context, []json.RawMessage) (any, error) {
		return dam.GetDefaultAppStatus(), nil
	})

	r.Handle(ChannelSetDefaultApp, func(context.Context, []json.RawMessage) (any, error) {
		uri := dam.SetDefaultApp()
		platform.OpenExternal(uri)
		return nil, nil
	})
}
