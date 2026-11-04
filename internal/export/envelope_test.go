package export

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestFormatHeadlessEnvelopeJSON(t *testing.T) {
	outcome := HeadlessOutcome{Success: true, Input: "a.docx", Out: "b.pdf"}
	got := FormatHeadlessEnvelope(outcome, true)

	var result map[string]any
	if err := json.Unmarshal([]byte(got), &result); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("success = %v", result["success"])
	}
}

func TestFormatHeadlessEnvelopeJSONError(t *testing.T) {
	outcome := HeadlessOutcome{Success: false, Error: "conversion failed"}
	got := FormatHeadlessEnvelope(outcome, true)

	var result map[string]any
	if err := json.Unmarshal([]byte(got), &result); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if result["success"] != false {
		t.Fatalf("success = %v", result["success"])
	}
	if result["error"] != "conversion failed" {
		t.Fatalf("error = %v", result["error"])
	}
}

func TestFormatHeadlessEnvelopePlainText(t *testing.T) {
	outcome := HeadlessOutcome{Success: true, Input: "a.docx", Out: "b.pdf"}
	got := FormatHeadlessEnvelope(outcome, false)
	if !strings.Contains(got, "ok:") {
		t.Fatalf("expected ok prefix, got: %s", got)
	}
}

func TestFormatHeadlessEnvelopePlainTextError(t *testing.T) {
	outcome := HeadlessOutcome{Success: false, Error: "timeout"}
	got := FormatHeadlessEnvelope(outcome, false)
	if !strings.Contains(got, "error:") {
		t.Fatalf("expected error prefix, got: %s", got)
	}
}

func TestHeadlessExitCodeSuccess(t *testing.T) {
	if got := HeadlessExitCode(HeadlessOutcome{Success: true}); got != ExitSuccess {
		t.Fatalf("got %d", got)
	}
}

func TestHeadlessExitCodeBadArgs(t *testing.T) {
	if got := HeadlessExitCode(HeadlessOutcome{Success: false, Error: "unsupported file type"}); got != ExitBadArgs {
		t.Fatalf("got %d, want %d", got, ExitBadArgs)
	}
}

func TestHeadlessExitCodeInputError(t *testing.T) {
	if got := HeadlessExitCode(HeadlessOutcome{Success: false, Error: "file not exist"}); got != ExitInputError {
		t.Fatalf("got %d, want %d", got, ExitInputError)
	}
}

func TestHeadlessExitCodeHintOverridesHeuristic(t *testing.T) {
	// A user path containing "missing"/"bad" must not turn an input failure into
	// a bad-args code.
	outcome := HeadlessOutcome{
		Error:    `input file does not exist: C:\missing\bad report.docx`,
		ExitHint: ExitInputError,
	}
	if got := HeadlessExitCode(outcome); got != ExitInputError {
		t.Fatalf("got %d, want %d", got, ExitInputError)
	}
}

func TestHeadlessExitCodeConversionFailure(t *testing.T) {
	if got := HeadlessExitCode(HeadlessOutcome{Success: false, Error: "timeout during render"}); got != ExitConversionFailed {
		t.Fatalf("got %d, want %d", got, ExitConversionFailed)
	}
}

func TestContainsAny(t *testing.T) {
	if !containsAny("Unsupported input type", "unsupported") {
		t.Fatal("should match")
	}
	if containsAny("hello world", "xyz") {
		t.Fatal("should not match")
	}
}
