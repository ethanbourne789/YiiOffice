//go:build windows

package platform

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFindEdgeBrowser(t *testing.T) {
	path := findEdgeBrowser()
	if path == "" {
		t.Skip("Edge browser not found on this system")
	}
	if !strings.Contains(strings.ToLower(path), "msedge") {
		t.Fatalf("unexpected path: %s", path)
	}

	// Verify the path is a valid executable.
	if _, err := exec.LookPath(path); err != nil {
		// LookPath uses PATH; the direct path may still be valid.
		t.Logf("msedge not in PATH but found at: %s", path)
	}
}

func TestFindEdgeBrowserReturnsAbsolute(t *testing.T) {
	path := findEdgeBrowser()
	if path == "" {
		t.Skip("Edge browser not found")
	}
	if !filepath.IsAbs(path) {
		t.Fatalf("expected absolute path, got: %s", path)
	}
}

func TestBuildEdgePrintArgsDefaults(t *testing.T) {
	args := buildEdgePrintArgs("in.html", "out.pdf", PrintOptions{})

	if len(args) < 4 {
		t.Fatalf("too few args: %v", args)
	}

	hasFlag := func(flag string) bool {
		for _, a := range args {
			if strings.Contains(a, flag) {
				return true
			}
		}
		return false
	}

	if !hasFlag("--headless") {
		t.Error("missing --headless")
	}
	if !hasFlag("--print-to-pdf=out.pdf") {
		t.Error("missing --print-to-pdf")
	}
	if args[len(args)-1] != "in.html" {
		t.Errorf("last arg should be input HTML, got: %s", args[len(args)-1])
	}
}

func TestBuildEdgePrintArgsWithMargins(t *testing.T) {
	opts := PrintOptions{
		Margins: &MarginsInches{
			Top:    0.5,
			Bottom: 0.5,
			Left:   0.75,
			Right:  0.75,
		},
	}
	args := buildEdgePrintArgs("in.html", "out.pdf", opts)

	hasFlag := func(prefix string) bool {
		for _, a := range args {
			if strings.HasPrefix(a, prefix) {
				return true
			}
		}
		return false
	}

	if !hasFlag("--margin-top=") {
		t.Error("missing --margin-top")
	}
	if !hasFlag("--margin-bottom=") {
		t.Error("missing --margin-bottom")
	}
	if !hasFlag("--margin-left=") {
		t.Error("missing --margin-left")
	}
	if !hasFlag("--margin-right=") {
		t.Error("missing --margin-right")
	}
}

