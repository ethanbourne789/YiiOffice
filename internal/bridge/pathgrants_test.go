package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// TestMain mirrors main.go's startup: the app-managed directories (and the
// system temp dir that backs t.TempDir) are granted for the session, so
// legitimate test writes pass the write whitelist exactly like a real run.
func TestMain(m *testing.M) {
	if err := InitManagedGrants(); err != nil {
		fmt.Fprintf(os.Stderr, "InitManagedGrants: %v\n", err)
	}
	os.Exit(m.Run())
}

func TestAuthoriseWriteRejectsRelativePath(t *testing.T) {
	if _, err := AuthoriseWrite("notes\\out.md"); err == nil {
		t.Fatal("expected a relative write target to be rejected")
	}
	if _, err := AuthoriseWrite(""); err == nil {
		t.Fatal("expected an empty write target to be rejected")
	}
}

func TestAuthoriseWriteRejectsDotDotEscape(t *testing.T) {
	dir := outsideProfileDir(t)
	granted := filepath.Join(dir, "note.md")
	GrantFile(granted)

	// The granted file itself must pass.
	if got, err := AuthoriseWrite(granted); err != nil {
		t.Fatalf("granted path rejected: %v", err)
	} else if got != filepath.Clean(granted) {
		t.Fatalf("unexpected canonical path %q", got)
	}

	// ..\ out of the granted directory must be rejected, not silently Cleaned
	// into a writable neighbour.
	escaped := filepath.Join(dir, "..", "stolen.md")
	if _, err := AuthoriseWrite(escaped); err == nil {
		t.Fatalf("expected the escape path %s to be refused", escaped)
	}
}

func TestAuthoriseWriteRejectsUngrantedAbsolutePath(t *testing.T) {
	dir := outsideProfileDir(t)
	target := filepath.Join(dir, "evil.pdf")
	_, err := AuthoriseWrite(target)
	if err == nil {
		t.Fatal("expected an ungranted absolute path to be refused")
	}
	if !strings.Contains(err.Error(), "not authorised") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGrantDirAllowsSubtreeWrites(t *testing.T) {
	dir := outsideProfileDir(t)
	GrantDir(dir)
	target := filepath.Join(dir, "sub", "image.png")

	svc := NewExportService()
	res := svc.WriteBase64File(target, "aGk=")
	if !res.OK {
		t.Fatalf("write inside a granted folder failed: %+v", res)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "hi" {
		t.Fatalf("unexpected content %q (err %v)", data, err)
	}
}

func TestAuthoriseWriteDirRequiresGrantedFolder(t *testing.T) {
	dir := outsideProfileDir(t)
	if _, err := AuthoriseWriteDir(dir); err == nil {
		t.Fatal("expected an ungranted folder to be refused")
	}
	GrantDir(dir)
	got, err := AuthoriseWriteDir(dir)
	if err != nil {
		t.Fatalf("granted folder refused: %v", err)
	}
	if got != filepath.Clean(dir) {
		t.Fatalf("unexpected canonical dir %q", got)
	}
	// Escaping the granted folder via .. must be refused as well.
	if _, err := AuthoriseWriteDir(filepath.Join(dir, "..")); err == nil {
		t.Fatal("expected the parent of a granted folder to be refused")
	}
}

func TestExportPdfRejectsUnauthorisedOutPath(t *testing.T) {
	svc := NewExportService()
	out := filepath.Join(outsideProfileDir(t), "stolen.pdf")
	res := svc.ExportPdf(sampleExportHTML, out, "stolen.pdf", 0, 0)
	if res.OK || res.Error == "" {
		t.Fatalf("expected rejection, got %+v", res)
	}
	if !strings.Contains(res.Error, "not authorised") {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if _, err := os.Stat(out); err == nil {
		t.Fatal("the rejected export still wrote a file")
	}
}

// The Slides export flow is pickExportPdfPath (PickSaveFile → grant) followed
// by ExportPdf(outPath): the granted path must still export in one shot.
func TestExportPdfAcceptsGrantedOutPath(t *testing.T) {
	if !platform.EdgeAvailable() {
		t.Skip("Edge not installed; PDF rendering unavailable")
	}
	svc := NewExportService()
	out := filepath.Join(t.TempDir(), "deck.pdf")
	GrantFile(out) // stands in for the save-dialog result
	res := svc.ExportPdf(sampleExportHTML, out, "deck.pdf", 8.5, 11)
	if !res.OK || res.Error != "" {
		t.Fatalf("granted export failed: %+v", res)
	}
	if info, err := os.Stat(out); err != nil || info.Size() == 0 {
		t.Fatalf("expected a non-empty PDF at %s (err %v)", out, err)
	}
}

func TestMarkdownExportPdfRejectsUnauthorisedOutPath(t *testing.T) {
	svc := newTestMarkdownService(t, t.TempDir())
	out := filepath.Join(outsideProfileDir(t), "markdown.pdf")
	res := svc.ExportPdf("<h1>hi</h1>", "markdown.pdf", out)
	if res.OK || res.Error == "" || !strings.Contains(res.Error, "not authorised") {
		t.Fatalf("expected rejection, got %+v", res)
	}
}

func TestTakeTempPdfRejectsUngrantedPath(t *testing.T) {
	svc := NewExportService()
	target := filepath.Join(outsideProfileDir(t), "victim.pdf")
	if err := os.WriteFile(target, []byte("%PDF-1.4"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	if _, err := svc.TakeTempPdf(target); err == nil {
		t.Fatal("expected an ungranted temp path to be refused")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal("a refused TakeTempPdf must not delete the file")
	}
}

// Problem 2 regression: a local "Save Image As" source must pass the same
// guard as ReadImage instead of reading any path on disk.
func TestSaveImageSourceAsRejectsUnauthorisedSource(t *testing.T) {
	src := filepath.Join(outsideProfileDir(t), "secret.png")
	if err := os.WriteFile(src, []byte("PNG"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	res := saveImageSourceAs(src, func() []string { return nil }, nil)
	if res.Error == "" || !strings.Contains(res.Error, "source not authorised") {
		t.Fatalf("expected an unauthorised-source rejection, got %+v", res)
	}
}

func TestSanitizeFileNameBlocksTraversal(t *testing.T) {
	// Whatever the platform, a sanitized name must not contain path
	// separators or survive as a traversal component.
	for _, in := range []string{`..\..\evil.pdf`, `../../etc/passwd`, `a/b/c.md`, "x\x00y", "..", "."} {
		got := sanitizeFileName(in)
		if strings.ContainsAny(got, `/\`) {
			t.Fatalf("sanitizeFileName(%q) = %q still contains a separator", in, got)
		}
		if got == "." || got == ".." {
			t.Fatalf("sanitizeFileName(%q) survived as a traversal component", in)
		}
	}
	if got := sanitizeFileName(`report.pdf`); got != "report.pdf" {
		t.Fatalf("legitimate name altered: %q", got)
	}
}
