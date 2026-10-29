package bridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

const (
	ChannelSlidesOpen                = "slides:open"
	ChannelSlidesOpenPath            = "slides:open-path"
	ChannelSlidesConsumePendingOpen  = "slides:consume-pending-open"
	ChannelSlidesNewBlank            = "slides:new-blank"
	ChannelSlidesSave                = "slides:save"
	ChannelSlidesSaveAs              = "slides:save-as"
	ChannelSlidesIsDirty             = "slides:is-dirty"
	ChannelSlidesEditText            = "slides:edit-text"
	ChannelSlidesEditTransform       = "slides:edit-transform"
	ChannelSlidesEditFill            = "slides:edit-fill"
	ChannelSlidesEditStroke          = "slides:edit-stroke"
	ChannelSlidesAddElement          = "slides:add-element"
	ChannelSlidesDeleteElement       = "slides:delete-element"
	ChannelSlidesAddSlide            = "slides:add-slide"
	ChannelSlidesDeleteSlide         = "slides:delete-slide"
	ChannelSlidesUndo                = "slides:undo"
	ChannelSlidesRedo                = "slides:redo"
	ChannelSlidesExportPdf           = "slides:export-pdf"
	ChannelSlidesExportImages        = "slides:export-images"
	ChannelSlidesPrint               = "slides:print"
	ChannelSlidesPresenterStart      = "slides:presenter-start"
	ChannelSlidesPresenterSync       = "slides:presenter-sync"
	ChannelSlidesPresenterEnd        = "slides:presenter-end"
	ChannelSlidesFilesPick           = "slides:files-pick"
	ChannelSlidesFilesAdd            = "slides:files-add"
	ChannelSlidesFilesAddPastedImage = "slides:files-add-pasted-image"
	ChannelSlidesFilesRead           = "slides:files-read"
	ChannelSlidesFilesReadImage      = "slides:files-read-image"
	ChannelSlidesDirtyChanged        = "slides:dirty-changed"
	ChannelSlidesCloseSaveRequest    = "slides:close-save-request"
	ChannelSlidesCloseSaveResult     = "slides:close-save-result"
	ChannelSlidesOpened              = "slides:opened"
	ChannelSlidesRenamed             = "slides:renamed"
	ChannelSlidesTeardown            = "slides:teardown"
)

type slidesOpenPathRequest struct {
	Path string `json:"path"`
}

type slidesSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"` // base64
}

type slidesOpenedRequest struct {
	Path  string `json:"path"`
	Title string `json:"title"`
	TabID string `json:"tabId"`
}

// RegisterSlides wires the slides editor channels.
func RegisterSlides(r *Router, rm *host.RecentManager) {
	stub := func(_ context.Context, _ []json.RawMessage) (any, error) {
		return nil, nil
	}

	// Pure frontend editing operations
	r.Handle(ChannelSlidesEditText, stub)
	r.Handle(ChannelSlidesEditTransform, stub)
	r.Handle(ChannelSlidesEditFill, stub)
	r.Handle(ChannelSlidesEditStroke, stub)
	r.Handle(ChannelSlidesAddElement, stub)
	r.Handle(ChannelSlidesDeleteElement, stub)
	r.Handle(ChannelSlidesAddSlide, stub)
	r.Handle(ChannelSlidesDeleteSlide, stub)
	r.Handle(ChannelSlidesUndo, stub)
	r.Handle(ChannelSlidesRedo, stub)

	// Presenter / export / lifecycle stubs
	r.Handle(ChannelSlidesPresenterStart, stub)
	r.Handle(ChannelSlidesPresenterSync, stub)
	r.Handle(ChannelSlidesPresenterEnd, stub)
	r.Handle(ChannelSlidesExportPdf, stub)
	r.Handle(ChannelSlidesExportImages, stub)
	r.Handle(ChannelSlidesPrint, stub)
	r.Handle(ChannelSlidesConsumePendingOpen, stub)
	r.Handle(ChannelSlidesNewBlank, stub)
	r.Handle(ChannelSlidesIsDirty, stub)
	r.Handle(ChannelSlidesDirtyChanged, stub)
	r.Handle(ChannelSlidesCloseSaveRequest, stub)
	r.Handle(ChannelSlidesCloseSaveResult, stub)
	r.Handle(ChannelSlidesTeardown, stub)
	r.Handle(ChannelSlidesFilesPick, stub)
	r.Handle(ChannelSlidesFilesAdd, stub)
	r.Handle(ChannelSlidesFilesAddPastedImage, stub)
	r.Handle(ChannelSlidesOpen, stub)

	// slides:open-path
	r.Handle(ChannelSlidesOpenPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesOpenPathRequest](args, 0)
		if err != nil {
			pathStr, err2 := DecodeArg[string](args, 0)
			if err2 != nil {
				return nil, fmt.Errorf("path required")
			}
			req.Path = pathStr
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	// slides:save
	r.Handle(ChannelSlidesSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, fmt.Errorf("decode content: %w", err)
		}
		dir := filepath.Dir(req.Path)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			os.MkdirAll(dir, 0o755)
		}
		if err := os.WriteFile(req.Path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write file: %w", err)
		}
		return nil, nil
	})

	// slides:save-as
	r.Handle(ChannelSlidesSaveAs, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, fmt.Errorf("decode content: %w", err)
		}
		if err := os.WriteFile(req.Path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write file: %w", err)
		}
		return map[string]any{"path": req.Path}, nil
	})

	// slides:files-read
	r.Handle(ChannelSlidesFilesRead, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesOpenPathRequest](args, 0)
		if err != nil {
			pathStr, err2 := DecodeArg[string](args, 0)
			if err2 != nil {
				return nil, fmt.Errorf("path required")
			}
			req.Path = pathStr
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	// slides:files-read-image
	r.Handle(ChannelSlidesFilesReadImage, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesOpenPathRequest](args, 0)
		if err != nil {
			pathStr, err2 := DecodeArg[string](args, 0)
			if err2 != nil {
				return nil, fmt.Errorf("path required")
			}
			req.Path = pathStr
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	// slides:opened
	r.Handle(ChannelSlidesOpened, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesOpenedRequest](args, 0)
		if err != nil {
			return nil, err
		}
		rm.AddRecent(req.Path)
		return nil, nil
	})

	// slides:renamed
	r.Handle(ChannelSlidesRenamed, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[slidesOpenedRequest](args, 0)
		if err != nil {
			return nil, err
		}
		platform.Emit("home:file-renamed", map[string]any{
			"path":  req.Path,
			"title": req.Title,
		})
		return nil, nil
	})
}
