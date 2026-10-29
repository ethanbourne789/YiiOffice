package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// RegisterFileOps wires file routing and operation channels.
func RegisterFileOps(r *Router, th *host.TabHost, fo *host.FileOps, rm *host.RecentManager) {
	newDocHandler := func(kind host.TabKind, title string) {
		th.AddTab(kind, title, "")
		platform.Emit(EventTabsChanged, th.List())
	}

	r.Handle(ChannelNewDoc, func(context.Context, []json.RawMessage) (any, error) {
		newDocHandler(host.TabKindDocs, "Untitled Document")
		return nil, nil
	})
	r.Handle(ChannelNewSheet, func(context.Context, []json.RawMessage) (any, error) {
		newDocHandler(host.TabKindSheets, "Untitled Spreadsheet")
		return nil, nil
	})
	r.Handle(ChannelNewSlide, func(context.Context, []json.RawMessage) (any, error) {
		newDocHandler(host.TabKindSlides, "Untitled Presentation")
		return nil, nil
	})
	r.Handle(ChannelNewMarkdown, func(context.Context, []json.RawMessage) (any, error) {
		newDocHandler(host.TabKindMarkdown, "Untitled Markdown")
		return nil, nil
	})
	r.Handle(ChannelNewPdf, func(context.Context, []json.RawMessage) (any, error) {
		newDocHandler(host.TabKindPDF, "Untitled PDF")
		return nil, nil
	})

	r.Handle(ChannelOpenPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		kind, ok := host.RouteByExt(path)
		if !ok {
			return nil, fmt.Errorf("unsupported file type: %s", path)
		}
		th.AddTab(kind, filepath.Base(path), path)
		if rm != nil {
			rm.AddRecent(path)
		}
		platform.Emit(EventTabsChanged, th.List())
		return nil, nil
	})

	r.Handle(ChannelRenameFile, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		newName, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		newPath, err := fo.Rename(path, newName)
		if err != nil {
			return nil, err
		}
		return newPath, nil
	})

	r.Handle(ChannelDuplicateFile, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		newPath, err := fo.Duplicate(path)
		if err != nil {
			return nil, err
		}
		return newPath, nil
	})

	r.Handle(ChannelDeleteFiles, func(_ context.Context, args []json.RawMessage) (any, error) {
		paths, err := DecodeArg[[]string](args, 0)
		if err != nil {
			return nil, err
		}
		failed := fo.Delete(paths)
		return failed, nil
	})

	r.Handle(ChannelOpenTrash, func(context.Context, []json.RawMessage) (any, error) {
		platform.OpenExternal("shell:RecycleBin")
		return nil, nil
	})
}
