package export

import (
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
		{"doc.doc", "docs"},
		{"sheet.xlsx", "sheets"},
		{"data.csv", "sheets"},
		{"deck.pptx", "slides"},
		{"notes.md", "markdown"},
		{"notes.markdown", "markdown"},
		{"image.png", ""},
		{"setup.exe", ""},
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
