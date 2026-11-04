// Package export implements the --headless-export CLI for document conversion.
//
// The CLI syntax mirrors the Electron version exactly:
//
//	YiiOffice.exe --headless-export <input> --to <format> --out <path> [--json]
//
// Exit codes match HEADLESS_EXIT constants from the Electron version:
//
//	0 = success, 1 = bad args, 2 = input error, 3 = conversion failure
package export

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Exit codes must match Electron version HEADLESS_EXIT exactly.
const (
	ExitSuccess          = 0
	ExitBadArgs          = 1
	ExitInputError       = 2
	ExitConversionFailed = 3
)

// HeadlessTargets maps each editor module to its supported export formats.
var HeadlessTargets = map[string][]string{
	"docs":     {"pdf", "html"},
	"sheets":   {"pdf"},
	"slides":   {"pdf"},
	"markdown": {"pdf"},
}

// HeadlessRequest holds a parsed --headless-export invocation.
type HeadlessRequest struct {
	Input string // input file path
	To    string // target format ("pdf", "html")
	Out   string // output file path
	JSON  bool   // emit JSON envelope to stdout
}

// HeadlessOutcome reports the result of a headless export attempt.
type HeadlessOutcome struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
	Input   string `json:"input,omitempty"`
	Out     string `json:"out,omitempty"`
	// ExitHint pins the exit code when the failure phase is known, so a user
	// path containing a word like "missing" or "bad" cannot skew the code.
	ExitHint int `json:"-"`
}

// headlessExportFlag is the CLI flag that triggers headless mode.
const headlessExportFlag = "--headless-export"

// ParseHeadlessExport checks argv for --headless-export and returns the parsed request.
// It returns (request, true) on success or (zero, false) if the flag is absent or invalid.
func ParseHeadlessExport(argv []string) (HeadlessRequest, bool) {
	idx := -1
	for i, a := range argv {
		if a == headlessExportFlag {
			idx = i
			break
		}
	}
	if idx < 0 || idx+1 >= len(argv) {
		return HeadlessRequest{}, false
	}

	req := HeadlessRequest{}
	req.Input = argv[idx+1]

	i := idx + 2
	for i < len(argv) {
		switch argv[i] {
		case "--to":
			if i+1 >= len(argv) {
				return HeadlessRequest{}, false
			}
			req.To = argv[i+1]
			i += 2
		case "--out":
			if i+1 >= len(argv) {
				return HeadlessRequest{}, false
			}
			req.Out = argv[i+1]
			i += 2
		case "--json":
			req.JSON = true
			i++
		default:
			return HeadlessRequest{}, false
		}
	}

	if req.Input == "" || req.To == "" || req.Out == "" {
		return HeadlessRequest{}, false
	}

	return req, true
}

// ShouldRunHeadless checks os.Args for --headless-export.
func ShouldRunHeadless() (HeadlessRequest, bool) {
	return ParseHeadlessExport(os.Args)
}

// HeadlessFlagPresent reports whether the headless flag appears at all. It lets
// the entry point distinguish "not a headless run" from "headless run with bad
// arguments" (the latter must exit with the bad-args code, not boot the GUI).
func HeadlessFlagPresent(argv []string) bool {
	for _, a := range argv {
		if a == headlessExportFlag || strings.HasPrefix(a, headlessExportFlag+"=") {
			return true
		}
	}
	return false
}

// ParseHeadlessUsageError builds the outcome for a malformed invocation.
func ParseHeadlessUsageError() HeadlessOutcome {
	return HeadlessOutcome{
		Success:  false,
		Error:    "bad command line: expected --headless-export <path> --to <format> --out <file> [--json]",
		ExitHint: ExitBadArgs,
	}
}

// headlessInputTypes maps every accepted input extension to the editor module
// that can actually open it. The same list lives in
// frontend/packages/desktop-utils/src/headless-formats.json;
// TestHeadlessFormatsMatchFrontend fails when the two disagree.
//
// Legacy 97-2003 binaries (.doc/.xls/.ppt) and HTML (.html/.htm) are
// deliberately absent: the renderers only parse OOXML/text formats, and HTML
// is an export target, not an input.
var headlessInputTypes = []struct {
	ext    string
	module string
}{
	{"docx", "docs"},
	{"xlsx", "sheets"},
	{"xlsm", "sheets"},
	{"csv", "sheets"},
	{"tsv", "sheets"},
	{"pptx", "slides"},
	{"md", "markdown"},
	{"markdown", "markdown"},
}

// headlessModuleFor returns the editor module name for a given file extension.
// It returns an empty string if the extension is not recognized.
func headlessModuleFor(inputPath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(inputPath), "."))
	for _, t := range headlessInputTypes {
		if ext == t.ext {
			return t.module
		}
	}
	return ""
}

// supportedHeadlessExtensions lists the accepted extensions for error messages.
func supportedHeadlessExtensions() string {
	exts := make([]string, 0, len(headlessInputTypes))
	for _, t := range headlessInputTypes {
		exts = append(exts, "."+t.ext)
	}
	return strings.Join(exts, ", ")
}

// isLegacyOfficeExt reports whether the path uses a 97-2003 binary extension
// that the headless entry refuses instead of attempting a doomed conversion.
func isLegacyOfficeExt(inputPath string) bool {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(inputPath), ".")) {
	case "doc", "xls", "ppt":
		return true
	}
	return false
}

// ValidateRequest checks that the input path, output format, and targets are valid.
func ValidateRequest(req HeadlessRequest) error {
	module := headlessModuleFor(req.Input)
	if module == "" {
		msg := "unsupported input file type: " + req.Input +
			" (supported: " + supportedHeadlessExtensions() + ")"
		if isLegacyOfficeExt(req.Input) {
			msg += "; save legacy .doc/.xls/.ppt files as .docx/.xlsx/.pptx first"
		}
		return errors.New(msg)
	}

	targets, ok := HeadlessTargets[module]
	if !ok {
		return errors.New("no export targets defined for module: " + module)
	}

	found := false
	for _, t := range targets {
		if t == req.To {
			found = true
			break
		}
	}
	if !found {
		return errors.New("module " + module + " does not support format: " + req.To)
	}

	return nil
}
