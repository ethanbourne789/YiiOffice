package bridge

import (
	"errors"
	"strings"
	"testing"
)

func TestCodedErrorPrefixesRawError(t *testing.T) {
	got := codedError(ErrSaveWriteFailed, errors.New("disk full")).Error()
	if got != "save_write_failed: disk full" {
		t.Fatalf("got %q", got)
	}
}

func TestCodedErrorKeepsExistingCode(t *testing.T) {
	// The workbook engine already returns stable codes; they must pass through.
	for _, msg := range []string{"workbook_password_required", "workbook_corrupt: zip: not a valid file"} {
		got := codedError(ErrSaveWriteFailed, errors.New(msg)).Error()
		if got != msg {
			t.Fatalf("expected %q to pass through, got %q", msg, got)
		}
	}
}

func TestCodedMessageBareCodeWithoutDetail(t *testing.T) {
	if got := codedMessage(ErrExportEmptyDocument, "  "); got != ErrExportEmptyDocument {
		t.Fatalf("got %q", got)
	}
	got := codedMessage(ErrExportRenderFailed, "printer offline")
	if got != "export_render_failed: printer offline" {
		t.Fatalf("got %q", got)
	}
}

func TestCodedErrorNilStaysNil(t *testing.T) {
	if err := codedError(ErrOpenReadFailed, nil); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if hasErrorCode("read file: no such file") {
		t.Fatal("plain English must not be treated as a code")
	}
	if !hasErrorCode("update_feed_http_error: HTTP 500") {
		t.Fatal("prefixed code should be detected")
	}
	if !strings.HasPrefix(codedMessage(ErrOpenPathInvalid, "x"), "open_path_invalid") {
		t.Fatal("code must lead the message")
	}
}
