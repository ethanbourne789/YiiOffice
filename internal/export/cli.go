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

// headlessModuleFor returns the editor module name for a given file extension.
// It returns an empty string if the extension is not recognized.
func headlessModuleFor(inputPath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(inputPath), "."))
	switch ext {
	case "docx", "doc":
		return "docs"
	case "xlsx", "xls", "xlsm", "csv", "tsv":
		return "sheets"
	case "pptx", "ppt":
		return "slides"
	case "md", "markdown":
		return "markdown"
	}
	return ""
}

// ValidateRequest checks that the input path, output format, and targets are valid.
func ValidateRequest(req HeadlessRequest) error {
	module := headlessModuleFor(req.Input)
	if module == "" {
		return errors.New("unsupported input file type: " + req.Input)
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
