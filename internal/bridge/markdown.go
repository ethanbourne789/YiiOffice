// Package bridge maps the Electron preload channel surface onto Go handlers.
package bridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

// markdownReadFileRequest carries the path for reading a file.
type markdownReadFileRequest struct {
	Path string `json:"path"`
}

// markdownSaveRequest carries the path and content for saving a file.
type markdownSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"` // base64 for binary, raw text for text files
}

// markdownReadImageRequest carries the path for reading an image file.
type markdownReadImageRequest struct {
	Path string `json:"path"`
}

// RegisterMarkdown wires the markdown editor channels.
func RegisterMarkdown(r *Router, rm *host.RecentManager) {
	stub := func(_ context.Context, _ []json.RawMessage) (any, error) {
		return nil, nil
	}

	// Lifecycle — stub
	r.Handle(ChannelMarkdownConsumePending, stub)
	r.Handle(ChannelMarkdownSaveRequest, stub)
	r.Handle(ChannelMarkdownSaveRequestAck, stub)
	r.Handle(ChannelMarkdownReadTextRequest, stub)
	r.Handle(ChannelMarkdownReadTextResult, stub)
	r.Handle(ChannelMarkdownDirtyChanged, stub)
	r.Handle(ChannelMarkdownCloseSaveRequest, stub)
	r.Handle(ChannelMarkdownCloseSaveResult, stub)
	r.Handle(ChannelMarkdownFileRenamed, stub)

	// Image operations — stub (need file dialogs)
	r.Handle(ChannelMarkdownPickImage, stub)
	r.Handle(ChannelMarkdownSaveImageAs, stub)
	r.Handle(ChannelMarkdownViewImage, stub)

	// Export — stub (Phase 5)
	r.Handle(ChannelMarkdownExportRequest, stub)
	r.Handle(ChannelMarkdownExportDocx, stub)
	r.Handle(ChannelMarkdownExportPdf, stub)
	r.Handle(ChannelMarkdownPrepareImageExport, stub)
	r.Handle(ChannelMarkdownWriteExportImage, stub)
	r.Handle(ChannelMarkdownFinishImageExport, stub)

	// Headless export — stub (Phase 5)
	r.Handle(ChannelMarkdownConsumeHeadlessExport, stub)
	r.Handle(ChannelMarkdownHeadlessExportDone, stub)
	r.Handle(ChannelMarkdownPrintRequest, stub)

	// markdown:read-file — read markdown file content
	r.Handle(ChannelMarkdownReadFile, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[markdownReadFileRequest](args, 0)
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
		return string(data), nil
	})

	// markdown:save — write content to file (plain text or base64-encoded binary)
	r.Handle(ChannelMarkdownSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[markdownSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}

		// Content may be base64 or plain text. Try base64 first.
		var data []byte
		if decoded, err := base64.StdEncoding.DecodeString(req.Content); err == nil {
			data = decoded
		} else {
			data = []byte(req.Content)
		}

		dir := filepath.Dir(req.Path)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			os.MkdirAll(dir, 0o755)
		}

		if err := os.WriteFile(req.Path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write file: %w", err)
		}

		rm.AddRecent(req.Path)
		return nil, nil
	})

	// markdown:save-image — save base64 image data to file
	r.Handle(ChannelMarkdownSaveImage, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[markdownSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}

		data, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, fmt.Errorf("decode image: %w", err)
		}

		if err := os.WriteFile(req.Path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write image: %w", err)
		}

		return map[string]interface{}{"path": req.Path}, nil
	})

	// markdown:read-image — read image file and return as base64
	r.Handle(ChannelMarkdownReadImage, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[markdownReadImageRequest](args, 0)
		if err != nil {
			pathStr, err2 := DecodeArg[string](args, 0)
			if err2 != nil {
				return nil, fmt.Errorf("path required")
			}
			req.Path = pathStr
		}

		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read image: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})
}
