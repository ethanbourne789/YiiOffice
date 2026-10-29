package bridge

import (
	"gitee.com/ethanbourne789/yiioffice/internal/update"
)

// RegisterUpdate wires the home:check-for-updates and home:download-update channels.
func RegisterUpdate(r *Router, ub *update.Bridge) {
	r.Handle(ChannelCheckForUpdates, ub.CheckForUpdatesHandler)
	r.Handle(ChannelDownloadUpdate, ub.DownloadUpdateHandler)
}
