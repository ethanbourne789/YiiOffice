package export

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

// Headless export budgets. The renderer poll budgets in the frontend are set
// slightly below these so a stalled document reports its specific reason
// ("no workbook opened", "pagination produced no pages") before the CLI's
// generic timeout backstop fires. They are deliberately far below the legacy
// Electron 180–600 s waits: a headless export that has not finished in a
// minute is broken, not slow.
const (
	// RendererReadyTimeout bounds how long the hidden WebView may take to load
	// the editor bundle and signal `headless-ready`. Without this handshake the
	// CLI used to emit into a page that had not subscribed yet and hang.
	RendererReadyTimeout = 20 * time.Second

	DocsHeadlessTimeout     = 60 * time.Second
	SheetsHeadlessTimeout   = 90 * time.Second
	SlidesHeadlessTimeout   = 60 * time.Second
	MarkdownHeadlessTimeout = 45 * time.Second
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

// ExportOptions carries the host state a headless renderer needs. The tab host
// is required: every editor resolves the file it was opened with from its
// `?tabId=` tab, so mounting the document means registering a real tab first.
type ExportOptions struct {
	Tabs *host.TabHost
}

// DefaultExporters wires each module to its renderer with the shared options.
func DefaultExporters(opts ExportOptions) map[string]HeadlessExporter {
	return map[string]HeadlessExporter{
		ModuleDocs: func(inputPath, outPath, format string) error {
			return ExportDocsHeadless(opts, inputPath, outPath, format)
		},
		ModuleSheets: func(inputPath, outPath, format string) error {
			return ExportSheetsPdfHeadless(opts, inputPath, outPath, format)
		},
		ModuleSlides: func(inputPath, outPath, format string) error {
			return ExportSlidesPdfHeadless(opts, inputPath, outPath, format)
		},
		ModuleMarkdown: func(inputPath, outPath, format string) error {
			return ExportMarkdownPdfHeadless(opts, inputPath, outPath, format)
		},
	}
}

// ExportDocsHeadless exports a .docx to PDF or standalone HTML.
func ExportDocsHeadless(opts ExportOptions, inputPath, outPath, format string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	if format != "pdf" && format != "html" {
		return fmt.Errorf("docs does not support format: %s", format)
	}
	return runEditorExport(opts, ModuleDocs, inputPath, outPath, format, DocsHeadlessTimeout)
}

// ExportSheetsPdfHeadless exports a .xlsx/.xls/.csv file to PDF.
func ExportSheetsPdfHeadless(opts ExportOptions, inputPath, outPath, format string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	if format != "pdf" {
		return fmt.Errorf("sheets does not support format: %s", format)
	}
	return runEditorExport(opts, ModuleSheets, inputPath, outPath, format, SheetsHeadlessTimeout)
}

// ExportSlidesPdfHeadless exports a .pptx file to PDF.
func ExportSlidesPdfHeadless(opts ExportOptions, inputPath, outPath, format string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	if format != "pdf" {
		return fmt.Errorf("slides does not support format: %s", format)
	}
	return runEditorExport(opts, ModuleSlides, inputPath, outPath, format, SlidesHeadlessTimeout)
}

// ExportMarkdownPdfHeadless exports a .md file to PDF.
func ExportMarkdownPdfHeadless(opts ExportOptions, inputPath, outPath, format string) error {
	if err := validateExportPaths(inputPath, outPath); err != nil {
		return err
	}
	if format != "pdf" {
		return fmt.Errorf("markdown does not support format: %s", format)
	}
	return runEditorExport(opts, ModuleMarkdown, inputPath, outPath, format, MarkdownHeadlessTimeout)
}

// headlessReport is what the renderer sends on `headless-export-done`.
type headlessReport struct {
	ok  bool
	err error
}

// headlessReportFromEvent decodes the renderer's report. A payload with
// `ok:false` and an `error` string becomes that error; anything else is a
// generic failure so a malformed payload cannot be mistaken for success.
func headlessReportFromEvent(evt *application.CustomEvent) headlessReport {
	data, ok := evt.Data.(map[string]any)
	if !ok {
		return headlessReport{err: errors.New("renderer sent an unreadable headless-export result")}
	}
	if errStr, _ := data["error"].(string); errStr != "" {
		return headlessReport{err: errors.New(errStr)}
	}
	if succeeded, _ := data["ok"].(bool); succeeded {
		return headlessReport{ok: true}
	}
	return headlessReport{err: errors.New("the renderer reported a failed export without a reason")}
}

// waitForRenderCycle is the timing core of a headless export. It first waits
// for the renderer's `headless-ready` signal (so the consume request can never
// be emitted into a page that has not subscribed yet), then triggers the
// export, then waits for the completion report. Split out from the Wails
// plumbing so the timeouts and failure messages are unit-testable.
func waitForRenderCycle(
	ready <-chan struct{},
	done <-chan headlessReport,
	readyTimeout time.Duration,
	exportTimeout time.Duration,
	trigger func(),
) error {
	readyTimer := time.NewTimer(readyTimeout)
	defer readyTimer.Stop()
	select {
	case <-ready:
	case <-readyTimer.C:
		return fmt.Errorf(
			"the renderer did not become ready within %v (the editor page failed to load or its runtime did not start)",
			readyTimeout)
	}

	trigger()

	exportTimer := time.NewTimer(exportTimeout)
	defer exportTimer.Stop()
	select {
	case report := <-done:
		if report.err != nil {
			return report.err
		}
		if !report.ok {
			return errors.New("the renderer reported a failed export")
		}
		return nil
	case <-exportTimer.C:
		return fmt.Errorf(
			"headless export timed out after %v (the renderer never reported completion; the document may still be loading, failed to open, or be too large)",
			exportTimeout)
	}
}

// runEditorExport executes the headless export for a given editor module.
//
// Flow:
// 1. Register a tab carrying the input path, so the renderer's boot open
//    resolves that file (see tabs-bridge currentTabPath).
// 2. Create a hidden WebView2 window loading the editor renderer.
// 3. Wait for the renderer to report `headless-ready` (the page and runtime are
//    live and the consume listener is installed).
// 4. Emit the consume request, wait for `headless-export-done` with a timeout.
// 5. Tear the window and tab down.
func runEditorExport(opts ExportOptions, module, inputPath, outPath, format string, timeout time.Duration) error {
	if opts.Tabs == nil {
		return errors.New("headless export requires a tab host to mount the input document")
	}
	app := application.Get()
	if app == nil {
		return errors.New("Wails app not initialized (use the headless CLI entry point)")
	}

	tabID := opts.Tabs.AddTab(host.TabKind(module), filepath.Base(inputPath), inputPath)
	defer opts.Tabs.CloseTab(tabID)

	readyCh := make(chan struct{}, 1)
	doneCh := make(chan headlessReport, 1)
	readyEvent := module + ":headless-ready"
	doneEvent := module + ":headless-export-done"

	unsubReady := app.Event.On(readyEvent, func(*application.CustomEvent) {
		select {
		case readyCh <- struct{}{}:
		default:
		}
	})
	defer unsubReady()

	unsubDone := app.Event.On(doneEvent, func(evt *application.CustomEvent) {
		report := headlessReportFromEvent(evt)
		select {
		case doneCh <- report:
		default:
		}
	})
	defer unsubDone()

	windowName := fmt.Sprintf("headless-%s-%d", module, time.Now().UnixNano())
	w := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      windowName,
		Title:     "Headless Export",
		Width:     1280,
		Height:    800,
		URL:       "/" + module + "/index.html?tabId=" + url.QueryEscape(tabID),
		Hidden:    true,
		Frameless: true,
	})
	if w == nil {
		return errors.New("failed to create the hidden export window")
	}
	defer app.Window.Remove(w.ID())

	consumeEvent := module + ":consume-headless-export"
	return waitForRenderCycle(readyCh, doneCh, RendererReadyTimeout, timeout, func() {
		app.Event.Emit(consumeEvent, map[string]string{
			"inputPath": inputPath,
			"outPath":   outPath,
			"format":    format,
		})
	})
}
