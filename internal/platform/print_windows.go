//go:build windows

// Package platform isolates every direct dependency on the Wails V3 beta API.
package platform

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PrintOptions configures a PDF print operation.
type PrintOptions struct {
	// PageSize defines page dimensions in inches. Zero values mean document defaults.
	PageSize *PageSizeInches

	// Margins sets the margins in inches. Zero values mean document defaults.
	Margins *MarginsInches
}

// PageSizeInches defines page dimensions in inches.
type PageSizeInches struct {
	Width  float64
	Height float64
}

// MarginsInches defines page margins in inches.
type MarginsInches struct {
	Top    float64
	Bottom float64
	Left   float64
	Right  float64
}

// EdgeAvailable reports whether a headless-capable Edge executable exists.
// PDF export depends on it, so callers can degrade gracefully when absent.
func EdgeAvailable() bool { return findEdgeBrowser() != "" }

// PrintHTMLToPdf converts an HTML string directly to a PDF file, without
// requiring a live webview window. It writes the HTML to a temporary file and
// renders it with Edge headless, so output matches WebView2's Blink rendering.
func PrintHTMLToPdf(html string, outputPath string, opts PrintOptions) error {
	tmpDir, err := os.MkdirTemp("", "yiioffice-html-print-*")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	htmlPath := filepath.Join(tmpDir, "print.html")
	if err := os.WriteFile(htmlPath, []byte(withPageCSS(html, opts)), 0o644); err != nil {
		return fmt.Errorf("write temp HTML: %w", err)
	}

	edgePath := findEdgeBrowser()
	if edgePath == "" {
		return fmt.Errorf("Edge browser executable not found on this system")
	}

	args := buildEdgePrintArgs(htmlPath, outputPath, opts)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, edgePath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("edge headless print failed: %w\noutput: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// PrintToPdf exports the given webview window's content to a PDF file.
//
// Strategy:
// 1. Execute JavaScript in the webview to capture the full rendered HTML.
// 2. The JS sends the HTML back via a Wails event.
// 3. Write the HTML to a temp file.
// 4. Use Edge headless to convert it to PDF.
//
// This approach ensures pixel-identical output because Edge headless uses the
// same Blink rendering engine as WebView2.
func PrintToPdf(w application.Window, outputPath string, opts PrintOptions) error {
	if w == nil {
		return fmt.Errorf("window is nil")
	}

	// Step 1: Capture rendered HTML from the webview.
	html, err := captureHTML(w)
	if err != nil {
		return fmt.Errorf("capture HTML: %w", err)
	}

	// Step 2: Write HTML to a temporary file alongside the output.
	tmpDir := filepath.Join(filepath.Dir(outputPath), ".yiioffice-print-tmp")
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	htmlPath := filepath.Join(tmpDir, "print.html")
	if err := os.WriteFile(htmlPath, []byte(withPageCSS(html, opts)), 0o644); err != nil {
		return fmt.Errorf("write temp HTML: %w", err)
	}

	// Step 3: Use Edge headless to print to PDF.
	edgePath := findEdgeBrowser()
	if edgePath == "" {
		return fmt.Errorf("Edge browser executable not found on this system")
	}

	args := buildEdgePrintArgs(htmlPath, outputPath, opts)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, edgePath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("edge headless print failed: %w\noutput: %s", err, strings.TrimSpace(string(out)))
	}

	return nil
}

// captureHTML extracts the full rendered HTML from a webview by executing JS
// and listening for the result via a Wails event.
func captureHTML(w application.Window) (string, error) {
	var (
		mu   sync.Mutex
		html string
		done = make(chan struct{})
	)

	app := application.Get()
	if app == nil {
		// Fallback: try inline JS approach via HandleMessage.
		return captureHTMLInline(w)
	}

	unsubscribe := app.Event.On("print:html-capture", func(evt *application.CustomEvent) {
		data, ok := evt.Data.(string)
		if ok {
			mu.Lock()
			html = data
			mu.Unlock()
			close(done)
		}
	})
	defer unsubscribe()

	// Execute JS to capture HTML and emit it back via the Wails event system.
	js := `
		(function() {
			var html = document.documentElement.outerHTML;
			if (window.wails && window.wails.Events) {
				window.wails.Events.Emit("print:html-capture", html);
			} else {
				// Fallback: write to a hidden element we can read later.
				var el = document.getElementById("__print_html_capture__");
				if (!el) {
					el = document.createElement("div");
					el.id = "__print_html_capture__";
					el.style.display = "none";
					document.body.appendChild(el);
				}
				el.textContent = html;
			}
		})();
	`
	w.ExecJS(js)

	// Wait for the event with timeout.
	select {
	case <-done:
		mu.Lock()
		defer mu.Unlock()
		return html, nil
	case <-time.After(10 * time.Second):
		// Event didn't arrive; try the inline fallback.
		return captureHTMLInline(w)
	}
}

// captureHTMLInline is a fallback that reads HTML via a hidden element.
// It writes the HTML to a hidden div, then reads it back via HandleMessage.
func captureHTMLInline(w application.Window) (string, error) {
	// Step 1: Execute JS to store HTML in a hidden element.
	js := `
		(function() {
			var html = document.documentElement.outerHTML;
			var el = document.getElementById("__print_html_capture__");
			if (!el) {
				el = document.createElement("div");
				el.id = "__print_html_capture__";
				el.style.display = "none";
				document.body.appendChild(el);
			}
			el.textContent = html;
			// Signal readiness.
			if (window.wails && window.wails.Events) {
				window.wails.Events.Emit("print:html-ready", true);
			}
		})();
	`
	w.ExecJS(js)

	// Give JS time to execute.
	time.Sleep(500 * time.Millisecond)

	// Step 2: Read back the stored HTML.
	readJS := `
		(function() {
			var el = document.getElementById("__print_html_capture__");
			if (el) {
				var html = el.textContent;
				// Clean up.
				el.remove();
				if (window.wails && window.wails.Events) {
					window.wails.Events.Emit("print:html-capture", html);
				}
			}
		})();
	`
	w.ExecJS(readJS)

	// Wait for the result event.
	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("Wails app not available for inline HTML capture")
	}

	var (
		mu   sync.Mutex
		html string
		done = make(chan struct{})
	)

	unsubscribe := app.Event.On("print:html-capture", func(evt *application.CustomEvent) {
		data, ok := evt.Data.(string)
		if ok {
			mu.Lock()
			html = data
			mu.Unlock()
			close(done)
		}
	})
	defer unsubscribe()

	select {
	case <-done:
		mu.Lock()
		defer mu.Unlock()
		if html == "" {
			return "", fmt.Errorf("captured HTML is empty")
		}
		return html, nil
	case <-time.After(10 * time.Second):
		return "", fmt.Errorf("inline HTML capture timed out")
	}
}

// withPageCSS injects the requested sheet geometry as an @page rule. Headless
// Edge picks the sheet size up from CSS; there is no reliable command-line
// flag for it, so the page size has to travel inside the document.
func withPageCSS(html string, opts PrintOptions) string {
	if opts.PageSize == nil || opts.PageSize.Width <= 0 || opts.PageSize.Height <= 0 {
		return html
	}
	rule := fmt.Sprintf("<style>@page{size:%.4fin %.4fin;margin:0}</style>",
		opts.PageSize.Width, opts.PageSize.Height)
	if strings.Contains(html, "<head>") {
		return strings.Replace(html, "<head>", "<head>"+rule, 1)
	}
	return rule + html
}

// ListPrinterNames returns the names of the installed printers. An empty slice
// means none were found or the query failed.
func ListPrinterNames() []string {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		"Get-Printer | Select-Object -ExpandProperty Name")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return []string{}
	}
	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		name := strings.TrimSpace(line)
		if name != "" {
			names = append(names, name)
		}
	}
	if names == nil {
		return []string{}
	}
	return names
}

// buildEdgePrintArgs constructs the command-line arguments for Edge headless PDF export.
func buildEdgePrintArgs(htmlPath, outputPath string, opts PrintOptions) []string {
	args := []string{
		"--headless",
		"--disable-gpu",
		"--no-sandbox",
		"--no-pdf-header-footer",
		"--print-to-pdf=" + outputPath,
	}

	if opts.Margins != nil {
		m := opts.Margins
		// Edge expects margins in pixels (96 DPI).
		args = append(args,
			fmt.Sprintf("--margin-top=%.4f", m.Top*96.0),
			fmt.Sprintf("--margin-bottom=%.4f", m.Bottom*96.0),
			fmt.Sprintf("--margin-left=%.4f", m.Left*96.0),
			fmt.Sprintf("--margin-right=%.4f", m.Right*96.0),
		)
	}

	args = append(args, htmlPath)
	return args
}

// FindEdgeBrowser locates the Edge browser executable on Windows.
// Exported so the export package can use it directly.
func FindEdgeBrowser() string {
	return findEdgeBrowser()
}

// findEdgeBrowser locates the Edge browser executable on Windows.
func findEdgeBrowser() string {
	// Check common Edge installation paths (stable channel first).
	paths := []string{
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
	}

	// Check user-specific install (Dev/Beta/Canary channels).
	if localAppData, ok := os.LookupEnv("LOCALAPPDATA"); ok {
		paths = append(paths,
			filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(localAppData, "Microsoft", "Edge Dev", "Application", "msedge.exe"),
			filepath.Join(localAppData, "Microsoft", "Edge Beta", "Application", "msedge.exe"),
		)
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Last resort: search PATH.
	if p, err := exec.LookPath("msedge"); err == nil {
		return p
	}

	return ""
}
