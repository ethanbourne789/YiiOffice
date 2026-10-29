package export

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// HeadlessExporter maps module name to an export function.
type HeadlessExporter func(inputPath string, outPath string) error

// MTIME_SLACK_MS is the tolerance for FAT/exFAT timestamp granularity.
const mtimeSlackMS = 2000

// RunHeadlessExport validates paths and dispatches to the right exporter.
func RunHeadlessExport(req HeadlessRequest, exporters map[string]HeadlessExporter) HeadlessOutcome {
	if err := ValidateRequest(req); err != nil {
		return HeadlessOutcome{Success: false, Error: err.Error()}
	}

	if err := validateHeadlessPaths(req); err != nil {
		return HeadlessOutcome{Success: false, Error: err.Error()}
	}

	module := headlessModuleFor(req.Input)
	exporter, ok := exporters[module]
	if !ok {
		return HeadlessOutcome{
			Success: false,
			Error:   fmt.Sprintf("no headless exporter registered for module %q", module),
		}
	}

	startedAt := time.Now()

	if err := exporter(req.Input, req.Out); err != nil {
		return HeadlessOutcome{
			Success: false,
			Error:   err.Error(),
			Input:   req.Input,
			Out:     req.Out,
		}
	}

	if err := verifyOutputFile(req.Out, startedAt); err != nil {
		return HeadlessOutcome{
			Success: false,
			Error:   err.Error(),
			Input:   req.Input,
			Out:     req.Out,
		}
	}

	return HeadlessOutcome{
		Success: true,
		Input:   req.Input,
		Out:     req.Out,
	}
}

// validateHeadlessPaths checks that input/output paths are valid before creating any windows.
func validateHeadlessPaths(req HeadlessRequest) error {
	// Input file must exist and be a regular file.
	inputInfo, err := os.Stat(req.Input)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("input file does not exist: %s", req.Input)
		}
		return fmt.Errorf("cannot stat input: %w", err)
	}
	if inputInfo.IsDir() {
		return fmt.Errorf("input is a directory: %s", req.Input)
	}

	// Output directory must exist.
	outDir := filepath.Dir(req.Out)
	dirInfo, err := os.Stat(outDir)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("output directory does not exist: %s", outDir)
		}
		return fmt.Errorf("cannot stat output dir: %w", err)
	}
	if !dirInfo.IsDir() {
		return fmt.Errorf("output parent is not a directory: %s", outDir)
	}

	// Input and output must not be the same file.
	inputAbs, err := filepath.Abs(req.Input)
	if err != nil {
		return fmt.Errorf("resolve input path: %w", err)
	}
	outAbs, err := filepath.Abs(req.Out)
	if err != nil {
		return fmt.Errorf("resolve output path: %w", err)
	}
	if strings.EqualFold(inputAbs, outAbs) {
		return errors.New("input and output paths must be different")
	}

	return nil
}

// verifyOutputFile checks that the output file was actually created by the exporter.
func verifyOutputFile(outPath string, startedAt time.Time) error {
	info, err := os.Stat(outPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("output file was not created: %s", outPath)
		}
		return fmt.Errorf("cannot stat output: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("output is a directory: %s", outPath)
	}

	// Check mtime is after startedAt (with FAT/exFAT slack).
	modTime := info.ModTime()
	if modTime.Before(startedAt.Add(-time.Duration(mtimeSlackMS) * time.Millisecond)) {
		return fmt.Errorf("output file is older than export start time")
	}

	return nil
}
