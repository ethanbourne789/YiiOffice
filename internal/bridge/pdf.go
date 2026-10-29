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

// pdfReadFileRequest is the argument for pdf:read-file.
type pdfReadFileRequest struct {
	Path string `json:"path"`
}

// pdfSaveRequest is the argument for pdf:save.
type pdfSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"` // base64
}

// RegisterPdf wires the PDF editor channels.
func RegisterPdf(r *Router, rm *host.RecentManager) {
	// Stub handler for channels not yet implemented (Phase 5).
	stub := func(_ context.Context, _ []json.RawMessage) (any, error) {
		return nil, nil
	}

	// PDF advanced operations — stub (Phase 5)
	r.Handle(ChannelPdfRequestRedactionCopy, stub)
	r.Handle(ChannelPdfAutoRename, stub)
	r.Handle(ChannelPdfIsUntitled, stub)
	r.Handle(ChannelPdfValidateTextEdits, stub)
	r.Handle(ChannelPdfListEditFonts, stub)
	r.Handle(ChannelPdfCanDrawText, stub)
	r.Handle(ChannelPdfListPageImages, stub)
	r.Handle(ChannelPdfListStaticFormFills, stub)
	r.Handle(ChannelPdfPageImagePng, stub)
	r.Handle(ChannelPdfOcrPage, stub)
	r.Handle(ChannelPdfPagePreviewPng, stub)

	// Page operations — stub (Phase 5)
	r.Handle(ChannelPdfExtractPages, stub)
	r.Handle(ChannelPdfInsertPdf, stub)
	r.Handle(ChannelPdfInsertBlankPage, stub)
	r.Handle(ChannelPdfSplitPdf, stub)
	r.Handle(ChannelPdfMergePdf, stub)
	r.Handle(ChannelPdfMergePages, stub)
	r.Handle(ChannelPdfReplacePages, stub)
	r.Handle(ChannelPdfSetPageSize, stub)
	r.Handle(ChannelPdfSplitPages, stub)
	r.Handle(ChannelPdfCropPages, stub)

	// Export / conversion — stub (Phase 5)
	r.Handle(ChannelPdfExportImages, stub)
	r.Handle(ChannelPdfConvertOffice, stub)
	r.Handle(ChannelPdfCreateDocument, stub)
	r.Handle(ChannelPdfGenerateImage, stub)

	// Signatures — stub (Phase 5)
	r.Handle(ChannelPdfListSignatures, stub)
	r.Handle(ChannelPdfAddSignature, stub)
	r.Handle(ChannelPdfRemoveSignature, stub)
	r.Handle(ChannelPdfGetUsername, stub)

	// Lifecycle — stub
	r.Handle(ChannelPdfConsumePending, stub)
	r.Handle(ChannelPdfDirtyChanged, stub)
	r.Handle(ChannelPdfCloseSaveRequest, stub)
	r.Handle(ChannelPdfCloseSaveResult, stub)
	r.Handle(ChannelPdfSaveAsRequest, stub)
	r.Handle(ChannelPdfSaveAsResult, stub)
	r.Handle(ChannelPdfSaveAsFlow, stub)
	r.Handle(ChannelPdfPrintRequest, stub)
	r.Handle(ChannelPdfFileRenamed, stub)

	// pdf:read-file — read PDF file and return base64-encoded content.
	r.Handle(ChannelPdfReadFile, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[pdfReadFileRequest](args, 0)
		if err != nil {
			// Fallback: accept bare string path for backward compatibility.
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

	// pdf:save — write base64-decoded content to file.
	r.Handle(ChannelPdfSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[pdfSaveRequest](args, 0)
		if err != nil {
			return nil, err
		}

		data, err := base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			return nil, fmt.Errorf("decode content: %w", err)
		}

		dir := filepath.Dir(req.Path)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create directory: %w", err)
			}
		}

		if err := os.WriteFile(req.Path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write file: %w", err)
		}

		if rm != nil {
			rm.AddRecent(req.Path)
		}
		return nil, nil
	})
}
