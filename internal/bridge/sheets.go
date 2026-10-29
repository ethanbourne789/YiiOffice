package bridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
)

const (
	ChannelWorkbookSelect              = "workbook:select"
	ChannelWorkbookSelectForMerge      = "workbook:select-for-merge"
	ChannelWorkbookOpenForMerge        = "workbook:open-for-merge"
	ChannelWorkbookReadRange           = "workbook:read-range"
	ChannelWorkbookReadFormulas        = "workbook:read-formulas"
	ChannelWorkbookFindCells           = "workbook:find-cells"
	ChannelWorkbookSidecarCrashed      = "workbook:sidecar-crashed"
	ChannelWorkbookReopen              = "workbook:reopen"
	ChannelWorkbookReadRowOutline      = "workbook:read-row-outline"
	ChannelWorkbookRecalc              = "workbook:recalc"
	ChannelWorkbookReadMedia           = "workbook:read-media"
	ChannelWorkbookReadPivotDefinition = "workbook:read-pivot-definition"
	ChannelShellReadLocalImage         = "shell:read-local-image"
	ChannelWorkbookClose               = "workbook:close"
	ChannelWorkbookSave                = "workbook:save"
	ChannelWorkbookSaveEditsBegin      = "workbook:save-edits-begin"
	ChannelWorkbookSaveEditsChunk      = "workbook:save-edits-chunk"
	ChannelWorkbookSaveEditsAbort      = "workbook:save-edits-abort"
	ChannelWorkbookWriteRecovery       = "workbook:write-recovery"
	ChannelWorkbookRecoveryPrompt      = "workbook:recovery-prompt"
	ChannelWorkbookRecoveryPromptReply = "workbook:recovery-prompt-reply"
	ChannelWorkbookAutoRename          = "workbook:auto-rename"
	ChannelWorkbookRenamed             = "workbook:renamed"
	ChannelWorkbookPendingEdits        = "workbook:pending-edits"
	ChannelWorkbookCloseSaveRequest    = "workbook:close-save-request"
	ChannelWorkbookCloseSaveResult     = "workbook:close-save-result"
	ChannelWorkbookExportPdf           = "workbook:export-pdf"
	ChannelWorkbookPrint               = "workbook:print"
	ChannelWorkbookListPrinters        = "workbook:list-printers"
	ChannelWorkbookExportCsv           = "workbook:export-csv"
	ChannelWorkbookCsvSaveConfirm      = "workbook:csv-save-confirm"
	ChannelWorkbookCreateDocument      = "workbook:create-document"
	ChannelWorkbookMenuAction          = "workbook:menu-action"
	ChannelUserDisplayName             = "user:display-name"
	ChannelSheetsCaptureScreenSources  = "sheets:capture-screen-sources"
	ChannelSheetsCaptureScreenSource   = "sheets:capture-screen-source"
	ChannelSheetsFilesPick             = "sheets:files-pick"
	ChannelSheetsFilesAdd              = "sheets:files-add"
	ChannelSheetsFilesAddPastedImage   = "sheets:files-add-pasted-image"
	ChannelSheetsFilesRead             = "sheets:files-read"
	ChannelSheetsFilesReadImage        = "sheets:files-read-image"
	ChannelSheetsConsumeNewBlank       = "sheets:consume-new-blank"
	ChannelSheetsHasQueuedWorkbook     = "sheets:has-queued-workbook"
	ChannelSheetsConsumeHeadlessExport = "sheets:consume-headless-export"
	ChannelSheetsHeadlessExportDone    = "sheets:headless-export-done"
	ChannelShellOpenExternal           = "shell:open-external"
)

type workbookSaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"` // base64
}

type sheetsReadFileRequest struct {
	Path string `json:"path"`
}

// RegisterSheets wires the sheets editor channels.
func RegisterSheets(r *Router) {
	stub := func(_ context.Context, _ []json.RawMessage) (any, error) {
		return nil, nil
	}

	// Register all stub channels (sidecar ops, file dialogs, export, lifecycle)
	stubChannels := []string{
		ChannelWorkbookSelect,
		ChannelWorkbookSelectForMerge,
		ChannelWorkbookOpenForMerge,
		ChannelWorkbookReadRange,
		ChannelWorkbookReadFormulas,
		ChannelWorkbookFindCells,
		ChannelWorkbookSidecarCrashed,
		ChannelWorkbookReopen,
		ChannelWorkbookReadRowOutline,
		ChannelWorkbookRecalc,
		ChannelWorkbookReadMedia,
		ChannelWorkbookReadPivotDefinition,
		ChannelWorkbookClose,
		ChannelWorkbookSaveEditsBegin,
		ChannelWorkbookSaveEditsChunk,
		ChannelWorkbookSaveEditsAbort,
		ChannelWorkbookWriteRecovery,
		ChannelWorkbookRecoveryPrompt,
		ChannelWorkbookRecoveryPromptReply,
		ChannelWorkbookAutoRename,
		ChannelWorkbookRenamed,
		ChannelWorkbookPendingEdits,
		ChannelWorkbookCloseSaveRequest,
		ChannelWorkbookCloseSaveResult,
		ChannelWorkbookExportPdf,
		ChannelWorkbookPrint,
		ChannelWorkbookListPrinters,
		ChannelWorkbookExportCsv,
		ChannelWorkbookCsvSaveConfirm,
		ChannelWorkbookCreateDocument,
		ChannelWorkbookMenuAction,
		ChannelUserDisplayName,
		ChannelSheetsCaptureScreenSources,
		ChannelSheetsCaptureScreenSource,
		ChannelSheetsFilesPick,
		ChannelSheetsFilesAdd,
		ChannelSheetsFilesAddPastedImage,
		ChannelSheetsConsumeNewBlank,
		ChannelSheetsHasQueuedWorkbook,
		ChannelSheetsConsumeHeadlessExport,
		ChannelSheetsHeadlessExportDone,
	}
	for _, ch := range stubChannels {
		r.Handle(ch, stub)
	}

	// workbook:save — write base64 content to file
	r.Handle(ChannelWorkbookSave, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[workbookSaveRequest](args, 0)
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

	// sheets:files-read
	r.Handle(ChannelSheetsFilesRead, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[sheetsReadFileRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	// sheets:files-read-image
	r.Handle(ChannelSheetsFilesReadImage, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[sheetsReadFileRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})

	// shell:read-local-image
	r.Handle(ChannelShellReadLocalImage, func(_ context.Context, args []json.RawMessage) (any, error) {
		req, err := DecodeArg[sheetsReadFileRequest](args, 0)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(req.Path)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		return base64.StdEncoding.EncodeToString(data), nil
	})
}
