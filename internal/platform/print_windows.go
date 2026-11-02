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
	"syscall"
	"time"
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
