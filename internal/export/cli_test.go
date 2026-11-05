package export

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestHeadlessFlagPresent(t *testing.T) {
	cases := []struct {
		argv []string
		want bool
	}{
		{[]string{"app.exe"}, false},
		{[]string{"app.exe", "--json"}, false},
		{[]string{"app.exe", "--headless-export", "a.docx"}, true},
		{[]string{"app.exe", "--headless-export=a.docx"}, true},
	}
	for _, tt := range cases {
		if got := HeadlessFlagPresent(tt.argv); got != tt.want {
			t.Fatalf("HeadlessFlagPresent(%v) = %v, want %v", tt.argv, got, tt.want)
		}
	}
}

func TestParseHeadlessUsageErrorExitCode(t *testing.T) {
	outcome := ParseHeadlessUsageError()
	if code := HeadlessExitCode(outcome); code != ExitBadArgs {
		t.Fatalf("usage error exit code = %d, want %d", code, ExitBadArgs)
	}
	if !strings.Contains(outcome.Error, "bad command line") {
		t.Fatalf("usage error not diagnostic: %s", outcome.Error)
	}
}

func TestParseHeadlessExportSuccess(t *testing.T) {
	req, ok := ParseHeadlessExport([]string{
		"app.exe",
		"--headless-export", "C:\\docs\\test.docx",
		"--to", "pdf",
		"--out", "C:\\out\\test.pdf",
		"--json",
	})
	if !ok {
		t.Fatal("expected success")
	}
	if req.Input != "C:\\docs\\test.docx" {
		t.Fatalf("input = %q", req.Input)
	}
	if req.To != "pdf" {
		t.Fatalf("to = %q", req.To)
	}
	if req.Out != "C:\\out\\test.pdf" {
		t.Fatalf("out = %q", req.Out)
	}
	if !req.JSON {
		t.Fatal("json should be true")
	}
}

func TestParseHeadlessExportMissingFlags(t *testing.T) {
	cases := [][]string{
		{"app.exe", "--headless-export", "input.docx"},                          // missing --to, --out
		{"app.exe", "--headless-export", "input.docx", "--to", "pdf"},           // missing --out
		{"app.exe", "--headless-export"},                                        // missing input
		{"app.exe", "something-else"},                                           // no flag
		{"app.exe", "--headless-export", "input.docx", "--to"},                  // --to missing value
	}
	for _, argv := range cases {
		_, ok := ParseHeadlessExport(argv)
		if ok {
			t.Fatalf("expected failure for %v", argv)
		}
	}
}

func TestParseHeadlessExportOrderVariation(t *testing.T) {
	req, ok := ParseHeadlessExport([]string{
		"app.exe",
		"--headless-export", "input.md",
		"--json",
		"--out", "out.pdf",
		"--to", "pdf",
	})
	if !ok {
		t.Fatal("expected success")
	}
	if req.To != "pdf" {
		t.Fatalf("to = %q", req.To)
	}
	if req.Out != "out.pdf" {
		t.Fatalf("out = %q", req.Out)
	}
}

func TestHeadlessModuleFor(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"doc.docx", "docs"},
		{"sheet.xlsx", "sheets"},
		{"sheet.xlsm", "sheets"},
		{"data.csv", "sheets"},
		{"data.tsv", "sheets"},
		{"deck.pptx", "slides"},
		{"notes.md", "markdown"},
		{"notes.markdown", "markdown"},
		{"image.png", ""},
		{"setup.exe", ""},
		// Legacy binaries and HTML inputs are rejected: the renderers cannot
		// open 97-2003 files and HTML is an export target only.
		{"legacy.doc", ""},
		{"legacy.xls", ""},
		{"legacy.ppt", ""},
		{"page.html", ""},
	}
	for _, tc := range cases {
		got := headlessModuleFor(tc.path)
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestValidateRequestSupported(t *testing.T) {
	req := HeadlessRequest{
		Input: "test.docx",
		To:    "pdf",
		Out:   "out.pdf",
	}
	if err := ValidateRequest(req); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateRequestUnsupportedFormat(t *testing.T) {
	req := HeadlessRequest{
		Input: "test.xlsx",
		To:    "html",
		Out:   "out.html",
	}
	err := ValidateRequest(req)
	if err == nil {
		t.Fatal("expected error for xlsx -> html")
	}
}

func TestValidateRequestUnsupportedType(t *testing.T) {
	req := HeadlessRequest{
		Input: "test.png",
		To:    "pdf",
		Out:   "out.pdf",
	}
	err := ValidateRequest(req)
	if err == nil {
		t.Fatal("expected error for png input")
	}
}

// The rejection happens during validation, so it keeps the existing bad-args
// exit code instead of inventing a new one.
func TestUnsupportedInputUsesBadArgsExitCode(t *testing.T) {
	for _, input := range []string{"old.doc", "old.xls", "old.ppt", "page.html", "x.png"} {
		req := HeadlessRequest{Input: input, To: "pdf", Out: "out.pdf"}
		if code := HeadlessExitCode(RunHeadlessExport(req, nil)); code != ExitBadArgs {
			t.Errorf("%s: exit code = %d, want %d", input, code, ExitBadArgs)
		}
	}
}

func TestValidateRequestLegacyErrorIsReadable(t *testing.T) {
	for _, input := range []string{"old.doc", "old.xls", "old.ppt"} {
		err := ValidateRequest(HeadlessRequest{Input: input, To: "pdf", Out: "out.pdf"})
		if err == nil {
			t.Fatalf("%s: expected an error", input)
		}
		msg := err.Error()
		if !strings.Contains(msg, "supported:") {
			t.Errorf("%s: error should list supported extensions, got %q", input, msg)
		}
		if !strings.Contains(msg, "save legacy") {
			t.Errorf("%s: error should tell the user to save in a modern format, got %q", input, msg)
		}
	}

	// HTML is unsupported for a different reason, so it must not claim the
	// 97-2003 remedy.
	err := ValidateRequest(HeadlessRequest{Input: "page.html", To: "pdf", Out: "out.pdf"})
	if err == nil {
		t.Fatal("expected an error for html input")
	}
	if strings.Contains(err.Error(), "save legacy") {
		t.Errorf("html error should not mention legacy formats: %q", err.Error())
	}
}

// TestHeadlessFormatsMatchFrontend locks the Go CLI list to the renderer's
// canonical JSON. Editing either side alone turns this test red.
func TestHeadlessFormatsMatchFrontend(t *testing.T) {
	path := filepath.Join("..", "..", "frontend", "packages", "desktop-utils", "src", "headless-formats.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read canonical format list: %v", err)
	}

	var frontend map[string][]string
	if err := json.Unmarshal(raw, &frontend); err != nil {
		t.Fatalf("parse canonical format list: %v", err)
	}

	goModules := make(map[string][]string, len(frontend))
	for _, entry := range headlessInputTypes {
		goModules[entry.module] = append(goModules[entry.module], entry.ext)
	}

	if len(goModules) != len(frontend) {
		t.Fatalf("module count differs: Go has %d (%v), frontend JSON has %d (%v)",
			len(goModules), sortedModuleNames(goModules), len(frontend), sortedModuleNames(frontend))
	}

	for module, rawWant := range frontend {
		gotExts, ok := goModules[module]
		if !ok {
			t.Fatalf("module %q exists in the frontend JSON but not in Go", module)
		}
		wantExts := make([]string, 0, len(rawWant))
		for _, ext := range rawWant {
			wantExts = append(wantExts, strings.TrimPrefix(ext, "."))
		}
		sort.Strings(gotExts)
		sort.Strings(wantExts)
		if strings.Join(gotExts, ",") != strings.Join(wantExts, ",") {
			t.Errorf("module %q differs: Go accepts %v, frontend JSON accepts %v",
				module, gotExts, wantExts)
		}
	}
}

func sortedModuleNames(modules map[string][]string) []string {
	names := make([]string, 0, len(modules))
	for name := range modules {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func TestHeadlessTargetsDocsHasHTML(t *testing.T) {
	targets := HeadlessTargets["docs"]
	hasHTML := false
	for _, t := range targets {
		if t == "html" {
			hasHTML = true
			break
		}
	}
	if !hasHTML {
		t.Fatal("docs module should support html export")
	}
}

// TestAbsolutiseRequestResolvesRelativePaths pins the fix for a real bug: a
// relative --out used to lose its bridge write grant (GrantFile silently drops
// non-absolute paths), so the export rendered fine and then failed to write,
// surfacing as "export did not produce a file".
func TestAbsolutiseRequestResolvesRelativePaths(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)

	req, err := AbsolutiseRequest(HeadlessRequest{Input: "in.docx", To: "pdf", Out: "nested/out.pdf"})
	if err != nil {
		t.Fatalf("AbsolutiseRequest: %v", err)
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(wd, "in.docx"); req.Input != want {
		t.Errorf("input = %q, want %q", req.Input, want)
	}
	if want := filepath.Join(wd, "nested", "out.pdf"); req.Out != want {
		t.Errorf("out = %q, want %q", req.Out, want)
	}
	if !filepath.IsAbs(req.Input) || !filepath.IsAbs(req.Out) {
		t.Fatal("both paths must be absolute after resolution")
	}
	if req.To != "pdf" {
		t.Errorf("to = %q, want pdf", req.To)
	}
}

// TestAbsolutiseRequestIsIdempotent guards the retry path: a caller that
// resolves twice (CLI entry point, then the runner) must not end up with a
// path that drifts on the second pass.
func TestAbsolutiseRequestIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)

	first, err := AbsolutiseRequest(HeadlessRequest{Input: "in.docx", To: "pdf", Out: "out.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := AbsolutiseRequest(first)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("second pass changed the request: %+v → %+v", first, second)
	}
}
