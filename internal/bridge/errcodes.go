package bridge

import (
	"fmt"
	"strings"
)

// Stable, user-facing error codes returned by bridge bindings.
//
// The renderer must never display a raw Go/os error: it maps these codes to its
// own localized copy. The wire format is
//
//	<code>: <detail>
//
// where <code> is one of the constants below and <detail> is diagnostics only
// (it is kept for logs and for the "details" expander, never as UI copy). A
// struct field with no useful detail may carry the bare code.
//
// Codes are lowercase snake_case with a domain prefix, matching the existing
// workbook codes (`workbook_password_required` etc.). Do not rename a shipped
// code: the renderer keys its translations off the exact string.
const (
	// open
	ErrOpenPathInvalid       = "open_path_invalid"
	ErrOpenPathNotAuthorised = "open_path_not_authorised"
	ErrOpenReadFailed        = "open_read_failed"
	ErrOpenUnsupportedType   = "open_unsupported_type"
	ErrOpenDialogFailed      = "open_dialog_failed"
	ErrAppUnavailable        = "app_unavailable"

	// save
	ErrSavePathInvalid       = "save_path_invalid"
	ErrSavePathNotAuthorised = "save_path_not_authorised"
	ErrSaveDecodeFailed      = "save_decode_failed"
	ErrSaveDirectoryFailed   = "save_directory_failed"
	ErrSaveWriteFailed       = "save_write_failed"
	ErrSaveDialogFailed      = "save_dialog_failed"

	// export
	ErrExportEmptyDocument       = "export_empty_document"
	ErrExportTargetNotAuthorised = "export_target_not_authorised"
	ErrExportDialogFailed        = "export_dialog_failed"
	ErrExportDecodeFailed        = "export_decode_failed"
	ErrExportWriteFailed         = "export_write_failed"
	ErrExportRenderFailed        = "export_render_failed"
	ErrExportMergeFailed         = "export_merge_failed"
	ErrExportSourceUnreadable    = "export_source_unreadable"

	// pdf page operations
	ErrPdfOpNotAuthorised = "pdf_op_not_authorised"
	ErrPdfOpDialogFailed  = "pdf_op_dialog_failed"
	ErrPdfOpDecodeFailed  = "pdf_op_decode_failed"
	ErrPdfOpFailed        = "pdf_op_failed"
)

// codedError prefixes err with a stable code. An error that already carries a
// code (for example the workbook engine's `workbook_password_required`) is
// returned unchanged so callers never produce two stacked codes.
func codedError(code string, err error) error {
	if err == nil {
		return nil
	}
	if hasErrorCode(err.Error()) {
		return err
	}
	return fmt.Errorf("%s: %w", code, err)
}

// codedMessage formats a code plus raw diagnostics for a struct Error field.
func codedMessage(code, detail string) string {
	if strings.TrimSpace(detail) == "" {
		return code
	}
	return code + ": " + detail
}

// hasErrorCode reports whether msg already starts with a stable error code, so
// codedError/codedMessage stay idempotent. A code is lowercase ASCII/digits
// with at least one underscore in its first token (before the first colon).
func hasErrorCode(msg string) bool {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return false
	}
	head := msg
	if i := strings.IndexByte(msg, ':'); i > 0 {
		head = msg[:i]
	}
	return isErrorCodeToken(head)
}

func isErrorCodeToken(token string) bool {
	if !strings.Contains(token, "_") {
		return false
	}
	for _, r := range token {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return false
	}
	return true
}
