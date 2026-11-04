package bridge

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// EventFilesDropped carries OS file drops from Go to the shell renderer. The
// name matches what the Wails runtime uses natively; Wails only raises it on
// the Go side, so we forward it to the frontend ourselves.
const EventFilesDropped = "common:WindowFilesDropped"

// InstallFileDropBridge forwards native file drops for win to the renderer.
//
// Wails resolves the absolute paths on the Go side (webview_window_windows.go)
// and never hands them to JS, so the frontend cannot do this itself. The
// renderer owns tab routing; this only filters out paths that cannot be opened
// and emits the survivors.
func InstallFileDropBridge(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		ctx := event.Context()
		if ctx == nil {
			return
		}
		paths := FilterDroppedPaths(ctx.DroppedFiles())
		if len(paths) == 0 {
			return
		}
		x, y := 0, 0
		if details := ctx.DropTargetDetails(); details != nil {
			x, y = details.X, details.Y
		}
		platform.Emit(EventFilesDropped, map[string]any{
			"filenames": paths,
			"x":         x,
			"y":         y,
		})
	})
}

// FilterDroppedPaths keeps the dropped paths that the shell can actually open:
// supported extensions, existing files (not directories), first occurrence only
// when the same path is dropped more than once (Windows paths compare
// case-insensitively).
func FilterDroppedPaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	openable := make([]string, 0, len(paths))
	for _, raw := range paths {
		clean := filepath.Clean(strings.TrimSpace(raw))
		if clean == "." || clean == "" {
			continue
		}
		if _, ok := host.RouteByExt(clean); !ok {
			continue
		}
		info, err := os.Stat(clean)
		if err != nil || info.IsDir() {
			continue
		}
		key := strings.ToLower(clean)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		openable = append(openable, clean)
	}
	return openable
}
