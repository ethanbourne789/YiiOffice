package export

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// Headless export timeouts matching the Electron version.
const (
	DocsHeadlessTimeout     = 300 * time.Second
	SheetsHeadlessTimeout   = 600 * time.Second
	SlidesHeadlessTimeout   = 300 * time.Second
	MarkdownHeadlessTimeout = 180 * time.Second
)

// Module name constants.
const (
	ModuleDocs     = "docs"
	ModuleSheets   = "sheets"
	ModuleSlides   = "slides"
	ModuleMarkdown = "markdown"
)

// exportPaths validates that input and output paths are valid.
func validateExportPaths(inputPath, outPath string) error {
	info, err := os.Stat(inputPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("input file does not exist: %s", inputPath)
		}
		return fmt.Errorf("stat input: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("input is a directory: %s", inputPath)
	}

	outDir := filepath.Dir(outPath)
	if outDir == "" {
		outDir = "."
	}
	if _, err := os.Stat(outDir); os.IsNotExist(err) {
		return fmt.Errorf("output directory does not exist: %s", outDir)
	}

	return nil
}

// ExportDocsHeadless exports a .docx file to PDF.
func ExportDocsHeadless(inputPath, outPath string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	return runEditorExport(ModuleDocs, inputPath, outPath, DocsHeadlessTimeout)
}

// ExportSheetsPdfHeadless exports a .xlsx/.xls/.csv file to PDF.
func ExportSheetsPdfHeadless(inputPath, outPath string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	return runEditorExport(ModuleSheets, inputPath, outPath, SheetsHeadlessTimeout)
}

// ExportSlidesPdfHeadless exports a .pptx file to PDF.
func ExportSlidesPdfHeadless(inputPath, outPath string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	return runEditorExport(ModuleSlides, inputPath, outPath, SlidesHeadlessTimeout)
}

// ExportMarkdownPdfHeadless exports a .md file to PDF.
func ExportMarkdownPdfHeadless(inputPath, outPath string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	return runEditorExport(ModuleMarkdown, inputPath, outPath, MarkdownHeadlessTimeout)
}

// runEditorExport executes the headless export for a given editor module.
//
// Flow:
// 1. Create a hidden WebView2 window loading the editor renderer.
// 2. Trigger the editor's headless export IPC channel.
// 3. Wait for the export to complete (with timeout).
// 4. Cleanup and return.
func runEditorExport(module, inputPath, outPath string, timeout time.Duration) error {
	app := application.Get()
	if app == nil {
		return fmt.Errorf("Wails app not initialized (use headless CLI entry point)")
	}

	// Create a hidden window for the export.
	windowName := fmt.Sprintf("headless-%s-%d", module, time.Now().UnixNano())
	w := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:     windowName,
		Title:    "Headless Export",
		Width:    1,
		Height:   1,
		URL:      "/" + module + "/",
		Hidden:   true,
		Frameless: true,
	})

	defer func() {
		app.Window.Remove(w.ID())
	}()

	// Set up completion channel.
	done := make(chan error, 1)

	// Listen for the headless-export-done event from the renderer.
	doneEvent := fmt.Sprintf("%s:headless-export-done", module)
	unsubscribe := app.Event.On(doneEvent, func(evt *application.CustomEvent) {
		if data, ok := evt.Data.(map[string]any); ok {
			if errStr, _ := data["error"].(string); errStr != "" {
				done <- fmt.Errorf("export error: %s", errStr)
				return
			}
		}
		done <- nil
	})
	defer unsubscribe()

	// Trigger the headless export by emitting the consume event.
	consumeEvent := fmt.Sprintf("%s:consume-headless-export", module)
	app.Event.Emit(consumeEvent, map[string]string{
		"inputPath": inputPath,
		"outPath":   outPath,
	})

	// Wait for completion with timeout.
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return fmt.Errorf("headless export timed out after %v", timeout)
	}
}

// PrintHtmlToPdf converts a standalone HTML file to PDF using Edge headless.
// This is used for AI-generated HTML content and the markdown export path.
func PrintHtmlToPdf(htmlPath, outPath string) error {
	// Validate paths.
	if _, err := os.Stat(htmlPath); os.IsNotExist(err) {
		return fmt.Errorf("HTML file does not exist: %s", htmlPath)
	}

	edgePath := platform.FindEdgeBrowser()
	if edgePath == "" {
		return fmt.Errorf("Edge browser executable not found")
	}

	args := []string{
		"--headless",
		"--disable-gpu",
		"--no-sandbox",
		"--print-to-pdf=" + outPath,
		"--print-to-pdf-margins-top=57.6",
		"--print-to-pdf-margins-bottom=57.6",
		"--print-to-pdf-margins-left=57.6",
		"--print-to-pdf-margins-right=57.6",
		"--print-to-pdf-no-header",
		"--print-to-pdf-no-footer",
		htmlPath,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, edgePath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("edge headless html-to-pdf failed: %w\noutput: %s", err, strings.TrimSpace(string(out)))
	}

	return nil
}
