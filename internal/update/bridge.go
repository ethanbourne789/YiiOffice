package update

import (
	"context"
	"encoding/json"
	"fmt"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// Bridge provides IPC-compatible handlers for update operations.
type Bridge struct {
	updater *Updater
}

// NewBridge creates an update Bridge.
func NewBridge(updater *Updater) *Bridge {
	return &Bridge{updater: updater}
}

// GetUpdater returns the underlying updater.
func (b *Bridge) GetUpdater() *Updater {
	return b.updater
}

// CheckForUpdatesHandler is the IPC handler for checking updates.
func (b *Bridge) CheckForUpdatesHandler(ctx context.Context, _ []json.RawMessage) (any, error) {
	info, err := b.updater.CheckForUpdates(ctx)
	if err != nil {
		return nil, fmt.Errorf("update check failed: %w", err)
	}
	return info, nil
}

// DownloadUpdateHandler is the IPC handler for downloading and installing.
func (b *Bridge) DownloadUpdateHandler(_ context.Context, args []json.RawMessage) (any, error) {
	// Parse download URL argument
	url, err := decodeArgString(args, 0)
	if err != nil {
		return nil, err
	}

	// Run download in background goroutine
	go func() {
		ctx := context.Background()
		if downloadErr := b.updater.DownloadAndInstall(ctx, url); downloadErr != nil {
			platform.Emit("app:update-error", downloadErr.Error())
		}
	}()

	return nil, nil
}

func decodeArgString(args []json.RawMessage, index int) (string, error) {
	if index >= len(args) {
		return "", fmt.Errorf("missing argument at index %d", index)
	}
	var s string
	return s, json.Unmarshal(args[index], &s)
}
