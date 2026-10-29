package bridge

import (
	"context"
	"encoding/json"
	"fmt"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

// RegisterFolder wires folder tree channels.
func RegisterFolder(r *Router, fm *host.FolderManager) {
	r.Handle(ChannelFolderRoots, func(context.Context, []json.RawMessage) (any, error) {
		return fm.GetRoots(), nil
	})

	r.Handle(ChannelFolderRootAdd, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		label, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		fm.AddRoot(path, label)
		return nil, nil
	})

	r.Handle(ChannelFolderRootDrop, func(_ context.Context, args []json.RawMessage) (any, error) {
		paths, err := DecodeArg[[]string](args, 0)
		if err != nil {
			return nil, err
		}
		for _, p := range paths {
			fm.AddRoot(p, "")
		}
		return nil, nil
	})

	r.Handle(ChannelFolderRootRemove, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		fm.RemoveRoot(path)
		return nil, nil
	})

	r.Handle(ChannelFolderList, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		return fm.ListFolder(path)
	})

	r.Handle(ChannelFolderCreate, func(_ context.Context, args []json.RawMessage) (any, error) {
		parentPath, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		name, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		return nil, fm.CreateFolder(parentPath, name)
	})

	r.Handle(ChannelFolderRename, func(_ context.Context, args []json.RawMessage) (any, error) {
		oldPath, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		newName, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		return nil, fm.RenameFolder(oldPath, newName)
	})

	r.Handle(ChannelMovePaths, func(_ context.Context, args []json.RawMessage) (any, error) {
		paths, err := DecodeArg[[]string](args, 0)
		if err != nil {
			return nil, err
		}
		destDir, err := DecodeArg[string](args, 1)
		if err != nil {
			return nil, err
		}
		failed := fm.MovePaths(paths, destDir)
		if len(failed) > 0 {
			return failed, fmt.Errorf("failed to move %d items", len(failed))
		}
		return nil, nil
	})

	r.Handle(ChannelFolderDelete, func(_ context.Context, args []json.RawMessage) (any, error) {
		path, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, fm.DeleteFolder(path)
	})
}
