package bridge

import (
	"fmt"
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
		raw := ctx.DroppedFiles()
		paths := FilterDroppedPaths(raw)
		if legacy := legacyDroppedPaths(raw); len(legacy) > 0 {
			// Legacy binary formats cannot be opened at all. Tell the user now
			// instead of opening a tab that instantly fails.
			_ = platform.ShowNotification("YiiOffice", legacyDropNotice(legacy, platform.SystemLocale()))
		}
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
	return collectDroppedPaths(paths, func(clean string) bool {
		_, ok := host.RouteByExt(clean)
		return ok
	})
}

// legacyDroppedPaths keeps existing legacy 97-2003 Office files. They are not
// openable, but the drop handler names them in a notice instead of dropping
// them silently.
func legacyDroppedPaths(paths []string) []string {
	return collectDroppedPaths(paths, func(clean string) bool {
		_, ok := host.LegacyOfficeReplacement(clean)
		return ok
	})
}

func collectDroppedPaths(paths []string, keep func(string) bool) []string {
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		clean := filepath.Clean(strings.TrimSpace(raw))
		if clean == "." || clean == "" {
			continue
		}
		if !keep(clean) {
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
		out = append(out, clean)
	}
	return out
}

// legacyDropNotice builds the short, locale-aware message shown when legacy
// binary files are dropped. It names at most three files and counts the rest.
func legacyDropNotice(paths []string, locale string) string {
	names := make([]string, 0, 3)
	for i, path := range paths {
		if i == 3 {
			break
		}
		names = append(names, filepath.Base(path))
	}
	quoted := "\"" + strings.Join(names, "\", \"") + "\""
	extra := ""
	if len(paths) > 3 {
		if locale == "zh" {
			extra = fmt.Sprintf("（另有 %d 个）", len(paths)-3)
		} else {
			extra = fmt.Sprintf(" (+%d more)", len(paths)-3)
		}
	}
	if locale == "zh" {
		return fmt.Sprintf("旧版格式暂不支持：%s%s。请先另存为 .docx / .xlsx / .pptx，再打开。", quoted, extra)
	}
	return fmt.Sprintf("Legacy formats are not supported: %s%s. Save them as .docx / .xlsx / .pptx first.", quoted, extra)
}
