package bridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

const (
	ChannelDocsOpen                = "docs:open"
	ChannelDocsOpenPath            = "docs:open-path"
	ChannelDocsSave                = "docs:save"
	ChannelDocsSaveAs              = "docs:save-as"
	ChannelDocsSaveNew             = "docs:save-new"
	ChannelDocsSaveTo              = "docs:save-to"
	ChannelDocsConsumePendingOpen  = "docs:consume-pending-open"
	ChannelDocsConsumeNewBlank     = "docs:consume-new-blank"
	ChannelDocsConsumeAiDocContent = "docs:consume-ai-doc-content"
	ChannelDocsConsumeHeadlessExport = "docs:consume-headless-export"
	ChannelDocsExportPdf           = "docs:export-pdf"
	ChannelDocsExportHtml          = "docs:export-html"
	ChannelDocsPrint               = "docs:print"
	ChannelDocsContextMenuArm      = "docs:context-menu-arm"
	ChannelDocsContextMenuClaim    = "docs:context-menu-claim"
	ChannelDocsContextMenu         = "docs:context-menu"
	ChannelDocsSpellAddWord        = "docs:spell-add-word"
	ChannelDocsSpellIgnoreWord     = "docs:spell-ignore-word"
	ChannelDocsSpellReplace        = "docs:spell-replace"
	ChannelDocsSpellLanguages      = "docs:spell-languages"
	ChannelDocsSpellSetLanguages   = "docs:spell-set-languages"
	ChannelDocsCloseCheck          = "docs:close-check"
	ChannelDocsCloseCheckResult    = "docs:close-check-result"
	ChannelDocsCloseSaveRequest    = "docs:close-save-request"
	ChannelDocsCloseSaveResult     = "docs:close-save-result"
	ChannelDocsMcpCommand          = "docs:mcp-command"
	ChannelDocsMcpResult           = "docs:mcp-result"
	ChannelDocsMcpReady            = "docs:mcp-ready"
	ChannelDocsOpened              = "docs:opened"
	ChannelDocsRenamed             = "docs:renamed"
	ChannelDocsTeardown            = "docs:teardown"
	ChannelDocsViewMenuState       = "docs:view-menu-state"
)

type docsOpenPathRequest struct {
	Path string `json:"path"`
}

type docsSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"` // base64
}

type docsOpenedRequest struct {
	Path      string `json:"path"`
	Title     string `json:"title"`
	TabID     string `json:"tabId"`
	CreatedMs int64  `json:"createdMs"`
}

type docsRenamedRequest struct {
	Path  string `json:"path"`
	Title string `json:"title"`
	TabID string `json:"tabId"`
}

// RegisterDocs wires the docs editor channels.
func RegisterDocs(r *Router, rm *host.RecentManager, idxLc *index.Lifecycle) {
	stub := func(_ context.Context, _ []json.RawMessage) (any, error) {
		return nil, nil
	}

	// Pure frontend / stub channels
	r.Handle(ChannelDocsOpen, stub)
	r.Handle(ChannelDocsSaveNew, stub)
	r.Handle(ChannelDocsConsumePendingOpen, stub)
	r.Handle(ChannelDocsConsumeNewBlank, stub)
	r.Handle(ChannelDocsConsumeAiDocContent, stub)
	r.Handle(ChannelDocsConsumeHeadlessExport, stub)
	r.Handle(ChannelDocsExportPdf, stub)
	r.Handle(ChannelDocsExportHtml, stub)
	r.Handle(ChannelDocsPrint, stub)
	r.Handle(ChannelDocsContextMenuArm, stub)
	r.Handle(ChannelDocsContextMenuClaim, stub)
	r.Handle(ChannelDocsContextMenu, stub)
	r.Handle(ChannelDocsSpellAddWord, stub)
	r.Handle(ChannelDocsSpellIgnoreWord, stub)
	r.Handle(ChannelDocsSpellReplace, stub)
	r.Handle(ChannelDocsSpellLanguages, stub)
	r.Handle(ChannelDocsSpellSetLanguages, stub)
	r.Handle(ChannelDocsCloseCheck, stub)
	r.Handle(ChannelDocsCloseCheckResult, stub)
	r.Handle(ChannelDocsCloseSaveRequest, stub)
	r.Handle(ChannelDocsCloseSaveResult, stub)
	r.Handle(ChannelDocsMcpCommand, stub)
	r.Handle(ChannelDocsMcpResult, stub)
	r.Handle(ChannelDocsMcpReady, stub)
	r.Handle(ChannelDocsTeardown, stub)
	r.Handle(ChannelDocsViewMenuState, stub)

	// docs:open-path — read file bytes, return base64
	r.Handle(ChannelDocsOpenPath, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsOpenPathRequest](args, 0)
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

	// docs:save — write base64 content to file
	r.Handle(ChannelDocsSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsSaveRequest](args, 0)
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
		if idxLc != nil {
			idxLc.Refresh()
		}
		return nil, nil
	})

	// docs:save-as
	r.Handle(ChannelDocsSaveAs, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsSaveRequest](args, 0)
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
		if idxLc != nil {
			idxLc.Refresh()
		}
		return map[string]any{"path": req.Path}, nil
	})

	// docs:save-to
	r.Handle(ChannelDocsSaveTo, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsSaveRequest](args, 0)
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
		return nil, nil
	})

	// docs:opened — record in recent files
	r.Handle(ChannelDocsOpened, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsOpenedRequest](args, 0)
		if err != nil {
			return nil, err
		}
		rm.AddRecent(req.Path)
		return nil, nil
	})

	// docs:renamed
	r.Handle(ChannelDocsRenamed, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[docsRenamedRequest](args, 0)
		if err != nil {
			return nil, err
		}
		platform.Emit("home:file-renamed", map[string]any{
			"path":  req.Path,
			"title": req.Title,
		})
		if idxLc != nil {
			idxLc.Refresh()
		}
		return nil, nil
	})
}
