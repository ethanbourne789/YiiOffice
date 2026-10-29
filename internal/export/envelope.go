package export

import (
	"encoding/json"
	"fmt"
)

// FormatHeadlessEnvelope formats the outcome as JSON or plain text for stdout.
// This matches the Electron version formatHeadlessEnvelope.
func FormatHeadlessEnvelope(outcome HeadlessOutcome, jsonOutput bool) string {
	if jsonOutput {
		data, err := json.Marshal(outcome)
		if err != nil {
			return fmt.Sprintf(`{"success":false,"error":"%s"}`, err.Error())
		}
		return string(data)
	}

	if outcome.Success {
		return fmt.Sprintf("ok: %s -> %s", outcome.Input, outcome.Out)
	}
	return fmt.Sprintf("error: %s", outcome.Error)
}

// HeadlessExitCode returns the process exit code for the given outcome.
func HeadlessExitCode(outcome HeadlessOutcome) int {
	if outcome.Success {
		return ExitSuccess
	}

	switch {
	case outcome.Error == "":
		return ExitConversionFailed
	case containsAny(outcome.Error, "unsupported", "not support", "missing", "bad"):
		return ExitBadArgs
	case containsAny(outcome.Error, "not exist", "no such", "permission", "input"):
		return ExitInputError
	default:
		return ExitConversionFailed
	}
}

// containsAny checks if s contains any of the substrings (case-insensitive).
func containsAny(s string, subs ...string) bool {
	lower := toLower(s)
	for _, sub := range subs {
		if containsLower(lower, toLower(sub)) {
			return true
		}
	}
	return false
}

// Simple lower-case helpers to avoid importing strings in hot paths.
func toLower(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}

func containsLower(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	if len(sub) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(sub); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if s[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
